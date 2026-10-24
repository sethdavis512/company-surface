import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { raise } from '@portabletext/editor/behaviors';
import {
    defineTypeaheadPicker,
    useTypeaheadPicker,
} from '@portabletext/plugin-typeahead-picker';
import {
    Heading2Icon,
    Heading3Icon,
    ListIcon,
    ListOrderedIcon,
    PilcrowIcon,
    QuoteIcon,
    type LucideIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import type { SurfaceItem } from '~/lib/surface';
import { KIND_ICONS, KIND_NAMES } from './kind-icons';
import { useSurfaceItems } from './surface-context';

/** How many choices a picker shows at once. */
const MAX_MATCHES = 8;

type ItemMatch = {
    key: string;
    itemId: string;
    title: string;
    kind: SurfaceItem['kind'];
};

type Command =
    | { run: 'style'; style: 'normal' | 'h2' | 'h3' | 'blockquote' }
    | { run: 'list'; listItem: 'bullet' | 'number' }
    | { run: 'embed'; itemId: string };

type CommandMatch = {
    key: string;
    label: string;
    hint: string;
    icon: LucideIcon;
    command: Command;
};

const COMMANDS: CommandMatch[] = [
    {
        key: 'normal',
        label: 'Text',
        hint: 'Plain paragraph',
        icon: PilcrowIcon,
        command: { run: 'style', style: 'normal' },
    },
    {
        key: 'h2',
        label: 'Heading',
        hint: '##',
        icon: Heading2Icon,
        command: { run: 'style', style: 'h2' },
    },
    {
        key: 'h3',
        label: 'Subheading',
        hint: '###',
        icon: Heading3Icon,
        command: { run: 'style', style: 'h3' },
    },
    {
        key: 'quote',
        label: 'Quote',
        hint: '>',
        icon: QuoteIcon,
        command: { run: 'style', style: 'blockquote' },
    },
    {
        key: 'bullet',
        label: 'Bulleted list',
        hint: '-',
        icon: ListIcon,
        command: { run: 'list', listItem: 'bullet' },
    },
    {
        key: 'number',
        label: 'Numbered list',
        hint: '1.',
        icon: ListOrderedIcon,
        command: { run: 'list', listItem: 'number' },
    },
];

function matchesKeyword(text: string, keyword: string) {
    return text.toLowerCase().includes(keyword.trim().toLowerCase());
}

/**
 * The items a picker can offer, read through a ref: picker definitions are
 * made once, but the surface's items change as the route polls.
 */
function useItemsRef(documentId: string) {
    const { items } = useSurfaceItems();
    const ref = useRef<SurfaceItem[]>([]);
    useLayoutEffect(() => {
        ref.current = items.filter((item) => item.id !== documentId);
    });
    return ref;
}

/**
 * `@` then part of an item's name: picks an item and links the text to it
 * (an `itemRef`, shown as a chip).
 */
export function ItemLinkPicker({ documentId }: { documentId: string }) {
    const items = useItemsRef(documentId);
    const definition = useMemo(
        () =>
            defineTypeaheadPicker<ItemMatch>({
                trigger: /@/,
                keyword: /[^\s@]*/,
                getMatches: ({ keyword }) =>
                    items.current
                        .filter((item) => matchesKeyword(item.title, keyword))
                        .slice(0, MAX_MATCHES)
                        .map((item) => ({
                            key: item.id,
                            itemId: item.id,
                            title: item.title,
                            kind: item.kind,
                        })),
                onSelect: [
                    ({ event }) => [
                        raise({ type: 'delete', at: event.patternSelection }),
                        raise({
                            type: 'insert.span',
                            text: event.match.title,
                            annotations: [
                                {
                                    name: 'itemRef',
                                    value: { itemId: event.match.itemId },
                                },
                            ],
                        }),
                        // A plain space after, so typing on isn't linked.
                        raise({ type: 'insert.span', text: ' ' }),
                    ],
                ],
            }),
        [items],
    );
    const picker = useTypeaheadPicker(definition);
    if (picker.snapshot.matches('idle')) return null;
    const { matches, selectedIndex } = picker.snapshot.context;

    return (
        <PickerPopover label="Link an item">
            {matches.length === 0 ? (
                <PickerEmpty>No items match.</PickerEmpty>
            ) : (
                matches.map((match, index) => {
                    const Icon = KIND_ICONS[match.kind];
                    return (
                        <PickerOption
                            key={match.key}
                            selected={index === selectedIndex}
                            onHover={() =>
                                picker.send({ type: 'navigate to', index })
                            }
                            onChoose={() => picker.send({ type: 'select' })}
                            icon={Icon}
                            label={match.title}
                            hint={KIND_NAMES[match.kind]}
                        />
                    );
                })
            )}
        </PickerPopover>
    );
}

/**
 * `/` at the start of a block: turns it into a heading, quote, or list, or
 * puts a card for an item there (an `itemEmbed`).
 */
export function InsertMenuPicker({ documentId }: { documentId: string }) {
    const items = useItemsRef(documentId);
    const definition = useMemo(
        () =>
            defineTypeaheadPicker<CommandMatch>({
                trigger: /^\//,
                keyword: /[^\n]*/,
                getMatches: ({ keyword }) =>
                    [
                        ...COMMANDS,
                        ...items.current.map((item) => ({
                            key: `embed:${item.id}`,
                            label: item.title,
                            hint: `Embed ${KIND_NAMES[item.kind].toLowerCase()}`,
                            icon: KIND_ICONS[item.kind],
                            command: {
                                run: 'embed' as const,
                                itemId: item.id,
                            },
                        })),
                    ]
                        .filter(
                            (match) =>
                                matchesKeyword(match.label, keyword) ||
                                matchesKeyword(match.hint, keyword),
                        )
                        .slice(0, MAX_MATCHES),
                onSelect: [
                    ({ event }) => {
                        const remove = raise({
                            type: 'delete',
                            at: event.patternSelection,
                        });
                        const { command } = event.match;
                        if (command.run === 'style') {
                            return [
                                remove,
                                raise({
                                    type: 'style.toggle',
                                    style: command.style,
                                }),
                            ];
                        }
                        if (command.run === 'list') {
                            return [
                                remove,
                                raise({
                                    type: 'list item.toggle',
                                    listItem: command.listItem,
                                }),
                            ];
                        }
                        return [
                            remove,
                            raise({
                                type: 'insert.block',
                                block: {
                                    _type: 'itemEmbed',
                                    itemId: command.itemId,
                                },
                                placement: 'auto',
                                select: 'end',
                            }),
                        ];
                    },
                ],
            }),
        [items],
    );
    const picker = useTypeaheadPicker(definition);
    if (picker.snapshot.matches('idle')) return null;
    const { matches, selectedIndex } = picker.snapshot.context;

    return (
        <PickerPopover label="Insert">
            {matches.length === 0 ? (
                <PickerEmpty>Nothing matches.</PickerEmpty>
            ) : (
                matches.map((match, index) => (
                    <PickerOption
                        key={match.key}
                        selected={index === selectedIndex}
                        onHover={() =>
                            picker.send({ type: 'navigate to', index })
                        }
                        onChoose={() => picker.send({ type: 'select' })}
                        icon={match.icon}
                        label={match.label}
                        hint={match.hint}
                    />
                ))
            )}
        </PickerPopover>
    );
}

/** Where the caret is on screen, or null without a selection. */
function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 ? null : rect;
}

