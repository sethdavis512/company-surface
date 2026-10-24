import { use } from 'react';
import { useFlow, useFlowState } from '@sethdavis512/trellis';
import { cx } from 'cva.config';
import { FocusedItemContext } from './surface-context';

/** Below this zoom, a window's own text is too small to read. */
export const READABLE_ZOOM = 0.6;
/** How big the overlay's title reads on screen, whatever the zoom. */
const LABEL_PX = 18;
/**
 * The most the label may take of the window's width (in `cqi`, a share of
 * the overlay's own width), so it fits narrow windows at any zoom.
 */
const LABEL_MAX_CQI = 11;
const ZOOM_DURATION_MS = 500;
/**
 * Where a zoomed-to window lands: the same gap under the filter bar (whose
 * panel ends 50px into the canvas) as from the canvas's left edge, which is
 * the nav's right edge.
 */
const SIDE_GAP_PX = 12;
export const TOP_PX = 50 + SIDE_GAP_PX;

/**
 * Flies the canvas to a window at zoom 1: its top just under the filter
 * bar, centered across when it fits, or a gap from the nav when it's wider.
 * Returns false when the window isn't on the canvas.
 */
export function useZoomToWindow() {
    const flow = useFlow();
    const canvas = useFlowState((s) => s.size);
    return (itemId: string): boolean => {
        const box = flow.getNodeBox(itemId);
        if (!box) return false;
        // At zoom 1 a flow unit is a pixel.
        const left = Math.max(SIDE_GAP_PX, (canvas.width - box.width) / 2);
        flow.setViewport(
            { x: left - box.x, y: TOP_PX - box.y, zoom: 1 },
            { duration: ZOOM_DURATION_MS },
        );
        return true;
    };
}

/** How long the fly-to takes, for anything waiting on it to land. */
export { ZOOM_DURATION_MS };

type Props = {
    itemId: string;
    title: string;
    /** "Chat", "Document", ...: shown above the title. */
    kind: string;
    /** Matches the window's corners, e.g. "rounded-xl". */
    rounded: string;
};

/**
 * When the canvas is zoomed out past reading size, hovering a window (or
 * tabbing to it) shows its name, centered, at a readable size. Clicking
 * zooms the canvas to 100% with the window's top just under the filter bar,
 * centered across (or a small gap from the nav when it's wider than the
 * canvas), without focusing it: the URL stays put and nothing resizes.
 *
 * Dragging still moves the window: the drag starts on the window and isn't
 * a click.
 */
export function ZoomOverlay({ itemId, title, kind, rounded }: Props) {
    const zoom = useFlowState((s) => s.viewport.zoom);
    const zoomToWindow = useZoomToWindow();
    const focused = use(FocusedItemContext) === itemId;
    if (focused || zoom >= READABLE_ZOOM) return null;

    function zoomIn() {
        zoomToWindow(itemId);
    }

    return (
        <button
            type="button"
            onClick={zoomIn}
            aria-label={`Zoom to ${title}`}
            className={cx(
                'bg-card/85 text-card-foreground ring-ring @container absolute inset-0 z-20 flex cursor-zoom-in items-center justify-center p-[6%] text-center opacity-0 ring-2 outline-none hover:opacity-100 focus-visible:opacity-100 motion-safe:transition-opacity motion-safe:duration-150',
                rounded,
            )}
        >
            {/* Counter-scaled, so it reads the same at any zoom, but never
                wider than the window allows. */}
            <span
                className="flex max-w-full flex-col items-center gap-[0.3em] leading-tight"
                style={{
                    fontSize: `min(${LABEL_PX / zoom}px, ${LABEL_MAX_CQI}cqi)`,
                }}
            >
                <span className="text-muted-foreground max-w-full truncate text-[0.75em] font-medium tracking-wide uppercase">
                    {kind}
                </span>
                <span className="line-clamp-3 max-w-full font-semibold text-balance break-words">
                    {title}
                </span>
            </span>
        </button>
    );
}
