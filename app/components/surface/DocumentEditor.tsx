import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFetcher, useSubmit } from 'react-router';
import {
    defineAnnotation,
    defineBlockObject,
    defineDecorator,
    defineSchema,
    defineTextBlock,
    EditorProvider,
    PortableTextEditable,
    useEditor,
    useEditorSelector,
    type PortableTextBlock,
} from '@portabletext/editor';
import { EventListenerPlugin, NodePlugin } from '@portabletext/editor/plugins';
import {
    isActiveDecorator,
    isActiveListItem,
    isActiveStyle,
} from '@portabletext/editor/selectors';
import { MarkdownShortcutsPlugin } from '@portabletext/plugin-markdown-shortcuts';
import {
    AtSignIcon,
    BoldIcon,
    CodeIcon,
    Heading2Icon,
    Heading3Icon,
    ItalicIcon,
    ListIcon,
    ListOrderedIcon,
    QuoteIcon,
    type LucideIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import { Button } from '~/components/ui/button';
import {
    DECORATORS,
    LIST_ITEMS,
    TEXT_STYLES,
    type DocumentBlock,
    type TableBlock,
} from '~/lib/portable-text';
import type { DocumentItem } from '~/lib/surface';
import { DocumentTable, ItemCard, ItemChip } from './DocumentBody';
import { InsertMenuPicker, ItemLinkPicker } from './EditorPickers';
import { useSurfaceLinks } from './surface-context';

/** Wait this long after the last keystroke before saving. */
const SAVE_DELAY_MS = 800;

/** The editor's schema: exactly what `documentBlocksSchema` accepts. */
const schemaDefinition = defineSchema({
    decorators: DECORATORS.map((name) => ({ name })),
    styles: TEXT_STYLES.map((name) => ({ name })),
    lists: LIST_ITEMS.map((name) => ({ name })),
    annotations: [
        { name: 'link', fields: [{ name: 'href', type: 'string' }] },
        { name: 'itemRef', fields: [{ name: 'itemId', type: 'string' }] },
    ],
    blockObjects: [
        { name: 'itemEmbed', fields: [{ name: 'itemId', type: 'string' }] },
        // Carried whole: the editor shows a table but doesn't edit its cells.
        {
            name: 'table',
            fields: [
                { name: 'headerRow', type: 'boolean' },
                { name: 'rows', type: 'array' },
            ],
        },
    ],
    inlineObjects: [],
});

const LIST_CLASSES = {
    bullet: "relative ps-6 before:absolute before:start-1.5 before:text-muted-foreground before:content-['•']",
    number: "relative ps-6 [counter-increment:doc-list] before:absolute before:start-0 before:text-muted-foreground before:content-[counter(doc-list)'.']",
} as const;

// At module scope: a fresh array each render would re-register every node
// on every keystroke.
const nodes = [
    defineTextBlock({
        type: 'block',
        render: ({ attributes, children, node }) => {
            if (node.listItem === 'bullet' || node.listItem === 'number') {
                return (
                    <div
                        {...attributes}
                        className={cx(
                            'my-1',
                            LIST_CLASSES[node.listItem],
                            node.listItem === 'bullet' &&
                                '[counter-reset:doc-list]',
                        )}
                        style={{
                            marginInlineStart: `${((node.level ?? 1) - 1) * 1.5}rem`,
                        }}
                    >
                        {children}
                    </div>
                );
            }
            // Any other block restarts numbering.
            const reset = '[counter-reset:doc-list]';
            if (node.style === 'h2') {
                return (
                    <h2 {...attributes} className={reset}>
                        {children}
                    </h2>
                );
            }
            if (node.style === 'h3') {
                return (
                    <h3 {...attributes} className={reset}>
                        {children}
                    </h3>
                );
            }
            if (node.style === 'blockquote') {
                return (
                    <blockquote {...attributes} className={reset}>
                        {children}
                    </blockquote>
                );
            }
            return (
                <p {...attributes} className={reset}>
                    {children}
                </p>
            );
        },
    }),
    defineDecorator({
        type: 'strong',
        render: ({ children }) => <strong>{children}</strong>,
    }),
    defineDecorator({
        type: 'em',
        render: ({ children }) => <em>{children}</em>,
    }),
    defineDecorator({
        type: 'code',
        render: ({ children }) => <code>{children}</code>,
    }),
    defineAnnotation({
        type: 'link',
        render: ({ annotation, children }) => (
            <span
                title={String((annotation as { href?: string }).href ?? '')}
                className="text-foreground underline underline-offset-2"
            >
                {children}
            </span>
        ),
    }),
    defineAnnotation({
        type: 'itemRef',
        render: ({ annotation, children }) => (
            <ItemChip
                itemId={String((annotation as { itemId?: string }).itemId)}
                editing
            >
                {children}
            </ItemChip>
        ),
    }),
    defineBlockObject({
        type: 'itemEmbed',
        render: ({ attributes, children, node, selected }) => (
            <div
                {...attributes}
                className={cx(
                    'rounded-lg',
                    selected && 'ring-ring ring-2 ring-offset-2',
                )}
            >
                {children}
                <ItemCard
                    itemId={String((node as { itemId?: string }).itemId)}
                    editing
                />
            </div>
        ),
    }),
    defineBlockObject({
        type: 'table',
        render: ({ attributes, children, node, selected }) => (
            <div
                {...attributes}
                className={cx(
                    'rounded-lg',
                    selected && 'ring-ring ring-2 ring-offset-2',
                )}
            >
                {children}
                <DocumentTable table={node as unknown as TableBlock} />
            </div>
        ),
    }),
];

type Props = {
    doc: DocumentItem;
};

type SaveResult = {
    error: string | null;
    updatedAt?: string;
    conflict?: boolean;
};

/** The later of two ISO timestamps. */
function later(a: string, b: string | undefined) {
    return b && b > a ? b : a;
}

/**
 * The focused document, editable: Portable Text with Markdown shortcuts,
 * `@` to link an item, `/` for headings, lists, and item cards. Saves a
 * moment after you stop typing (`update-document`), each save naming the
 * version it builds on; if someone (an agent) saved in between, the server
 * refuses and you choose: load theirs, or keep yours over it.
 */
export function DocumentEditor({ doc }: Props) {
    const links = useSurfaceLinks();
    const fetcherKey = `save-doc:${doc.id}`;
    const saver = useFetcher<SaveResult>({ key: fetcherKey });
    const submit = useSubmit();
    // A new session (remounting the editor) when loading someone else's
    // changes; `startedFrom` is the version it opened at.
    const [session, setSession] = useState({
        key: 0,
        startedFrom: doc.updatedAt,
    });
    const savedVersion =
        saver.data && !saver.data.conflict ? saver.data.updatedAt : undefined;
    const base = later(session.startedFrom, savedVersion);
    const conflict = Boolean(saver.data?.conflict);
    const saving = saver.state !== 'idle';

    const pending = useRef<DocumentBlock[] | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const latest = useRef({ base, saving, conflict });
    useEffect(() => {
        latest.current = { base, saving, conflict };
    });

    function save(baseUpdatedAt: string) {
        const blocks = pending.current;
        if (!blocks) return;
        pending.current = null;
        void submit(
            {
                intent: 'update-document',
                documentId: doc.id,
                baseUpdatedAt,
                blocks: JSON.stringify(blocks),
            },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey,
            },
        );
    }

    function flush() {
        clearTimeout(timer.current);
        const { base, saving, conflict } = latest.current;
        if (conflict || !pending.current) return;
        // One save at a time: the next builds on the version this returns.
        if (saving) {
            timer.current = setTimeout(flush, 200);
            return;
        }
        save(base);
    }
    const flushRef = useRef(flush);
    useEffect(() => {
        flushRef.current = flush;
    });

    // Leaving the document (Back to canvas) saves what's left at once.
    useEffect(() => () => flushRef.current(), []);

    function handleChange(value: PortableTextBlock[] | undefined) {
        pending.current = (value ?? []) as DocumentBlock[];
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
    }

    // Someone else saved since this editor's version, and nothing of ours
    // is on its way: saving now would conflict, so say so first.
    const changedElsewhere = !saving && !conflict && doc.updatedAt > base;

    function loadLatest() {
        pending.current = null;
        clearTimeout(timer.current);
        saver.reset?.();
        setSession((current) => ({
            key: current.key + 1,
            startedFrom: doc.updatedAt,
        }));
    }

    function keepMine() {
        save(doc.updatedAt);
    }

    return (
        <EditorProvider
            key={session.key}
            initialConfig={{
                schemaDefinition,
                initialValue: doc.blocks as PortableTextBlock[],
            }}
        >
            <EventListenerPlugin
                on={(event) => {
                    if (event.type === 'mutation') handleChange(event.value);
                }}
            />
            <NodePlugin nodes={nodes} />
            <MarkdownShortcutsPlugin
                boldDecorator={() => 'strong'}
                italicDecorator={() => 'em'}
                codeDecorator={() => 'code'}
                defaultStyle={() => 'normal'}
                headingStyle={({ props }) =>
                    props.level === 1 || props.level === 2
                        ? 'h2'
                        : props.level === 3
                          ? 'h3'
                          : undefined
                }
                blockquoteStyle={() => 'blockquote'}
                orderedList={() => 'number'}
                unorderedList={() => 'bullet'}
                linkObject={({ props }) =>
                    props.href.startsWith('item:')
                        ? {
                              _type: 'itemRef',
                              itemId: props.href.slice('item:'.length),
                          }
                        : { _type: 'link', href: props.href }
                }
            />
            {doc.blocks.length === 0 && <FocusOnOpen />}
            <ItemLinkPicker documentId={doc.id} />
            <InsertMenuPicker documentId={doc.id} />

            <div className="flex flex-col gap-3">
                <div className="bg-card/95 sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 backdrop-blur">
                    <Toolbar />
                    <SaveStatus
                        saving={saving || pending.current !== null}
                        failed={Boolean(saver.data?.error) && !conflict}
                    />
                </div>
                {(conflict || changedElsewhere) && (
                    <div
                        role="alert"
                        className="bg-warning/12 text-foreground flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                        <span className="flex-1">
                            {conflict
                                ? 'Someone else changed this document, so your last edit was not saved.'
                                : 'Someone else changed this document while you were editing.'}
                        </span>
                        <Button
                            size="xs"
                            variant="outline"
                            onClick={loadLatest}
                        >
                            Load their version
                        </Button>
                        <Button size="xs" variant="ghost" onClick={keepMine}>
                            Keep mine
                        </Button>
                    </div>
                )}
                <PortableTextEditable
                    aria-label={`Edit ${doc.title}`}
                    // The canvas listens for keys (arrows nudge windows,
                    // Backspace removes them); typing stays in the document.
                    onKeyDown={(event) => event.stopPropagation()}
                    renderPlaceholder={() => (
                        <span className="text-muted-foreground pointer-events-none">
                            Write, or type / to insert and @ to link an item
                        </span>
                    )}
                    className="min-h-40 outline-none [&_p]:my-3"
                />
            </div>
        </EditorProvider>
    );
}

