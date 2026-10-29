import { use, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useFlowState } from '@sethdavis512/trellis';
import { cx } from 'cva.config';
import {
    RESIZE_LIMITS,
    resizeBox,
    type ResizableKind,
    type ResizeEdges as Edges,
} from '~/lib/surface';
import {
    FocusedItemContext,
    useResizing,
    useStacking,
} from './surface-context';

/**
 * How thick the resize band along each edge is, and how big the corners
 * are, in screen px: counter-scaled by the zoom, so they're as easy to hit
 * zoomed out (capped, so they never eat a tiny card).
 */
const BAND_PX = 6;
const CORNER_PX = 18;
const MAX_FLOW_PX = 32;
/** Arrow keys resize by this much (shift: `BIG_STEP`), in flow px. */
const STEP = 20;
const BIG_STEP = 100;
/** Saves a keyboard resize once the keys pause this long. */
const KEY_SAVE_MS = 400;

type Zone = {
    name: string;
    edges: Edges;
    cursor: string;
    style: (band: number, corner: number) => CSSProperties;
};

const ZONES: Zone[] = [
    {
        name: 'top',
        edges: { y: 'top' },
        cursor: 'cursor-ns-resize',
        style: (band, corner) => ({
            top: 0,
            left: corner,
            right: corner,
            height: band,
        }),
    },
    {
        name: 'bottom',
        edges: { y: 'bottom' },
        cursor: 'cursor-ns-resize',
        style: (band, corner) => ({
            bottom: 0,
            left: corner,
            right: corner,
            height: band,
        }),
    },
    {
        name: 'left',
        edges: { x: 'left' },
        cursor: 'cursor-ew-resize',
        style: (band, corner) => ({
            left: 0,
            top: corner,
            bottom: corner,
            width: band,
        }),
    },
    {
        name: 'right',
        edges: { x: 'right' },
        cursor: 'cursor-ew-resize',
        style: (band, corner) => ({
            right: 0,
            top: corner,
            bottom: corner,
            width: band,
        }),
    },
    {
        name: 'top-left',
        edges: { x: 'left', y: 'top' },
        cursor: 'cursor-nwse-resize',
        style: (_, corner) => ({
            top: 0,
            left: 0,
            width: corner,
            height: corner,
        }),
    },
    {
        name: 'top-right',
        edges: { x: 'right', y: 'top' },
        cursor: 'cursor-nesw-resize',
        style: (_, corner) => ({
            top: 0,
            right: 0,
            width: corner,
            height: corner,
        }),
    },
    {
        name: 'bottom-left',
        edges: { x: 'left', y: 'bottom' },
        cursor: 'cursor-nesw-resize',
        style: (_, corner) => ({
            bottom: 0,
            left: 0,
            width: corner,
            height: corner,
        }),
    },
    {
        name: 'bottom-right',
        edges: { x: 'right', y: 'bottom' },
        cursor: 'cursor-nwse-resize',
        style: (_, corner) => ({
            bottom: 0,
            right: 0,
            width: corner,
            height: corner,
        }),
    },
];

type Props = {
    itemId: string;
    title: string;
    kind: ResizableKind;
};

/**
 * Drag a card's edges or corners to resize it, within its kind's limits
 * (`RESIZE_LIMITS`). The bands sit just inside the card's border; links
 * start from the ring just outside it (`LinkHandle` with `inside={0}`), so
 * the two never overlap, and the header still drags the card everywhere
 * but its top few pixels. Drags are read in screen px and divided by the
 * zoom, so the edge tracks the pointer at any zoom. The bottom right corner
 * also takes the keyboard: arrow keys resize, Shift for bigger steps.
 */
export function ResizeEdges({ itemId, title, kind }: Props) {
    const { begin, resize, commit } = useResizing();
    const { isLocked } = useStacking();
    const focused = use(FocusedItemContext) === itemId;
    const zoom = useFlowState((s) => s.viewport.zoom);
    const drag = useRef<{
        x: number;
        y: number;
        zoom: number;
        edges: Edges;
        start: NonNullable<ReturnType<typeof begin>>;
        last: ReturnType<typeof resizeBox> | null;
    } | null>(null);
    // A run of key presses is one resize, saved once they pause: each press
    // builds on the last, even before the canvas has drawn it.
    const keys = useRef<{
        box: ReturnType<typeof resizeBox>;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);
    if (focused || isLocked(itemId)) return null;

    const scale = (px: number) => Math.min(MAX_FLOW_PX, px / Math.min(zoom, 1));
    const band = scale(BAND_PX);
    const corner = scale(CORNER_PX);
    const { min, max } = RESIZE_LIMITS[kind];

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.shiftKey ? BIG_STEP : STEP;
        const delta = {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step },
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        const from = keys.current?.box ?? begin(itemId);
        if (!from) return;
        if (keys.current) clearTimeout(keys.current.timer);
        const box = resizeBox(kind, from, { x: 'right', y: 'bottom' }, delta);
        resize(itemId, box);
        keys.current = {
            box,
            timer: setTimeout(() => {
                keys.current = null;
                commit(itemId, box);
            }, KEY_SAVE_MS),
        };
    }

    return ZONES.map((zone) => {
        const keyboard = zone.name === 'bottom-right';
        return (
            <div
                key={zone.name}
                data-resize={zone.name}
                aria-hidden={keyboard ? undefined : true}
                {...(keyboard && {
                    role: 'separator',
                    tabIndex: 0,
                    'aria-label': `Resize ${title}`,
                    'aria-valuemin': min.width,
                    'aria-valuemax': max.width,
                    onKeyDown: handleKeyDown,
                })}
                style={zone.style(band, corner)}
                className={cx(
                    'nodrag absolute z-30 touch-none',
                    zone.cursor,
                    keyboard &&
                        'focus-visible:ring-ring rounded-br-[2rem] outline-none focus-visible:ring-2',
                )}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    const start = begin(itemId);
                    if (!start) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        zoom,
                        edges: zone.edges,
                        start,
                        last: null,
                    };
                }}
                onPointerMove={(event) => {
                    const from = drag.current;
                    if (!from) return;
                    from.last = resizeBox(kind, from.start, from.edges, {
                        x: (event.clientX - from.x) / from.zoom,
                        y: (event.clientY - from.y) / from.zoom,
                    });
                    resize(itemId, from.last);
                }}
                onPointerUp={() => {
                    const from = drag.current;
                    drag.current = null;
                    if (from?.last) commit(itemId, from.last);
                }}
                onPointerCancel={() => {
                    const from = drag.current;
                    drag.current = null;
                    if (from?.last) commit(itemId, from.last);
                }}
            />
        );
    });
}
