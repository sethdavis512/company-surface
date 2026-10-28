import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
    Command,
    CommandCollection,
    CommandDialog,
    CommandDialogPopup,
    CommandEmpty,
    CommandFooter,
    CommandGroup,
    CommandGroupLabel,
    CommandInput,
    CommandItem,
    CommandList,
    CommandPanel,
} from '~/components/ui/command';
import { createSurfaceSearch, type SearchHit } from '~/lib/search';
import { useAddCard } from './AddCard';
import {
    type Person,
    type SurfaceItem,
    type SurfaceItemKind,
} from '~/lib/surface';
import { KIND_ICONS, KIND_NAMES } from './kind-icons';
import { ZOOM_DURATION_MS, useZoomToWindow } from './ZoomOverlay';
import { useSurfaceLinks } from './surface-context';

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    items: SurfaceItem[];
    people: Person[];
    /** Shown before you type: the items you opened last. */
    recent: SurfaceItem[];
    /** An item is focused: picking a hit focuses that one instead. */
    focused: boolean;
};

/** "Add …" in the palette: a new card, like the canvas's Add card menu. */
type AddCommand = {
    add: SurfaceItemKind;
    label: string;
};

type Entry = SearchHit | AddCommand;
type Group = { value: string; items: Entry[] };

const ADD_COMMANDS: AddCommand[] = [
    { add: 'chat', label: 'Add chat' },
    { add: 'document', label: 'Add document' },
    { add: 'board', label: 'Add board' },
    { add: 'note', label: 'Add sticky note' },
    { add: 'sketch', label: 'Add sketch' },
    { add: 'video', label: 'Add video…' },
    { add: 'web', label: 'Add web page…' },
    { add: 'image', label: 'Add image…' },
];

function isAdd(entry: Entry): entry is AddCommand {
    return 'add' in entry;
}

/** Add commands whose words the query starts (all of them when empty). */
function addCommandsFor(query: string): AddCommand[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return ADD_COMMANDS.filter((command) => {
        const label = command.label.toLowerCase().replace('…', '');
        return words.every((word) =>
            label.split(' ').some((part) => part.startsWith(word)),
        );
    });
}

/**
 * ⌘K search over everything on the surface (`createSurfaceSearch`), grouped
 * by kind in the order of each kind's best hit. Enter zooms the canvas to
 * the window at 100% (or focuses it, when something is already focused);
 * ⌘Enter always focuses. A hit inside a chat or board also brings that
 * message or issue into view and flashes it.
 */
export function SearchPalette({
    open,
    onOpenChange,
    items,
    people,
    recent,
    focused,
}: Props) {
    const links = useSurfaceLinks();
    const [query, setQuery] = useState('');
    const navigate = useNavigate();
    const zoomToWindow = useZoomToWindow();
    const { add: addCard } = useAddCard();
    const highlighted = useRef<Entry | undefined>(undefined);

    const search = useMemo(() => {
        const names = new Map(people.map((person) => [person.id, person.name]));
        return createSurfaceSearch(items, { nameOf: (id) => names.get(id) });
    }, [items, people]);

    const groups = useMemo((): Group[] => {
        const adds = addCommandsFor(query);
        const addGroup: Group[] =
            adds.length > 0 ? [{ value: 'Add', items: adds }] : [];
        if (!query.trim()) {
            const recentGroup: Group[] =
                recent.length > 0
                    ? [
                          {
                              value: 'Recent',
                              items: recent.map((item) => ({
                                  itemId: item.id,
                                  kind: item.kind,
                                  title: item.title,
                                  snippet: '',
                                  ranges: [],
                                  score: 0,
                              })),
                          },
                      ]
                    : [];
            return [...recentGroup, ...addGroup];
        }
        const byKind = new Map<string, SearchHit[]>();
        for (const hit of search.search(query).hits) {
            const label = KIND_NAMES[hit.kind];
            byKind.set(label, [...(byKind.get(label) ?? []), hit]);
        }
        return [
            ...[...byKind].map(([value, hits]) => ({ value, items: hits })),
            ...addGroup,
        ];
    }, [query, recent, search]);

    function runAdd(command: AddCommand) {
        onOpenChange(false);
        setQuery('');
        addCard(command.add);
    }

    function choose(hit: SearchHit, focus: boolean) {
        onOpenChange(false);
        setQuery('');
        if (focus || focused || !zoomToWindow(hit.itemId)) {
            void navigate(links.item(hit.itemId));
            return;
        }
        if (hit.subId) {
            // Once the canvas has landed.
            setTimeout(() => revealInside(hit), ZOOM_DURATION_MS + 50);
        }
    }

    return (
        <CommandDialog
            open={open}
            onOpenChange={(next) => {
                onOpenChange(next);
                if (!next) setQuery('');
            }}
        >
            <CommandDialogPopup aria-label="Search the surface">
                <Command
                    items={groups}
                    filteredItems={groups}
                    value={query}
                    onValueChange={setQuery}
                    itemToStringValue={(entry) =>
                        isAdd(entry as Entry)
                            ? (entry as AddCommand).label
                            : (entry as SearchHit).title
                    }
                    onItemHighlighted={(hit) => {
                        highlighted.current = hit as Entry | undefined;
                    }}
                >
                    <CommandInput
                        aria-label="Search"
                        placeholder="Search chats, documents, issues, pages…"
                        onKeyDown={(event) => {
                            if (
                                event.key === 'Enter' &&
                                (event.metaKey || event.ctrlKey) &&
                                highlighted.current
                            ) {
                                event.preventDefault();
                                const entry = highlighted.current;
                                if (isAdd(entry)) runAdd(entry);
                                else choose(entry, true);
                            }
                        }}
                    />
                    <CommandPanel>
                        <CommandEmpty>
                            {query.trim()
                                ? 'Nothing on the surface matches.'
                                : 'Type to search everything on the surface.'}
                        </CommandEmpty>
                        <CommandList>
                            {(group: Group) => (
                                <Fragment key={group.value}>
                                    <CommandGroup items={group.items}>
                                        <CommandGroupLabel>
                                            {group.value}
                                        </CommandGroupLabel>
                                        <CommandCollection>
                                            {(entry: Entry) =>
                                                isAdd(entry) ? (
                                                    <AddItem
                                                        key={entry.add}
                                                        command={entry}
                                                        onChoose={() =>
                                                            runAdd(entry)
                                                        }
                                                    />
                                                ) : (
                                                    <HitItem
                                                        key={`${entry.itemId}:${entry.subId ?? ''}`}
                                                        hit={entry}
                                                        onChoose={() =>
                                                            choose(entry, false)
                                                        }
                                                    />
                                                )
                                            }
                                        </CommandCollection>
                                    </CommandGroup>
                                </Fragment>
                            )}
                        </CommandList>
                    </CommandPanel>
                    <CommandFooter>
                        <span className="text-muted-foreground flex gap-4 text-xs">
                            <span>
                                <kbd className="font-sans">↵</kbd>{' '}
                                {focused ? 'Open' : 'Zoom to'}
                            </span>
                            <span>
                                <kbd className="font-sans">⌘↵</kbd> Focus
                            </span>
                            <span>
                                <kbd className="font-sans">esc</kbd> Close
                            </span>
                        </span>
                    </CommandFooter>
                </Command>
            </CommandDialogPopup>
        </CommandDialog>
    );
}

