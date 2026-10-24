import { use, useRef, type CSSProperties } from 'react';
import { useFetcher } from 'react-router';
import { useFlow, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import { cx } from 'cva.config';
import {
    SHAPE_MAX,
    SHAPE_MIN,
    SHAPE_TYPES,
    isAgentMade,
    type ShapeItem,
    type ShapeType,
} from '~/lib/surface';
import { AgentIcon } from './AgentMark';
import { CardTitle } from './CardTitle';
import { LinkHandle } from './LinkHandle';
import { SHAPE_LABEL_INSET, SHAPE_PATHS } from './shape-paths';
import {
    FocusedItemContext,
    useResizing,
    useStacking,
    useWindowColors,
} from './surface-context';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';

export type ShapeNode = FlowNode<{ item: ShapeItem }, 'shape'>;

/** A shape's color when nobody picked one (the palette recolors it). */
const DEFAULT_SHAPE_COLOR = 'sky';

/** The fetcher a shape's outline changes go through (`set-shape`). */
export function shapeFetcherKey(itemId: string) {
    return `shape:${itemId}`;
}

/**
 * A flowchart shape (React Flow's "shapes" example): an SVG outline that
 * stretches to the card, filled with a wash of the card's palette color,
 * with its label (the title, click to rename) in the middle. The whole
 * shape drags (it has no header); double-click focuses it; the grip at
 * the bottom right resizes it; its tray changes the outline. Links start
 * from its edge like any card's.
 */
export function ShapeWindow({ data, selected }: NodeProps<ShapeNode>) {
    const item = data.item;
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === item.id;
    const color = colorOf(item.id) ?? DEFAULT_SHAPE_COLOR;
    const pending = useFetcher({ key: shapeFetcherKey(item.id) }).formData?.get(
        'shape',
    );
    const shape =
        typeof pending === 'string' &&
        (SHAPE_TYPES as readonly string[]).includes(pending)
            ? (pending as ShapeType)
            : item.shape;
    const paths = SHAPE_PATHS[shape];
    // Selected, the outline takes the focus-ring color, as cards' rings do.
    const paint = {
        // The raw tokens: Tailwind's `--color-*` theme names aren't emitted
        // as variables (`@theme inline`).
        fill: `color-mix(in oklab, var(--tint-${color}) 26%, var(--card))`,
        stroke: selected ? 'var(--ring)' : `var(--tint-${color})`,
    } as CSSProperties;

    return (
        <div className="group/window relative size-full" data-shape={shape}>
            <LinkHandle />
            <WindowControls
                itemId={item.id}
                title={item.title}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={item.id}
                title={item.title}
                kind="Shape"
                rounded="rounded-md"
            />
            <article
                aria-label={`Shape (${shape}): ${item.title}`}
                className="relative size-full cursor-grab active:cursor-grabbing"
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 size-full overflow-visible drop-shadow-md"
                >
                    <path
                        d={paths.body}
                        style={paint}
                        strokeWidth={selected ? 3 : 2}
                        vectorEffect="non-scaling-stroke"
                    />
                    {paths.rim && (
                        <path
                            d={paths.rim}
                            fill="none"
                            style={{ stroke: paint.stroke }}
                            strokeWidth={selected ? 3 : 2}
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                </svg>
                <div
                    className={cx(
                        'relative flex size-full items-center justify-center',
                        SHAPE_LABEL_INSET[shape],
                    )}
                >
                    <CardTitle
                        itemId={item.id}
                        title={item.title}
                        className={cx(
                            'text-foreground line-clamp-3 max-w-full text-center leading-snug font-semibold break-words',
                            focused ? 'text-2xl' : 'text-sm',
                        )}
                    />
                </div>
                {isAgentMade(item) && (
                    <AgentIcon className="absolute top-1 right-1" />
                )}
            </article>
            {!focused && <ResizeGrip item={item} />}
        </div>
    );
}

/**
 * The corner you drag to resize a shape. It reads the drag in screen
 * pixels and divides by the zoom, so it tracks the pointer at any zoom.
 */
function ResizeGrip({ item }: { item: ShapeItem }) {
    const flow = useFlow();
    const { resize, commitResize } = useResizing();
    const { isLocked } = useStacking();
    const start = useRef<{
        x: number;
        y: number;
        width: number;
        height: number;
        zoom: number;
    } | null>(null);
    const last = useRef<{ width: number; height: number } | null>(null);
    if (isLocked(item.id)) return null;

    const fit = (value: number) =>
        Math.round(Math.min(SHAPE_MAX, Math.max(SHAPE_MIN, value)));

    return (
        <div
            role="separator"
            aria-label={`Resize ${item.title}`}
            title="Drag to resize"
            className="nodrag bg-card border-ring absolute -right-1.5 -bottom-1.5 z-10 size-3 cursor-nwse-resize rounded-sm border-2 opacity-0 transition-opacity group-hover/window:opacity-100 pointer-coarse:size-6 pointer-coarse:opacity-100"
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                const box = flow.getNodeBox(item.id);
                start.current = {
                    x: event.clientX,
                    y: event.clientY,
                    width: box?.width ?? item.width,
                    height: box?.height ?? item.height,
                    zoom: flow.getViewport().zoom,
                };
            }}
            onPointerMove={(event) => {
                const from = start.current;
                if (!from) return;
                last.current = {
                    width: fit(
                        from.width + (event.clientX - from.x) / from.zoom,
                    ),
                    height: fit(
                        from.height + (event.clientY - from.y) / from.zoom,
                    ),
                };
                resize(item.id, last.current);
            }}
            onPointerUp={() => {
                if (start.current && last.current) {
                    commitResize(item.id, last.current);
                }
                start.current = null;
                last.current = null;
            }}
        />
    );
}