/** A new, empty document: the cursor goes straight in, ready to write. */
function FocusOnOpen() {
    const editor = useEditor();
    useEffect(() => {
        editor.send({ type: 'focus' });
    }, [editor]);
    return null;
}

function SaveStatus({ saving, failed }: { saving: boolean; failed: boolean }) {
    return (
        <span
            role="status"
            className={cx(
                'ms-auto pe-1 text-xs',
                failed ? 'text-destructive' : 'text-muted-foreground',
            )}
        >
            {failed ? 'Not saved' : saving ? 'Saving…' : 'Saved'}
        </span>
    );
}

function Toolbar() {
    const editor = useEditor();
    return (
        <div
            role="toolbar"
            aria-label="Formatting"
            className="flex flex-wrap items-center gap-0.5"
        >
            <StyleButton style="h2" icon={Heading2Icon} label="Heading" />
            <StyleButton style="h3" icon={Heading3Icon} label="Subheading" />
            <StyleButton style="blockquote" icon={QuoteIcon} label="Quote" />
            <Divider />
            <DecoratorButton decorator="strong" icon={BoldIcon} label="Bold" />
            <DecoratorButton decorator="em" icon={ItalicIcon} label="Italic" />
            <DecoratorButton decorator="code" icon={CodeIcon} label="Code" />
            <Divider />
            <ListButton
                listItem="bullet"
                icon={ListIcon}
                label="Bulleted list"
            />
            <ListButton
                listItem="number"
                icon={ListOrderedIcon}
                label="Numbered list"
            />
            <Divider />
            <ToolbarButton
                icon={AtSignIcon}
                label="Link an item"
                pressed={false}
                onClick={() => {
                    editor.send({ type: 'focus' });
                    editor.send({ type: 'insert.text', text: '@' });
                }}
            />
        </div>
    );
}