function AddItem({
    command,
    onChoose,
}: {
    command: AddCommand;
    onChoose: () => void;
}) {
    const Icon = KIND_ICONS[command.add];
    return (
        <CommandItem value={command} onClick={onChoose} className="gap-2.5">
            <Icon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
            />
            <span className="truncate">{command.label}</span>
        </CommandItem>
    );
}

function HitItem({ hit, onChoose }: { hit: SearchHit; onChoose: () => void }) {
    const Icon = KIND_ICONS[hit.kind];
    return (
        <CommandItem
            value={hit}
            onClick={onChoose}
            className="items-start gap-2.5"
        >
            <Icon
                aria-hidden="true"
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
            />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                    {hit.title}
                    {hit.subLabel && (
                        <span className="text-muted-foreground">
                            {' '}
                            · {hit.subLabel}
                        </span>
                    )}
                </span>
                {hit.snippet && (
                    <span className="text-muted-foreground line-clamp-2 text-xs">
                        <Marked text={hit.snippet} ranges={hit.ranges} />
                    </span>
                )}
            </span>
        </CommandItem>
    );
}

/** The snippet with its matched words marked. */
function Marked({
    text,
    ranges,
}: {
    text: string;
    ranges: [number, number][];
}) {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const [start, end] of ranges) {
        if (start < at) continue;
        parts.push(text.slice(at, start));
        parts.push(
            <mark
                key={start}
                className="text-foreground bg-transparent font-semibold"
            >
                {text.slice(start, end)}
            </mark>,
        );
        at = end;
    }
    parts.push(text.slice(at));
    return <>{parts}</>;
}

/**
 * Brings a message or issue into view inside its window's own scroll area
 * (not the page: the canvas would shift) and flashes it.
 */
function revealInside(hit: SearchHit) {
    const node = document.querySelector(`[data-node-id="${hit.itemId}"]`);
    const target = node?.querySelector<HTMLElement>(
        `[data-message-id="${hit.subId}"], [data-issue-id="${hit.subId}"]`,
    );
    if (!target) return;
    const scroller = target.closest<HTMLElement>(
        '.overflow-y-auto, .overflow-auto',
    );
    if (scroller) {
        const offset =
            target.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
        scroller.scrollTop += offset - scroller.clientHeight / 2;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    target.animate(
        [
            { boxShadow: '0 0 0 3px var(--color-ring)' },
            { boxShadow: '0 0 0 3px transparent' },
        ],
        { duration: 1600, easing: 'ease-out' },
    );
}
