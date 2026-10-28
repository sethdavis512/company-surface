import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Form, useNavigate, useSubmit } from 'react-router';
import {
    BotIcon,
    ChartColumnIcon,
    FileTextIcon,
    GitPullRequestIcon,
    KanbanSquareIcon,
    ListFilterIcon,
    SearchIcon,
    MessageCircleIcon,
    SquarePlayIcon,
    GlobeIcon,
    ImageIcon,
    StickyNoteIcon,
    PaletteIcon,
    type LucideIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import {
    WINDOW_COLOR_NAMES,
    isAgentMade,
    type SurfaceItemKind,
    type WindowColor,
} from '~/lib/surface';
import { WINDOW_COLORS } from './window-colors';

export type SurfaceFilter = {
    kind: SurfaceItemKind | null;
    color: WindowColor | null;
    /** Only what agents made. */
    agentOnly: boolean;
};

export const NO_FILTER: SurfaceFilter = {
    kind: null,
    color: null,
    agentOnly: false,
};

/** Whether an item passes the filter. Every part that's set has to match. */
export function matchesFilter(
    filter: SurfaceFilter,
    item: { kind: SurfaceItemKind; createdById: string },
    color: WindowColor | undefined,
) {
    return (
        (!filter.kind || item.kind === filter.kind) &&
        (!filter.color || color === filter.color) &&
        (!filter.agentOnly || isAgentMade(item))
    );
}

const KINDS: { kind: SurfaceItemKind; label: string; icon: LucideIcon }[] = [
    { kind: 'chat', label: 'Chats', icon: MessageCircleIcon },
    { kind: 'document', label: 'Documents', icon: FileTextIcon },
    { kind: 'pull-request', label: 'Pull requests', icon: GitPullRequestIcon },
    { kind: 'chart', label: 'Charts', icon: ChartColumnIcon },
    { kind: 'board', label: 'Boards', icon: KanbanSquareIcon },
    { kind: 'video', label: 'Videos', icon: SquarePlayIcon },
    { kind: 'web', label: 'Web', icon: GlobeIcon },
    { kind: 'image', label: 'Images', icon: ImageIcon },
    { kind: 'note', label: 'Notes', icon: StickyNoteIcon },
    { kind: 'sketch', label: 'Sketches', icon: PaletteIcon },
];

type Props = {
    filter: SurfaceFilter;
    onChange: (filter: SurfaceFilter) => void;
    /** How many windows match, out of how many. */
    shown: number;
    total: number;
    /** The search in the URL (`?q=`); cards it doesn't find dim too. */
    query: string;
};

/**
 * A row of filters pinned to the top of the canvas. Search (by what's in
 * the windows), pick a kind, who made it (agents), a border color, or any
 * mix; windows that don't match dim. Picking the active one again clears
 * it, and All clears everything. The search is a GET form, so it lives in
 * the URL (`?q=`): shareable, and kept on reload.
 */
export function FilterBar({ filter, onChange, shown, total, query }: Props) {
    const submit = useSubmit();
    const navigate = useNavigate();
    const searchRef = useRef<HTMLInputElement>(null);
    // The field is uncontrolled (typing submits the form), so when the URL
    // changes some other way (All, back/forward) set it to match. Never
    // while you're typing in it, and never by remounting it, which would
    // drop focus after the first character.
    useEffect(() => {
        const input = searchRef.current;
        if (
            input &&
            input !== document.activeElement &&
            input.value !== query
        ) {
            input.value = query;
        }
    }, [query]);
    const chipsActive =
        filter.kind !== null || filter.color !== null || filter.agentOnly;
    const active = chipsActive || query !== '';
    const count =
        Number(filter.kind !== null) +
        Number(filter.color !== null) +
        Number(filter.agentOnly) +
        Number(query !== '');

    // Folded to a pill until you reach for it: hovering, focusing, or
    // clicking it opens the whole bar, which folds again once the pointer
    // and focus have both left.
    const [open, setOpen] = useState(false);
    const barRef = useRef<HTMLDivElement>(null);
    const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(closing.current), []);
    function openBar() {
        clearTimeout(closing.current);
        setOpen(true);
    }
    function closeSoon() {
        clearTimeout(closing.current);
        closing.current = setTimeout(() => {
            if (!barRef.current?.contains(document.activeElement)) {
                setOpen(false);
            }
        }, CLOSE_DELAY_MS);
    }

    return (
        <div
            ref={barRef}
            role="toolbar"
            aria-label="Filter cards"
            onPointerEnter={openBar}
            onPointerLeave={closeSoon}
            onFocus={openBar}
            onBlur={(event) => {
                if (!barRef.current?.contains(event.relatedTarget)) closeSoon();
            }}
            className="bg-card pointer-events-auto flex max-w-full scrollbar-none items-center gap-1 overflow-x-auto rounded-full border p-1 shadow-md"
        >
            {!open ? (
                <button
                    type="button"
                    aria-expanded={false}
                    onClick={() => {
                        openBar();
                        // Straight to typing a search.
                        requestAnimationFrame(() => searchRef.current?.focus());
                    }}
                    className="hover:bg-accent focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm outline-none focus-visible:ring-2 pointer-coarse:h-10"
                >
                    <ListFilterIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4"
                    />
                    <span className="font-medium">Filter</span>
                    {active && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {count} on · {shown} of {total}
                        </span>
                    )}
                </button>
            ) : (
                <>
                    <ListFilterIcon
                        aria-hidden="true"
                        className="text-muted-foreground ms-2 me-1 size-4 shrink-0"
                    />
                    <Form
                        method="get"
                        role="search"
                        // Every keystroke replaces the URL rather than stacking up
                        // history entries.
                        onChange={(event) =>
                            void submit(event.currentTarget, {
                                replace: true,
                                preventScrollReset: true,
                            })
                        }
                        className="relative shrink-0"
                    >
                        <SearchIcon
                            aria-hidden="true"
                            className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2"
                        />
                        <input
                            ref={searchRef}
                            type="search"
                            name="q"
                            aria-label="Search cards"
                            placeholder="Search"
                            defaultValue={query}
                            onKeyDown={(event) => event.stopPropagation()}
                            className="bg-muted/60 focus-visible:ring-ring placeholder:text-muted-foreground h-7 w-32 rounded-full ps-8 pe-3 text-sm outline-none focus-visible:w-44 focus-visible:ring-2 motion-safe:transition-[width] pointer-coarse:h-10 [&:not(:placeholder-shown)]:w-44"
                        />
                    </Form>
                    <Chip
                        pressed={!active}
                        onClick={() => {
                            onChange(NO_FILTER);
                            if (query) {
                                if (searchRef.current)
                                    searchRef.current.value = '';
                                void navigate(
                                    { search: '' },
                                    { replace: true },
                                );
                            }
                        }}
                    >
                        All
                    </Chip>
                    {KINDS.map(({ kind, label, icon: Icon }) => (
                        <Chip
                            key={kind}
                            pressed={filter.kind === kind}
                            onClick={() =>
                                onChange({
                                    ...filter,
                                    kind: filter.kind === kind ? null : kind,
                                })
                            }
                        >
                            <Icon aria-hidden="true" className="size-3.5" />
                            {label}
                        </Chip>
                    ))}
                    <span
                        aria-hidden="true"
                        className="bg-border mx-1 h-5 w-px"
                    />
                    <Chip
                        pressed={filter.agentOnly}
                        onClick={() =>
                            onChange({
                                ...filter,
                                agentOnly: !filter.agentOnly,
                            })
                        }
                    >
                        <BotIcon aria-hidden="true" className="size-3.5" />
                        By agent
                    </Chip>
                    <span
                        aria-hidden="true"
                        className="bg-border mx-1 h-5 w-px"
                    />
                    {WINDOW_COLOR_NAMES.map((color) => (
                        <button
                            key={color}
                            type="button"
                            aria-label={`${WINDOW_COLORS[color].label} border`}
                            aria-pressed={filter.color === color}
                            title={`${WINDOW_COLORS[color].label} border`}
                            onClick={() =>
                                onChange({
                                    ...filter,
                                    color:
                                        filter.color === color ? null : color,
                                })
                            }
                            className="focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 pointer-coarse:size-10"
                        >
                            <span
                                aria-hidden="true"
                                className={cx(
                                    'size-4 rounded-full transition-shadow',
                                    WINDOW_COLORS[color].swatch,
                                    filter.color === color &&
                                        'ring-foreground ring-offset-card ring-2 ring-offset-2',
                                )}
                            />
                        </button>
                    ))}
                    {active && (
                        <span
                            aria-live="polite"
                            className="text-muted-foreground shrink-0 px-2 text-xs tabular-nums"
                        >
                            {shown} of {total}
                        </span>
                    )}
                </>
            )}
        </div>
    );
}

/** How long the bar waits, after the pointer and focus leave, to fold. */
const CLOSE_DELAY_MS = 400;

type ChipProps = {
    pressed: boolean;
    onClick: () => void;
    children: ReactNode;
};

function Chip({ pressed, onClick, children }: ChipProps) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cx(
                'focus-visible:ring-ring flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap outline-none focus-visible:ring-2 pointer-coarse:py-2',
                pressed
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-accent',
            )}
        >
            {children}
        </button>
    );
}