function Divider() {
    return <span aria-hidden="true" className="bg-border mx-1 h-4 w-px" />;
}

type ButtonProps = {
    icon: LucideIcon;
    label: string;
};

function StyleButton({
    style,
    ...props
}: ButtonProps & { style: (typeof TEXT_STYLES)[number] }) {
    const editor = useEditor();
    const active = useEditorSelector(editor, isActiveStyle(style));
    return (
        <ToolbarButton
            {...props}
            pressed={active}
            onClick={() => {
                editor.send({ type: 'style.toggle', style });
                editor.send({ type: 'focus' });
            }}
        />
    );
}

function DecoratorButton({
    decorator,
    ...props
}: ButtonProps & { decorator: (typeof DECORATORS)[number] }) {
    const editor = useEditor();
    const active = useEditorSelector(editor, isActiveDecorator(decorator));
    return (
        <ToolbarButton
            {...props}
            pressed={active}
            onClick={() => {
                editor.send({ type: 'decorator.toggle', decorator });
                editor.send({ type: 'focus' });
            }}
        />
    );
}

function ListButton({
    listItem,
    ...props
}: ButtonProps & { listItem: (typeof LIST_ITEMS)[number] }) {
    const editor = useEditor();
    const active = useEditorSelector(editor, isActiveListItem(listItem));
    return (
        <ToolbarButton
            {...props}
            pressed={active}
            onClick={() => {
                editor.send({ type: 'list item.toggle', listItem });
                editor.send({ type: 'focus' });
            }}
        />
    );
}

type ToolbarButtonProps = ButtonProps & {
    pressed: boolean;
    onClick: () => void;
    children?: ReactNode;
};

function ToolbarButton({
    icon: Icon,
    label,
    pressed,
    onClick,
}: ToolbarButtonProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            // Keep the editor's selection while clicking.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={cx(pressed && 'bg-accent text-foreground')}
        >
            <Icon aria-hidden="true" />
        </Button>
    );
}
