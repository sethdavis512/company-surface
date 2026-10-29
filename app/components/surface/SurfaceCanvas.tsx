import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type Dispatch,
    type SetStateAction,
} from 'react';
import {
    Link,
    useFetcher,
    useFetchers,
    useNavigate,
    useSearchParams,
    useSubmit,
} from 'react-router';
import {
    Background,
    ControlButton,
    Controls,
    Flow,
    MiniMap,
    Panel,
    useEdgesState,
    useFlow,
    useFlowState,
    useNodesState,
    type FlowEdge,
    type NodeChange,
    type EdgeTypes,
    type NodeTypes,
    type Viewport,
} from '@sethdavis512/trellis';
import { ArrowLeftIcon, LayoutGridIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { createSurfaceSearch } from '~/lib/search';
import { CanvasMenu } from './CanvasMenu';
import { AddCardMenu } from './AddCardMenu';
import { Button } from '~/components/ui/button';
import {
    sizeOf,
    completeStack,
    focusFrame,
    isWindowColor,
    placeNewWindow,
    hangSlot,
    hangingUnder,
    parentIdOf,
    placeWindows,
    restack,
    type CardSize,
    type Insets,
    type PullRequestItem,
    type Surface,
    type SurfaceItem,
    type WindowColor,
} from '~/lib/surface';
import { BoardWindow, type BoardNode } from './BoardWindow';
import { VideoWindow, type VideoNode } from './VideoWindow';
import { WebWindow, type WebNode } from './WebWindow';
import { ImageWindow, type ImageNode } from './ImageWindow';
import { NoteWindow, type NoteNode } from './NoteWindow';
import { FloatingEdge } from './FloatingEdge';
import { DELETE_FETCHER_KEY, DeleteCardProvider } from './DeleteCard';
import { SketchWindow, type SketchNode } from './SketchWindow';
import { ChartWindow, type ChartNode } from './ChartWindow';
import { ChatWindow, type ChatNode } from './ChatWindow';
import { DocumentWindow, type DocumentNode } from './DocumentWindow';
import {
    FilterBar,
    NO_FILTER,
    matchesFilter,
    type SurfaceFilter,
} from './FilterBar';
import { PullRequestWindow, type PullRequestNode } from './PullRequestWindow';
import {
    FocusedItemContext,
    RenamingContext,
    ResizingContext,
    StackingContext,
    SurfaceItemsContext,
    WindowColorContext,
    SurfacePeopleContext,
    useSurfaceLinks,
} from './surface-context';

type SurfaceNode =
    | ChatNode
    | DocumentNode
    | PullRequestNode
    | ChartNode
    | BoardNode
    | VideoNode
    | WebNode
    | ImageNode
    | NoteNode
    | SketchNode;

const edgeTypes = { floating: FloatingEdge } as EdgeTypes;

const nodeTypes = {
    chat: ChatWindow,
    document: DocumentWindow,
    'pull-request': PullRequestWindow,
    chart: ChartWindow,
    board: BoardWindow,
    video: VideoWindow,
    web: WebWindow,
    image: ImageWindow,
    note: NoteWindow,
    sketch: SketchWindow,
} as NodeTypes;

/**
 * Canvas left showing around a focused window, in px. The top keeps a row
 * for the "Back to canvas" button.
 */
const FOCUS_INSETS: Insets = { top: 60, right: 12, bottom: 12, left: 12 };
const FLY_DURATION_MS = 500;
/** Windows (and edges) the filter leaves out. Still there, still clickable. */
const DIMMED = 'opacity-25 saturate-50';
/** Grows and shrinks a window in step with the view's flight. */
const RESIZE_TRANSITION =
    'motion-safe:transition-[opacity,width,height] motion-safe:duration-500 motion-safe:ease-out';
/** Windows sliding (and resizing) into place while Arrange runs. */
const ARRANGE_TRANSITION =
    'motion-safe:transition-[opacity,width,height,transform] motion-safe:duration-500 motion-safe:ease-out';
/** Dimming and undimming as filters change. */
const FADE_TRANSITION =
    'motion-safe:transition-opacity motion-safe:duration-200';
const ARRANGE_MS = 500;

/**
 * Inline, because Trellis's stylesheet is unlayered and outranks Tailwind's
 * layered utilities, so a class can't override its variables.
 */
const CANVAS_STYLE = { '--trellis-bg': 'var(--canvas)' } as CSSProperties;

function toNode(
    item: SurfaceItem,
    position: { x: number; y: number },
): SurfaceNode {
    const base = {
        id: item.id,
        position,
        ...sizeOf(item),
        ariaLabel: item.title,
    };
    switch (item.kind) {
        case 'chat':
            return { ...base, type: 'chat', data: { item } };
        case 'document':
            return { ...base, type: 'document', data: { item } };
        case 'pull-request':
            return { ...base, type: 'pull-request', data: { item } };
        case 'chart':
            return { ...base, type: 'chart', data: { item } };
        case 'board':
            return { ...base, type: 'board', data: { item } };
        case 'video':
            return { ...base, type: 'video', data: { item } };
        case 'web':
            return { ...base, type: 'web', data: { item } };
        case 'image':
            return { ...base, type: 'image', data: { item } };
        case 'note':
            return { ...base, type: 'note', data: { item } };
        case 'sketch':
            return { ...base, type: 'sketch', data: { item } };
    }
}

/**
 * The windows as they open: the tidy layout (`placeWindows`), except the
 * ones someone dragged, which open where they were left (saved positions).
 */
function toNodes(surface: Surface): SurfaceNode[] {
    const saved = surface.arrangement.positions;
    const byId = new Map(surface.items.map((item) => [item.id, item]));
    // The tidy layout, with windows someone moved where they left them.
    return placeWindows(surface.items).map(({ id, x, y }) =>
        toNode(byId.get(id)!, saved[id] ?? { x, y }),
    );
}

/**
 * Brings fresh loader data onto the canvas: existing windows get their new
 * content but keep where (and how big) they are, new items are placed right
 * of everything, and deleted ones go.
 */
function syncNodes(nodes: SurfaceNode[], surface: Surface): SurfaceNode[] {
    const current = new Map(nodes.map((node) => [node.id, node]));
    const synced: SurfaceNode[] = [];
    for (const item of surface.items) {
        const node = current.get(item.id);
        if (node) {
            // A card resized somewhere else (an agent, another tab) takes its
            // new size, unless it isn't resting: focused, or being resized.
            const was = sizeOf(node.data.item);
            const now = sizeOf(item);
            const resting =
                node.width === was.width && node.height === was.height;
            const resized =
                was.width !== now.width || was.height !== now.height;
            synced.push({
                ...node,
                ...(resting && resized ? now : {}),
                ariaLabel: item.title,
                data: { item },
            } as SurfaceNode);
        }
    }
    for (const item of surface.items) {
        if (current.has(item.id)) continue;
        // A window that arrives with a saved spot (a duplicate, placed
        // beside its original) opens there.
        const saved = surface.arrangement.positions[item.id];
        if (saved) {
            synced.push(toNode(item, saved));
            continue;
        }
        // A new pull request or chart hangs under its parent, below any
        // windows already hanging there.
        const parentId = parentIdOf(item);
        const parent = parentId
            ? synced.find((node) => node.id === parentId)
            : undefined;
        const position = parent
            ? hangSlot(
                  {
                      ...parent.position,
                      height: sizeOf(parent.data.item).height,
                  },
                  synced
                      .filter(
                          (node) => parentIdOf(node.data.item) === parent.id,
                      )
                      .map((node) => sizeOf(node.data.item).height),
              )
            : placeNewWindow(
                  synced.map((node) => ({
                      x: node.position.x,
                      kind: node.type!,
                      width: sizeOf(node.data.item).width,
                  })),
                  item.kind,
              );
        synced.push(toNode(item, position));
    }
    return synced;
}

/**
 * The saved arrangement (stacking order and border colors, from the loader)
 * with any change still on its way to the server applied on top, so a click
 * shows at once and, once saved, survives reloads.
 */
function useArrangement(surface: Surface) {
    const links = useSurfaceLinks();
    const submit = useSubmit();
    const fetchers = useFetchers();

    let stack = completeStack(
        surface.arrangement.stack,
        surface.items.map((item) => item.id),
    );
    const colors = { ...surface.arrangement.colors };
    const locked = new Set(surface.arrangement.locked);
    for (const { formData } of fetchers) {
        if (!formData) continue;
        const itemId = String(formData.get('itemId') ?? '');
        const intent = formData.get('intent');
        if (intent === 'restack') {
            const to = formData.get('to') === 'back' ? 'back' : 'front';
            stack = restack(stack, itemId, to);
        } else if (intent === 'set-color') {
            const color = String(formData.get('color') ?? '');
            if (isWindowColor(color)) colors[itemId] = color;
            else delete colors[itemId];
        } else if (intent === 'set-lock') {
            if (formData.get('locked') === 'true') locked.add(itemId);
            else locked.delete(itemId);
        }
    }

    const actions = useMemo(() => {
        const save = (fields: Record<string, string>) =>
            submit(fields, {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `arrange:${fields.intent}:${fields.itemId}`,
            });
        return {
            bringToFront: (itemId: string) =>
                save({ intent: 'restack', itemId, to: 'front' }),
            sendToBack: (itemId: string) =>
                save({ intent: 'restack', itemId, to: 'back' }),
            setColor: (itemId: string, color: WindowColor | null) =>
                save({ intent: 'set-color', itemId, color: color ?? '' }),
            setLocked: (
                itemId: string,
                isLocked: boolean,
                position?: { x: number; y: number },
            ) =>
                save({
                    intent: 'set-lock',
                    itemId,
                    locked: String(isLocked),
                    ...(position
                        ? { x: String(position.x), y: String(position.y) }
                        : {}),
                }),
        };
    }, [submit, links.action]);

    return { stack, colors, locked, ...actions };
}

function toEdges(surface: Surface): FlowEdge[] {
    const items = new Map(surface.items.map((item) => [item.id, item]));
    const pairs = new Set(
        surface.relations.map((relation) => `${relation.from}>${relation.to}`),
    );
    return surface.relations.map((relation) => {
        const target = items.get(relation.to);
        // A window hanging under its parent (a PR under its chat, a chart
        // under its chat or document) is fed from the parent's bottom, with
        // no label: the column already says it, and Trellis draws labels
        // above windows, so one would float over the cards above.
        const hangs = target && parentIdOf(target) === relation.from;
        return {
            id: relation.id,
            source: relation.from,
            target: relation.to,
            // Hanging cards are fed from the parent's bottom into their top;
            // other links leave from the right, where people drag them
            // from, and arrive on the left.
            sourceHandle: hangs ? 'bottom' : 'link',
            targetHandle: hangs ? undefined : 'in',
            type: hangs ? 'smoothstep' : 'floating',
            // A link back the other way too: each bows to its own side.
            data: {
                bothWays: pairs.has(`${relation.to}>${relation.from}`),
            },
            // Trellis portals labels away from their edge, so the label
            // carries the link's id itself (right-click it to remove).
            label: hangs ? undefined : (
                <span data-edge-id={relation.id}>{relation.label}</span>
            ),
            markerEnd: 'arrowclosed',
        };
    });
}

/** Every window at its resting size, except `focused`, which takes `size`. */
function resize(
    nodes: SurfaceNode[],
    focused: { id: string; size: { width: number; height: number } } | null,
    animate: boolean,
): SurfaceNode[] {
    return nodes.map((node) => {
        const size =
            focused && node.id === focused.id
                ? focused.size
                : sizeOf(node.data.item);
        return {
            ...node,
            ...size,
            className: animate ? RESIZE_TRANSITION : undefined,
        };
    });
}

type ViewTarget = {
    center: { x: number; y: number };
    zoom: number;
    itemIds?: string[];
};

/** Room around everything on first load, in px: clears the filter bar. */
const INITIAL_FIT_PADDING = 80;

/** Room around windows a view frames, in px. */
const VIEW_FIT_PADDING = 48;

/**
 * Follows the URL. Focusing an item remembers the view, grows its window to
 * fill the canvas (minus `FOCUS_INSETS`), and frames it at zoom 1; it keeps
 * filling the canvas as the canvas resizes. A saved view flies the canvas to
 * its center and zoom, or, for one that frames items, fits those windows
 * where they are now (again on every visit, so picking it twice works).
 * Leaving both shrinks any focused window back and flies to the remembered
 * view. The first move after the canvas loads jumps instead of animating, so
 * a deep link opens in place.
 */
function useFocusView(
    focusedId: string | undefined,
    view: ViewTarget | undefined,
    visitKey: string,
    setNodes: Dispatch<SetStateAction<SurfaceNode[]>>,
) {
    const flow = useFlow();
    // The canvas's own test for "placed and fitted": moving earlier would
    // be undone by its initial fit.
    const ready = useFlowState((s) => s.ready && s.size.width > 0);
    const canvasWidth = useFlowState((s) => s.size.width);
    const canvasHeight = useFlowState((s) => s.size.height);
    const returnView = useRef<Viewport | null>(null);
    const focusedLast = useRef(false);
    const settled = useRef(false);
    // Plain numbers, so fresh loader data (every poll) doesn't re-fly.
    const viewX = view?.center.x;
    const viewY = view?.center.y;
    const viewZoom = view?.zoom;
    const viewItems = view?.itemIds?.join(' ');

    useEffect(() => {
        if (!ready) return;
        const animate = settled.current;
        const duration = animate ? FLY_DURATION_MS : 0;
        settled.current = true;

        const node = focusedId ? flow.getNode(focusedId) : undefined;
        if (focusedId && node) {
            returnView.current ??= flow.getViewport();
            const { size, viewport } = focusFrame(
                { width: canvasWidth, height: canvasHeight },
                node.position,
                FOCUS_INSETS,
            );
            setNodes((all) => resize(all, { id: focusedId, size }, animate));
            flow.setViewport(viewport, { duration });
            focusedLast.current = true;
            return;
        }

        if (focusedLast.current) {
            setNodes((all) => resize(all, null, animate));
            focusedLast.current = false;
        }
        const framed = viewItems?.split(' ').filter((id) => flow.getNode(id));
        if (framed?.length) {
            returnView.current = null;
            flow.fitView({
                nodes: framed,
                padding: VIEW_FIT_PADDING,
                maxZoom: 1.5,
                duration,
            });
        } else if (viewX !== undefined && viewY !== undefined && viewZoom) {
            returnView.current = null;
            flow.setCenter(viewX, viewY, { zoom: viewZoom, duration });
        } else if (returnView.current) {
            flow.setViewport(returnView.current, { duration });
            returnView.current = null;
        }
    }, [
        focusedId,
        viewX,
        viewY,
        viewZoom,
        viewItems,
        visitKey,
        ready,
        canvasWidth,
        canvasHeight,
        flow,
        setNodes,
    ]);
}

type Box = CardSize & { x: number; y: number };

/**
 * Resizing cards by their edges (`ResizeEdges`): the card follows the
 * pointer on the canvas, then its box is saved on release (`resize-card`).
 * Cards hanging under it move with its bottom and left edges, so the column
 * stays lined up under it and never overlaps it.
 */
function useCardResizing(
    surface: Surface,
    setNodes: Dispatch<SetStateAction<SurfaceNode[]>>,
    locked: Set<string>,
) {
    const links = useSurfaceLinks();
    const flow = useFlow();
    const submit = useSubmit();
    const start = useRef<{
        box: Box;
        hanging: Map<string, { x: number; y: number }>;
    } | null>(null);

    return useMemo(() => {
        // Where the hanging cards go for a card at `box`.
        const hangingAt = (box: Box) => {
            const from = start.current;
            if (!from) return new Map<string, { x: number; y: number }>();
            const dx = box.x - from.box.x;
            const dy = box.y + box.height - (from.box.y + from.box.height);
            return new Map(
                [...from.hanging].map(([id, spot]) => [
                    id,
                    { x: spot.x + dx, y: spot.y + dy },
                ]),
            );
        };
        const save = (fields: Record<string, string>, key: string) =>
            void submit(fields, {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: key,
            });

        return {
            begin: (itemId: string) => {
                const box = flow.getNodeBox(itemId);
                if (!box) return null;
                const hanging = new Map<string, { x: number; y: number }>();
                for (const id of hangingUnder(itemId, surface.items)) {
                    const node = flow.getNode(id);
                    if (node && !locked.has(id)) {
                        hanging.set(id, { ...node.position });
                    }
                }
                start.current = { box, hanging };
                return box;
            },
            resize: (itemId: string, box: Box) => {
                const moved = hangingAt(box);
                setNodes((all) =>
                    all.map((node) => {
                        if (node.id === itemId) {
                            return {
                                ...node,
                                width: box.width,
                                height: box.height,
                                position: { x: box.x, y: box.y },
                                // Follow the pointer, not a transition left
                                // over from focusing.
                                className: undefined,
                            };
                        }
                        const spot = moved.get(node.id);
                        return spot ? { ...node, position: spot } : node;
                    }),
                );
            },
            commit: (itemId: string, box: Box) => {
                const from = start.current;
                const moved = hangingAt(box);
                start.current = null;
                if (!from) return;
                const shifted = box.x !== from.box.x || box.y !== from.box.y;
                save(
                    {
                        intent: 'resize-card',
                        itemId,
                        width: String(box.width),
                        height: String(box.height),
                        ...(shifted
                            ? { x: String(box.x), y: String(box.y) }
                            : {}),
                    },
                    `resize:${itemId}`,
                );
                if (moved.size > 0) {
                    save(
                        {
                            intent: 'move-windows',
                            positions: JSON.stringify(
                                Object.fromEntries(moved),
                            ),
                        },
                        `resize-hanging:${itemId}`,
                    );
                }
            },
        };
    }, [flow, submit, links.action, setNodes, surface.items, locked]);
}

/**
 * Arrange: slides every window back into the canvas's tidy layout (chats in
 * a row, then documents, each pull request under its chat; see
 * `placeWindows`) at its resting size, fits the view to all of it, and
 * clears saved positions (a fresh load uses the same layout).
 */
function useArrange(
    surface: Surface,
    setNodes: Dispatch<SetStateAction<SurfaceNode[]>>,
    locked: Set<string>,
    focusedId: string | undefined,
) {
    const links = useSurfaceLinks();
    const flow = useFlow();
    const submit = useSubmit();
    const [arranging, setArranging] = useState(false);

    // An agent laid cards out (`layoutVersion` went up): slide every card
    // to its saved spot, as Arrange does. The focused card keeps its frame.
    // Adjusted while rendering, like the rest of the loader sync.
    const layoutVersion = surface.arrangement.layoutVersion ?? 0;
    const [seenLayout, setSeenLayout] = useState(layoutVersion);
    if (layoutVersion !== seenLayout) {
        setSeenLayout(layoutVersion);
        const saved = surface.arrangement.positions;
        setNodes((all) =>
            all.map((node) => {
                const spot = saved[node.id];
                return spot && node.id !== focusedId
                    ? { ...node, position: { x: spot.x, y: spot.y } }
                    : node;
            }),
        );
        if (!focusedId) setArranging(true);
    }

    const arrange = useCallback(() => {
        const spots = new Map(
            placeWindows(surface.items).map((spot) => [spot.id, spot]),
        );
        setNodes((all) =>
            all.map((node) => {
                // Locked cards stay where they were pinned.
                const spot = locked.has(node.id)
                    ? undefined
                    : spots.get(node.id);
                return spot
                    ? {
                          ...node,
                          position: { x: spot.x, y: spot.y },
                          width: spot.width,
                          height: spot.height,
                      }
                    : node;
            }),
        );
        setArranging(true);
        // The tidy layout is what a fresh load uses, so forget moved windows.
        void submit(
            { intent: 'reset-positions' },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: 'reset-positions',
            },
        );
    }, [surface.items, setNodes, submit, links.action, locked]);

    // After the new positions reach the canvas: fit, then stop animating
    // moves, so dragging stays immediate.
    useEffect(() => {
        if (!arranging) return;
        flow.fitView({ padding: INITIAL_FIT_PADDING, duration: ARRANGE_MS });
        const timer = setTimeout(() => setArranging(false), ARRANGE_MS + 50);
        return () => clearTimeout(timer);
    }, [arranging, flow]);

    return { arrange, arranging };
}

