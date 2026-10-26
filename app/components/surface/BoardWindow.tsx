import {
    createContext,
    use,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
    useId,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useFetchers, useSubmit } from 'react-router';
import {
    Handle,
    useFlowState,
    type FlowNode,
    type NodeProps,
} from '@sethdavis512/trellis';
import {
    DndContext,
    DragOverlay,
    KeyboardCode,
    KeyboardSensor,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type Announcements,
    type ClientRect,
    type CollisionDetection,
    type DragEndEvent,
    type DragMoveEvent,
    type DragStartEvent,
    type KeyboardCoordinateGetter,
    type UniqueIdentifier,
} from '@dnd-kit/core';
import {
    ChartColumnIcon,
    FileTextIcon,
    GitPullRequestIcon,
    GripVerticalIcon,
    KanbanSquareIcon,
    MessageCircleIcon,
    SquarePlayIcon,
    GlobeIcon,
    ImageIcon,
    StickyNoteIcon,
    PaletteIcon,
    ShapesIcon,
    PlusIcon,
    type LucideIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import {
    Menu,
    MenuPopup,
    MenuRadioGroup,
    MenuRadioItem,
    MenuTrigger,
} from '~/components/ui/menu';
import {
    ISSUE_STATUSES,
    isAgentMade,
    placeIssue,
    type BoardItem,
    type Issue,
    type IssueStatus,
    type SurfaceItemKind,
} from '~/lib/surface';
import { AgentBadge, AgentIcon, AgentStripe } from './AgentMark';
import { Avatar } from './Avatar';
import {
    FocusedItemContext,
    useSurfaceItems,
    useSurfacePeople,
    useWindowColors,
    useSurfaceLinks,
} from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';
import { ISSUE_STATUS, PRIORITY } from './issue-looks';
import { IssueDetail } from './IssueDetail';

export type BoardNode = FlowNode<{ item: BoardItem }, 'board'>;

/** Opens an issue's detail in its board (set by `BoardWindow`). */
const OpenIssueContext = createContext<((issueId: string) => void) | null>(
    null,
);

const LINK_ICONS: Record<SurfaceItemKind, LucideIcon> = {
    chat: MessageCircleIcon,
    document: FileTextIcon,
    'pull-request': GitPullRequestIcon,
    chart: ChartColumnIcon,
    board: KanbanSquareIcon,
    video: SquarePlayIcon,
    web: GlobeIcon,
    image: ImageIcon,
    note: StickyNoteIcon,
    sketch: PaletteIcon,
    shape: ShapesIcon,
};

function isStatus(id: UniqueIdentifier): id is IssueStatus {
    return (ISSUE_STATUSES as readonly UniqueIdentifier[]).includes(id);
}

/** Where a dropped issue will go: a column and its place there (top = 0). */
type DropSpot = { status: IssueStatus; index: number };

function centerOf(rect: ClientRect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The issues in a column on screen, top to bottom, leaving out the one being
 * dragged. Read from the DOM (screen pixels), the same space dnd-kit uses,
 * so canvas zoom never enters into it.
 */
function issueRects(board: HTMLElement, status: IssueStatus, skipId: string) {
    return [
        ...board.querySelectorAll<HTMLElement>(
            `[data-issue-status="${status}"]`,
        ),
    ]
        .filter((issue) => issue.dataset.issueId !== skipId)
        .map((issue) => issue.getBoundingClientRect());
}

/** The place in a column an issue centered at `y` drops into. */
function indexAt(rects: DOMRect[], y: number) {
    return rects.filter((rect) => rect.top + rect.height / 2 < y).length;
}

/**
 * The y of each place an issue can drop into a column (the lines drawn while
 * dragging): above the first issue, between issues, below the last.
 */
function slotLines(board: HTMLElement, status: IssueStatus, skipId: string) {
    const rects = issueRects(board, status, skipId);
    if (rects.length === 0) {
        const list = board
            .querySelector(`[data-column-list="${status}"]`)!
            .getBoundingClientRect();
        return [list.top + 24];
    }
    return [
        rects[0]!.top - 3,
        ...rects.slice(1).map((rect, i) => (rects[i]!.bottom + rect.top) / 2),
        rects.at(-1)!.bottom + 3,
    ];
}

/**
 * The column the dragged issue's center is over, or the nearest one across.
 * Columns are the only drop targets; the place within one comes from
 * `indexAt`.
 */
const columnUnderIssue: CollisionDetection = ({
    collisionRect,
    droppableRects,
    droppableContainers,
}) => {
    const center = centerOf(collisionRect);
    const ranked = droppableContainers
        .map((container) => {
            const rect = droppableRects.get(container.id);
            if (!rect) return null;
            const inside = center.x >= rect.left && center.x <= rect.right;
            const distance = inside
                ? 0
                : Math.min(
                      Math.abs(center.x - rect.left),
                      Math.abs(center.x - rect.right),
                  );
            return {
                id: container.id,
                data: { droppableContainer: container, value: distance },
            };
        })
        .filter((hit) => hit !== null)
        .sort((a, b) => a.data.value - b.data.value);
    return ranked.slice(0, 1);
};

/**
 * The board's issues with moves and new issues still on their way to the
 * server applied on top, so a drop or a new issue shows at once.
 */
function usePendingIssues(board: BoardItem) {
    const fetchers = useFetchers();
    const { meId } = useSurfacePeople();
    let issues = board.issues;
    for (const { formData, key } of fetchers) {
        if (formData?.get('boardId') !== board.id) continue;
        const intent = formData.get('intent');
        if (intent === 'move-issue') {
            const index = formData.get('index');
            issues = placeIssue(
                issues,
                String(formData.get('issueId')),
                formData.get('status') as IssueStatus,
                index === null ? undefined : Number(index),
            );
        } else if (intent === 'create-issue') {
            issues = [
                ...issues,
                {
                    id: `pending-${key}`,
                    identifier: `${board.key}-…`,
                    title: String(formData.get('title')),
                    status: formData.get('status') as IssueStatus,
                    priority: 'none',
                    links: [],
                    createdById: meId,
                    updatedAt: new Date().toISOString(),
                },
            ];
        }
    }
    return issues;
}

/** Keys pressed on a control inside an issue stay there, so Enter on a link or the status menu doesn't pick the issue up. */
function keepKeys(event: KeyboardEvent) {
    event.stopPropagation();
}

/**
 * An issue board, like a Linear project: issues in status columns.
 *
 * Dragging follows Sprocket's kanban (dnd-kit, a grip handle per issue): the
 * other issues stay still, every column outlines itself as a target, and a
 * line marks exactly where the issue will land, which is where it lands.
 * Mouse and touch start from the handle (touch-action: none, so no press
 * delay); the keyboard picks an issue up with Space, moves the line with the
 * arrow keys (up and down between places, left and right between columns),
 * and drops with Space. The issue's status menu moves it too, and each
 * column files new issues inline.
 *
 * The canvas is scaled by its zoom while dnd-kit measures screen pixels, so
 * the dragged issue renders in an overlay outside the canvas (scaled to
 * match), and everything about where it lands is measured on screen.
 */
export function BoardWindow({ data, selected }: NodeProps<BoardNode>) {
    const links = useSurfaceLinks();
    const board = data.item;
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === board.id;
    const submit = useSubmit();
    const zoom = useFlowState((s) => s.viewport.zoom);
    const issues = usePendingIssues(board);
    const boardRef = useRef<HTMLDivElement>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    // The issue open in detail, in place of the columns.
    const [openIssueId, setOpenIssueId] = useState<string | null>(null);
    const openIssue = issues.find((issue) => issue.id === openIssueId);
    const [spot, setSpot] = useState<DropSpot | null>(null);
    const active = issues.find((issue) => issue.id === activeId);

    // Arrow keys move the dragged issue's center onto the next drop line (up
    // and down) or into the next column (left and right).
    const keyboardCoordinates: KeyboardCoordinateGetter = (
        event,
        { currentCoordinates, context },
    ) => {
        const boardElement = boardRef.current;
        const rect = context.collisionRect;
        const dragged = context.active?.id;
        if (!boardElement || !rect || dragged === undefined) return undefined;
        const center = centerOf(rect);
        const status =
            (context.over?.id as IssueStatus | undefined) ??
            issues.find((issue) => issue.id === dragged)?.status;
        if (!status) return undefined;
        const lines = slotLines(boardElement, status, String(dragged));
        const shift = (x: number, y: number) => ({
            x: currentCoordinates.x + x - center.x,
            y: currentCoordinates.y + y - center.y,
        });

        switch (event.code) {
            case KeyboardCode.Down: {
                const next = lines.find((line) => line > center.y + 1);
                return next === undefined ? undefined : shift(center.x, next);
            }
            case KeyboardCode.Up: {
                const previous = [...lines]
                    .reverse()
                    .find((line) => line < center.y - 1);
                return previous === undefined
                    ? undefined
                    : shift(center.x, previous);
            }
            case KeyboardCode.Right:
            case KeyboardCode.Left: {
                const step = event.code === KeyboardCode.Right ? 1 : -1;
                const next =
                    ISSUE_STATUSES[ISSUE_STATUSES.indexOf(status) + step];
                if (!next) return undefined;
                const list = boardElement
                    .querySelector(`[data-column-list="${next}"]`)!
                    .getBoundingClientRect();
                const targetLines = slotLines(
                    boardElement,
                    next,
                    String(dragged),
                );
                // Keep the row: the line nearest where the issue is now.
                const y = targetLines.reduce((best, line) =>
                    Math.abs(line - center.y) < Math.abs(best - center.y)
                        ? line
                        : best,
                );
                return shift(list.left + list.width / 2, y);
            }
        }
        return undefined;
    };

    // A stable id, so the server and client agree on dnd-kit's aria ids.
    const dndId = useId();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
    );

    /** Where the issue would land right now, from its center on screen. */
    function spotFor(
        over: UniqueIdentifier | undefined,
        rect: ClientRect | null | undefined,
        dragged: string,
    ): DropSpot | null {
        const boardElement = boardRef.current;
        if (!boardElement || !rect || over === undefined || !isStatus(over)) {
            return null;
        }
        const rects = issueRects(boardElement, over, dragged);
        return { status: over, index: indexAt(rects, centerOf(rect).y) };
    }

    function move(issueId: string, status: IssueStatus, index: number) {
        void submit(
            {
                intent: 'move-issue',
                boardId: board.id,
                issueId,
                status,
                index: String(index),
            },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `move-issue:${issueId}`,
            },
        );
    }

    function create(status: IssueStatus, title: string) {
        void submit(
            { intent: 'create-issue', boardId: board.id, title, status },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `create-issue:${crypto.randomUUID()}`,
            },
        );
    }

    function handleDragStart({ active: dragged }: DragStartEvent) {
        setActiveId(String(dragged.id));
        setSpot(null);
    }

    function handleDragMove({ active: dragged, over }: DragMoveEvent) {
        const next = spotFor(
            over?.id,
            dragged.rect.current.translated,
            String(dragged.id),
        );
        setSpot((current) =>
            current?.status === next?.status && current?.index === next?.index
                ? current
                : next,
        );
    }

    function handleDragEnd({ active: dragged, over }: DragEndEvent) {
        const issueId = String(dragged.id);
        const landing =
            spotFor(over?.id, dragged.rect.current.translated, issueId) ?? spot;
        setActiveId(null);
        setSpot(null);
        if (!landing) return;
        const issue = issues.find((candidate) => candidate.id === issueId);
        if (!issue) return;
        const others = issues.filter(
            (candidate) =>
                candidate.status === landing.status && candidate.id !== issueId,
        );
        const current = issues
            .filter((candidate) => candidate.status === issue.status)
            .indexOf(issue);
        const unchanged =
            issue.status === landing.status && current === landing.index;
        if (!unchanged && landing.index <= others.length) {
            move(issueId, landing.status, landing.index);
        }
    }

    const titleOf = (id: UniqueIdentifier) => {
        const issue = issues.find((candidate) => candidate.id === id);
        return issue ? `${issue.identifier} ${issue.title}` : String(id);
    };
    const describe = (landing: DropSpot | null) =>
        landing
            ? `${ISSUE_STATUS[landing.status].label}, position ${landing.index + 1}`
            : 'nowhere';
    const announcements: Announcements = {
        onDragStart: ({ active: dragged }) =>
            `Picked up ${titleOf(dragged.id)}. Arrow keys move it, Space drops it, Escape puts it back.`,
        onDragOver: ({ active: dragged }) =>
            `${titleOf(dragged.id)} will drop in ${describe(spot)}.`,
        onDragMove: ({ active: dragged }) =>
            `${titleOf(dragged.id)} will drop in ${describe(spot)}.`,
        onDragEnd: ({ active: dragged }) =>
            `Dropped ${titleOf(dragged.id)} in ${describe(spot)}.`,
        onDragCancel: ({ active: dragged }) =>
            `Put ${titleOf(dragged.id)} back.`,
    };

    const open = issues.filter((issue) => issue.status !== 'done').length;

    return (
        <div className="group/window relative size-full">
            <Handle type="source" position="top" />
            <LinkHandle />
            <WindowControls
                itemId={board.id}
                title={board.title}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={board.id}
                title={board.title}
                kind="Board"
                rounded="rounded-xl"
            />
            <article
                aria-label={`Board: ${board.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(board.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(board) && <AgentStripe />}
                <header className="flex cursor-grab items-center gap-2 border-b px-4 py-3 active:cursor-grabbing">
                    <KanbanSquareIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4"
                    />
                    <CardTitle
                        itemId={board.id}
                        title={board.title}
                        className="truncate text-sm font-semibold"
                    />
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
                        {board.key}
                    </span>
                    {isAgentMade(board) && <AgentBadge />}
                    <span className="text-muted-foreground ms-auto text-xs">
                        {open} open · {issues.length} total
                    </span>
                </header>

                {openIssue ? (
                    <IssueDetail
                        board={board}
                        issue={openIssue}
                        onClose={() => setOpenIssueId(null)}
                    />
                ) : (
                    <OpenIssueContext.Provider value={setOpenIssueId}>
                        <DndContext
                            id={dndId}
                            sensors={sensors}
                            collisionDetection={columnUnderIssue}
                            onDragStart={handleDragStart}
                            onDragMove={handleDragMove}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => {
                                setActiveId(null);
                                setSpot(null);
                            }}
                            accessibility={{ announcements }}
                        >
                            <div
                                ref={boardRef}
                                className="nodrag nowheel grid min-h-0 flex-1 cursor-auto scrollbar-none grid-cols-5 gap-2 overflow-x-auto p-3"
                            >
                                {ISSUE_STATUSES.map((status) => (
                                    <BoardColumn
                                        key={status}
                                        status={status}
                                        issues={issues.filter(
                                            (issue) => issue.status === status,
                                        )}
                                        activeId={activeId}
                                        lineAt={
                                            spot?.status === status
                                                ? spot.index
                                                : null
                                        }
                                        onMove={(issueId, next) =>
                                            move(
                                                issueId,
                                                next,
                                                issues.filter(
                                                    (issue) =>
                                                        issue.status === next &&
                                                        issue.id !== issueId,
                                                ).length,
                                            )
                                        }
                                        onCreate={(title) =>
                                            create(status, title)
                                        }
                                    />
                                ))}
                            </div>
                            {/* Outside the scaled canvas, scaled back to match it. No
                        drop animation: the issue is already placed by then,
                        so there is nothing to fly back to. */}
                            {typeof document !== 'undefined' &&
                                createPortal(
                                    <DragOverlay dropAnimation={null}>
                                        {active && (
                                            <div
                                                style={{
                                                    width: `${100 / zoom}%`,
                                                    transform: `scale(${zoom})`,
                                                    transformOrigin: '0 0',
                                                }}
                                            >
                                                <BoardIssue
                                                    issue={active}
                                                    lifted
                                                />
                                            </div>
                                        )}
                                    </DragOverlay>,
                                    document.body,
                                )}
                        </DndContext>
                    </OpenIssueContext.Provider>
                )}
            </article>
        </div>
    );
}

type BoardColumnProps = {
    status: IssueStatus;
    issues: Issue[];
    activeId: string | null;
    /** Where the drop line sits, among the issues other than the dragged one. */
    lineAt: number | null;
    onMove: (issueId: string, status: IssueStatus) => void;
    onCreate: (title: string) => void;
};

function BoardColumn({
    status,
    issues,
    activeId,
    lineAt,
    onMove,
    onCreate,
}: BoardColumnProps) {
    const look = ISSUE_STATUS[status];
    const { setNodeRef, isOver } = useDroppable({ id: status });
    const dragging = activeId !== null;
    // Each issue's place among the issues other than the dragged one, which is
    // what the drop line counts in.
    const places = issues.reduce<number[]>((all, issue, i) => {
        const before =
            i === 0
                ? 0
                : all[i - 1]! + (issues[i - 1]!.id === activeId ? 0 : 1);
        return [...all, before];
    }, []);
    const others = issues.filter((issue) => issue.id !== activeId).length;

    return (
        <section
            aria-label={look.label}
            className="bg-muted/50 flex min-h-0 min-w-36 flex-col rounded-lg"
        >
            <h3 className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-2 text-xs font-medium">
                <look.icon
                    aria-hidden="true"
                    className={cx('size-3.5', look.color)}
                />
                {look.label}
                <span className="text-muted-foreground ms-auto tabular-nums">
                    {issues.length}
                </span>
            </h3>
            {/* A 2px border always, so nothing reflows: while an issue moves
                every column outlines itself, and the one it's over fills. */}
            <ol
                ref={setNodeRef}
                data-column-list={status}
                className={cx(
                    'mx-1.5 mb-1.5 flex min-h-16 flex-1 scrollbar-none flex-col gap-1.5 overflow-y-auto rounded-md border-2 p-1 transition-colors',
                    isOver
                        ? 'border-ring bg-accent/60'
                        : dragging
                          ? 'border-ring/40 border-dashed'
                          : 'border-transparent',
                )}
            >
                {issues.map((issue, i) => {
                    const isActive = issue.id === activeId;
                    return [
                        !isActive && lineAt === places[i] && (
                            <DropLine key="line" />
                        ),
                        <DraggableIssue
                            key={issue.id}
                            issue={issue}
                            dimmed={isActive}
                            onMove={(next) => onMove(issue.id, next)}
                        />,
                    ];
                })}
                {lineAt !== null && lineAt >= others && <DropLine />}
            </ol>
            <NewIssue status={status} onCreate={onCreate} />
        </section>
    );
}

/**
 * Marks where a dragged issue will land. Zero height with a negative margin
 * that cancels the list's gap, so it never pushes the issues around.
 */
function DropLine() {
    return (
        <li aria-hidden="true" className="relative -mb-1.5 h-0">
            <span className="bg-ring absolute inset-x-0 -top-[4px] h-0.5 rounded-full" />
        </li>
    );
}

type DraggableIssueProps = {
    issue: Issue;
    /** The original stays in place, faded, while its copy is dragged. */
    dimmed: boolean;
    onMove: (status: IssueStatus) => void;
};

function DraggableIssue({ issue, dimmed, onMove }: DraggableIssueProps) {
    const pending = issue.id.startsWith('pending-');
    const { attributes, listeners, setNodeRef, setActivatorNodeRef } =
        useDraggable({ id: issue.id, disabled: pending });

    return (
        <li
            ref={setNodeRef}
            data-issue-id={issue.id}
            data-issue-status={issue.status}
            aria-label={`${issue.identifier} ${issue.title}`}
            className={cx('rounded-md', dimmed && 'opacity-40')}
        >
            <BoardIssue
                issue={issue}
                onMove={onMove}
                handle={
                    <button
                        type="button"
                        ref={setActivatorNodeRef}
                        {...attributes}
                        {...listeners}
                        aria-roledescription="draggable issue"
                        aria-label={`Move ${issue.identifier} ${issue.title}`}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -my-1 -ms-1.5 flex shrink-0 cursor-grab touch-none items-center rounded px-0.5 py-1 outline-none focus-visible:ring-2 active:cursor-grabbing pointer-coarse:px-1.5 pointer-coarse:py-2"
                    >
                        <GripVerticalIcon
                            aria-hidden="true"
                            className="size-3.5"
                        />
                    </button>
                }
            />
        </li>
    );
}

type BoardIssueProps = {
    issue: Issue;
    onMove?: (status: IssueStatus) => void;
    /** The drag handle; left out, a plain grip icon stands in. */
    handle?: ReactNode;
    /** Drawn in the drag overlay: raised, nothing inside it interactive. */
    lifted?: boolean;
};

function BoardIssue({
    issue,
    onMove,
    handle,
    lifted = false,
}: BoardIssueProps) {
    const links = useSurfaceLinks();
    const { personById } = useSurfacePeople();
    const { titleOf, kindOf } = useSurfaceItems();
    const look = ISSUE_STATUS[issue.status];
    const priority = PRIORITY[issue.priority];
    const pending = issue.id.startsWith('pending-');
    const openIssue = use(OpenIssueContext);

    return (
        <div
            className={cx(
                'bg-card flex flex-col gap-1.5 rounded-md border p-2 text-xs shadow-xs',
                lifted && 'ring-ring rotate-1 shadow-lg ring-1',
                pending && 'opacity-60',
            )}
        >
            <div className="flex items-center gap-1.5">
                {handle ?? (
                    <GripVerticalIcon
                        aria-hidden="true"
                        className="text-muted-foreground -ms-1 size-3.5 shrink-0"
                    />
                )}
                {lifted || !onMove ? (
                    <look.icon
                        aria-hidden="true"
                        className={cx('size-3.5', look.color)}
                    />
                ) : (
                    <Menu>
                        <MenuTrigger
                            aria-label={`Status of ${issue.identifier}: ${look.label}`}
                            disabled={pending}
                            onKeyDown={keepKeys}
                            className="focus-visible:ring-ring -m-0.5 rounded-full p-0.5 outline-none focus-visible:ring-2"
                        >
                            <look.icon
                                aria-hidden="true"
                                className={cx('size-3.5', look.color)}
                            />
                        </MenuTrigger>
                        <MenuPopup align="start" className="w-40">
                            <MenuRadioGroup
                                value={issue.status}
                                onValueChange={(value: string) =>
                                    onMove(value as IssueStatus)
                                }
                            >
                                {ISSUE_STATUSES.map((status) => {
                                    const option = ISSUE_STATUS[status];
                                    return (
                                        <MenuRadioItem
                                            key={status}
                                            value={status}
                                            closeOnClick
                                        >
                                            <span className="flex items-center gap-2">
                                                <option.icon
                                                    aria-hidden="true"
                                                    className={cx(
                                                        'size-3.5',
                                                        option.color,
                                                    )}
                                                />
                                                {option.label}
                                            </span>
                                        </MenuRadioItem>
                                    );
                                })}
                            </MenuRadioGroup>
                        </MenuPopup>
                    </Menu>
                )}
                <span className="text-muted-foreground font-mono text-[11px]">
                    {issue.identifier}
                </span>
                <priority.icon
                    role="img"
                    aria-label={`Priority: ${priority.label}`}
                    className={cx('ms-auto size-3.5', priority.color)}
                />
            </div>
            {lifted || !openIssue ? (
                <p className="line-clamp-2 leading-snug font-medium">
                    {issue.title}
                </p>
            ) : (
                <button
                    type="button"
                    onClick={() => openIssue(issue.id)}
                    onKeyDown={keepKeys}
                    aria-label={`Open ${issue.identifier}: ${issue.title}`}
                    className="hover:text-foreground focus-visible:ring-ring line-clamp-2 rounded text-left leading-snug font-medium outline-none hover:underline focus-visible:ring-2"
                >
                    {issue.title}
                </button>
            )}
            {(issue.links.length > 0 ||
                issue.assigneeId ||
                isAgentMade(issue)) && (
                <div className="flex flex-wrap items-center gap-1">
                    {issue.links.map((id) => {
                        const kind = kindOf(id);
                        const Icon = kind ? LINK_ICONS[kind] : FileTextIcon;
                        const chip = (
                            <>
                                <Icon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-3 shrink-0"
                                />
                                <span className="truncate">
                                    {titleOf(id) ?? id}
                                </span>
                            </>
                        );
                        const chipClass =
                            'bg-muted flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px]';
                        return lifted ? (
                            <span key={id} className={chipClass}>
                                {chip}
                            </span>
                        ) : (
                            <Link
                                key={id}
                                to={links.item(id)}
                                title={titleOf(id)}
                                onKeyDown={keepKeys}
                                className={cx(
                                    chipClass,
                                    'hover:bg-accent focus-visible:ring-ring outline-none focus-visible:ring-2',
                                )}
                            >
                                {chip}
                            </Link>
                        );
                    })}
                    <span className="ms-auto flex items-center gap-1">
                        {isAgentMade(issue) && <AgentIcon className="size-3" />}
                        {issue.assigneeId && (
                            <Avatar
                                person={personById(issue.assigneeId)}
                                size="sm"
                            />
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}

type NewIssueProps = {
    status: IssueStatus;
    onCreate: (title: string) => void;
};

/** "New issue" at the bottom of a column; opens a one-line title field. */
function NewIssue({ status, onCreate }: NewIssueProps) {
    const [title, setTitle] = useState<string | null>(null);
    const label = ISSUE_STATUS[status].label;

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmed = title?.trim();
        if (trimmed) onCreate(trimmed);
        setTitle(null);
    }

    if (title === null) {
        return (
            <button
                type="button"
                onClick={() => setTitle('')}
                aria-label={`New issue in ${label}`}
                className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring m-1.5 mt-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs outline-none focus-visible:ring-2 pointer-coarse:py-2"
            >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                New issue
            </button>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="m-1.5 mt-0">
            <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') setTitle(null);
                }}
                onBlur={() => {
                    if (!title.trim()) setTitle(null);
                }}
                aria-label={`New issue title in ${label}`}
                placeholder="Issue title"
                maxLength={200}
                className="bg-card focus-visible:ring-ring w-full rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2"
            />
        </form>
    );
}