type PopoverProps = {
    label: string;
    children: ReactNode;
};

/**
 * A listbox under the caret, portaled to the body: the canvas is CSS
 * transformed, which would make `position: fixed` relative to it.
 */
function PickerPopover({ label, children }: PopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    // Placed straight on the element after each render (the caret moves as
    // you type), hidden until it has a spot.
    useLayoutEffect(() => {
        const element = ref.current;
        const rect = caretRect();
        if (!element || !rect) return;
        const left = Math.min(rect.left, window.innerWidth - 296);
        const top =
            rect.bottom + 320 > window.innerHeight
                ? Math.max(8, rect.top - 324)
                : rect.bottom + 6;
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.visibility = 'visible';
    });

    return createPortal(
        <div
            ref={ref}
            role="listbox"
            aria-label={label}
            // Keep focus (and the caret) in the editor.
            onMouseDown={(event) => event.preventDefault()}
            style={{ visibility: 'hidden' }}
            className="bg-popover text-popover-foreground fixed z-50 flex max-h-80 w-72 scrollbar-none flex-col overflow-y-auto rounded-lg border p-1 shadow-lg"
        >
            {children}
        </div>,
        document.body,
    );
}

type OptionProps = {
    selected: boolean;
    onHover: () => void;
    onChoose: () => void;
    icon: LucideIcon;
    label: string;
    hint: string;
};

function PickerOption({
    selected,
    onHover,
    onChoose,
    icon: Icon,
    label,
    hint,
}: OptionProps) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    return (
        <div
            ref={ref}
            role="option"
            aria-selected={selected}
            onMouseEnter={onHover}
            onClick={onChoose}
            className={cx(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm pointer-coarse:py-2.5',
                selected && 'bg-accent',
            )}
        >
            <Icon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
                {hint}
            </span>
        </div>
    );
}

function PickerEmpty({ children }: { children: ReactNode }) {
    return (
        <p className="text-muted-foreground px-2 py-1.5 text-sm">{children}</p>
    );
}