type Props = {
    surface: Surface;
    /** From the URL (`/cards/:itemId`). */
    focusedId?: string;
    /** From the URL (`/views/:viewId`). */
    view?: ViewTarget;
    /** Changes on every navigation, so revisiting a view flies there again. */
    visitKey: string;
    /** Opens the ⌘K palette (from the canvas's right-click menu). */
    onSearch: () => void;
};

export function SurfaceCanvas({
    surface,
    focusedId,
    view,
    visitKey,
    onSearch,
}: Props) {
    const links = useSurfaceLinks();
    const navigate = useNavigate();
    // Double-clicking a card's header (its title bar, not a button or field
    // in it) focuses the card, or, on the focused card, goes back to the
    // canvas.
    function handleNodeDoubleClick(
        event: ReactMouseEvent,
        node: { id: string },
    ) {
        const target = event.target as Element;
        if (
            !target.closest('header') ||
            target.closest(
                'button, a, input, textarea, select, [contenteditable="true"]',
            )
        ) {
            return;
        }
        void navigate(
            node.id === focusedId ? links.action : links.item(node.id),
        );
    }
    // Dragging from a card's link dot onto another card relates the two.
    const submitLink = useSubmit();
    function linkFetch(fields: Record<string, string>) {
        void submitLink(fields, {
            method: 'post',
            action: links.action,
            navigate: false,
            fetcherKey: `link:${crypto.randomUUID()}`,
        });
    }
    function canConnect({
        source,
        target,
    }: {
        source: string;
        target: string;
    }) {
        return (
            source !== target &&
            !surface.relations.some(
                (relation) =>
                    (relation.from === source && relation.to === target) ||
                    (relation.from === target && relation.to === source),
            )
        );
    }
    function handleConnect({
        source,
        target,
    }: {
        source: string;
        target: string;
    }) {
        if (canConnect({ source, target })) {
            linkFetch({ intent: 'link-cards', from: source, to: target });
        }
    }
    function removeLink(relationId: string) {
        linkFetch({ intent: 'unlink-cards', relationId });
    }

    // While a card is focused, a click on the canvas around it goes back.
    function handlePaneClick(event: React.MouseEvent) {
        // React bubbles clicks from portals (a card's menus and pickers)
        // through the canvas, so only a click that landed in it counts.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (focusedId) void navigate(links.action);
    }
    const initialNodes = useMemo(() => toNodes(surface), [surface]);
    const initialEdges = useMemo(() => toEdges(surface), [surface]);
    const [nodes, setNodes, onNodesChange] =
        useNodesState<SurfaceNode>(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    useFocusView(focusedId, view, visitKey, setNodes);
    const isFocused = nodes.some((node) => node.id === focusedId);

    // Loader data changes as agents and replies arrive (the route polls).
    // Adjusted while rendering, so new content never waits an extra frame.
    const [syncedSurface, setSyncedSurface] = useState(surface);
    if (surface !== syncedSurface) {
        setSyncedSurface(surface);
        setNodes((all) => syncNodes(all, surface));
        setEdges(toEdges(surface));
    }

    const {
        stack,
        colors,
        locked,
        bringToFront,
        sendToBack,
        setColor,
        setLocked,
    } = useArrangement(surface);
    const stacking = useMemo(
        () => ({
            bringToFront,
            sendToBack,
            isLocked: (itemId: string) => locked.has(itemId),
            toggleLock: (itemId: string) =>
                setLocked(
                    itemId,
                    !locked.has(itemId),
                    nodes.find((node) => node.id === itemId)?.position,
                ),
        }),
        [bringToFront, sendToBack, locked, setLocked, nodes],
    );
    const windowColors = useMemo(
        () => ({ colorOf: (id: string) => colors[id], setColor }),
        [colors, setColor],
    );
    const resizing = useCardResizing(surface, setNodes, locked);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const renaming = useMemo(
        () => ({
            renamingId,
            startRename: setRenamingId,
            stopRename: () => setRenamingId(null),
        }),
        [renamingId],
    );

    // The focused window always sits above the rest.
    // Filters dim what doesn't match; the focused window never dims.
    // Save where windows end up: at the end of a drag (dragging: false) and
    // on keyboard nudges (no dragging flag), not on every step of a drag.
    const submitPositions = useSubmit();
    const handleNodesChange = useCallback(
        (changes: NodeChange<SurfaceNode>[]) => {
            onNodesChange(changes);
            const settled = changes.flatMap((change) =>
                change.type === 'position' && change.dragging !== true
                    ? [[change.id, change.position] as const]
                    : [],
            );
            if (settled.length === 0) return;
            void submitPositions(
                {
                    intent: 'move-windows',
                    positions: JSON.stringify(Object.fromEntries(settled)),
                },
                {
                    method: 'post',
                    action: links.action,
                    navigate: false,
                    fetcherKey: `move-windows:${settled.map(([id]) => id).join(',')}`,
                },
            );
        },
        [onNodesChange, submitPositions, links.action],
    );

    const { arrange, arranging } = useArrange(
        surface,
        setNodes,
        locked,
        focusedId,
    );
    const [filter, setFilter] = useState<SurfaceFilter>(NO_FILTER);
    const [searchParams] = useSearchParams();
    const query = searchParams.get('q') ?? '';
    const found = useMemo(
        () =>
            query.trim()
                ? createSurfaceSearch(surface.items).search(query).itemIds
                : null,
        [query, surface.items],
    );
    const dimmed = useMemo(() => {
        if (!filter.kind && !filter.color && !filter.agentOnly && !found) {
            return new Set<string>();
        }
        return new Set(
            surface.items
                .filter(
                    (item) =>
                        item.id !== focusedId &&
                        (!matchesFilter(filter, item, colors[item.id]) ||
                            (found !== null && !found.has(item.id))),
                )
                .map((item) => item.id),
        );
    }, [filter, found, surface.items, colors, focusedId]);

    // The cards there when the canvas opened; any others arrived since (added
    // by hand, by an agent, a duplicate) and fade in.
    const [openedWith] = useState(
        () => new Set(surface.items.map((item) => item.id)),
    );
    // Cards being deleted (and those hanging under them) go at once.
    const deletingId = useFetcher({ key: DELETE_FETCHER_KEY }).formData?.get(
        'itemId',
    );
    const deleting = useMemo(
        () =>
            typeof deletingId === 'string'
                ? new Set([
                      deletingId,
                      ...hangingUnder(deletingId, surface.items),
                  ])
                : null,
        [deletingId, surface.items],
    );
    const stackedNodes = useMemo(
        () =>
            nodes.map((node) => ({
                ...node,
                className: cx(
                    arranging
                        ? ARRANGE_TRANSITION
                        : node.className === RESIZE_TRANSITION
                          ? RESIZE_TRANSITION
                          : FADE_TRANSITION,
                    dimmed.has(node.id) && DIMMED,
                    // Only on mount does the animation run, so keeping the
                    // class on afterwards is harmless.
                    !openedWith.has(node.id) && 'motion-safe:animate-card-in',
                ),
                draggable: !locked.has(node.id),
                hidden: deleting?.has(node.id) ?? false,
                zIndex:
                    node.id === focusedId
                        ? stack.length + 1
                        : stack.indexOf(node.id) + 1,
            })),
        [
            nodes,
            stack,
            focusedId,
            dimmed,
            arranging,
            openedWith,
            locked,
            deleting,
        ],
    );
    // A focused window fills the canvas, and Trellis draws edge labels above
    // every window, so edges hide while one is focused.
    const shownEdges = useMemo(
        () =>
            edges.map((edge) => {
                if (focusedId) return { ...edge, hidden: true };
                return dimmed.has(edge.source) || dimmed.has(edge.target)
                    ? { ...edge, className: cx(FADE_TRANSITION, DIMMED) }
                    : edge;
            }),
        [edges, dimmed, focusedId],
    );

    const lookups = useMemo(() => {
        const titles = new Map(
            surface.items.map((item) => [item.id, item.title]),
        );
        const pullRequests = surface.items.filter(
            (item): item is PullRequestItem => item.kind === 'pull-request',
        );
        const kinds = new Map(
            surface.items.map((item) => [item.id, item.kind]),
        );
        const byId = new Map(surface.items.map((item) => [item.id, item]));
        return {
            items: surface.items,
            itemOf: (id: string) => byId.get(id),
            titleOf: (id: string) => titles.get(id),
            kindOf: (id: string) => kinds.get(id),
            pullRequestsFrom: (chatId: string) =>
                pullRequests
                    .filter((pr) => pr.chatId === chatId)
                    .sort((a, b) => b.number - a.number),
        };
    }, [surface]);

    const people = useMemo(() => {
        const byId = new Map(surface.people.map((p) => [p.id, p]));
        return {
            meId: surface.meId,
            people: surface.people,
            personById: (id: string) => byId.get(id),
        };
    }, [surface]);

    return (
        <SurfacePeopleContext.Provider value={people}>
            <SurfaceItemsContext.Provider value={lookups}>
                <FocusedItemContext.Provider value={focusedId}>
                    <StackingContext.Provider value={stacking}>
                        <WindowColorContext.Provider value={windowColors}>
                            <RenamingContext.Provider value={renaming}>
                                <ResizingContext.Provider value={resizing}>
                                    <DeleteCardProvider>
                                        <CanvasMenu
                                            onArrange={arrange}
                                            onSearch={onSearch}
                                            linkLabel={(id) =>
                                                surface.relations.find(
                                                    (relation) =>
                                                        relation.id === id,
                                                )?.label
                                            }
                                            onRemoveLink={removeLink}
                                        >
                                            <div className="size-full">
                                                <Flow
                                                    nodes={stackedNodes}
                                                    edges={shownEdges}
                                                    onNodesChange={
                                                        handleNodesChange
                                                    }
                                                    onEdgesChange={
                                                        onEdgesChange
                                                    }
                                                    nodeTypes={nodeTypes}
                                                    edgeTypes={edgeTypes}
                                                    onNodeDoubleClick={
                                                        handleNodeDoubleClick
                                                    }
                                                    onPaneClick={
                                                        handlePaneClick
                                                    }
                                                    onConnect={handleConnect}
                                                    isValidConnection={
                                                        canConnect
                                                    }
                                                    deleteKeys={null}
                                                    scrollMode="pan"
                                                    minZoom={0.2}
                                                    maxZoom={1.5}
                                                    fitView={{
                                                        padding:
                                                            INITIAL_FIT_PADDING,
                                                    }}
                                                    ariaLabel="Company surface"
                                                    className="size-full"
                                                    style={CANVAS_STYLE}
                                                >
                                                    <Background />
                                                    {!isFocused && (
                                                        <Controls>
                                                            <ControlButton
                                                                label="Arrange cards"
                                                                onClick={
                                                                    arrange
                                                                }
                                                            >
                                                                <LayoutGridIcon
                                                                    aria-hidden="true"
                                                                    className="size-4"
                                                                />
                                                            </ControlButton>
                                                        </Controls>
                                                    )}
                                                    {!isFocused && <MiniMap />}
                                                    {!isFocused && (
                                                        <Panel
                                                            position="top-left"
                                                            // The whole top row: Add pinned
                                                            // left, the filters centered in the
                                                            // rest, never overlapping. Clicks
                                                            // pass through the gaps to the canvas.
                                                            style={{ right: 0 }}
                                                            className="pointer-events-none flex items-start gap-2"
                                                        >
                                                            <div className="shrink-0">
                                                                <AddCardMenu />
                                                            </div>
                                                            <div className="pointer-events-none flex min-w-0 flex-1 justify-center">
                                                                <FilterBar
                                                                    filter={
                                                                        filter
                                                                    }
                                                                    onChange={
                                                                        setFilter
                                                                    }
                                                                    shown={
                                                                        surface
                                                                            .items
                                                                            .length -
                                                                        dimmed.size
                                                                    }
                                                                    total={
                                                                        surface
                                                                            .items
                                                                            .length
                                                                    }
                                                                    query={
                                                                        query
                                                                    }
                                                                />
                                                            </div>
                                                        </Panel>
                                                    )}
                                                    {isFocused && (
                                                        <Panel position="top-left">
                                                            <Button
                                                                variant="outline"
                                                                className="bg-card shadow-md"
                                                                render={
                                                                    <Link
                                                                        to={
                                                                            links.action
                                                                        }
                                                                    />
                                                                }
                                                            >
                                                                <ArrowLeftIcon aria-hidden="true" />
                                                                Back to canvas
                                                            </Button>
                                                        </Panel>
                                                    )}
                                                </Flow>
                                            </div>
                                        </CanvasMenu>
                                    </DeleteCardProvider>
                                </ResizingContext.Provider>
                            </RenamingContext.Provider>
                        </WindowColorContext.Provider>
                    </StackingContext.Provider>
                </FocusedItemContext.Provider>
            </SurfaceItemsContext.Provider>
        </SurfacePeopleContext.Provider>
    );
}
