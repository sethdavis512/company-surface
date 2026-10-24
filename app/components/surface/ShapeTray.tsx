import type { DragEvent } from 'react';
import { useFlow } from '@sethdavis512/trellis';
import { SHAPE_TYPES, type ShapeType } from '~/lib/surface';
import { useAddCard } from './AddCard';
import { SHAPE_PATHS } from './shape-paths';

/** What a shape tile carries while it's dragged onto the canvas. */
const SHAPE_DRAG_TYPE = 'application/x-surface-shape';

/** A shape's outline in small, for the tray and the outline menu. */
export function ShapePreview({ shape }: { shape: ShapeType }) {
    const { body, rim } = SHAPE_PATHS[shape];
    return (
        <svg
            aria-hidden="true"
            viewBox="-4 -4 108 108"
            preserveAspectRatio="none"
            className="size-4 shrink-0"
        >
            <path
                d={body}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
            />
            {rim && (
                <path
                    d={rim}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    vectorEffect="non-scaling-stroke"
                />
            )}
        </svg>
    );
}

/**
 * The shapes palette down the canvas's left edge, under Add (React Flow's
 * shapes sidebar): click a shape to add it where you're looking, or drag
 * it to exactly where it goes (`useShapeDrop` on the canvas).
 */
export function ShapeTray() {
    const { add } = useAddCard();
    return (
        <div
            role="toolbar"
            aria-label="Shapes"
            aria-orientation="vertical"
            className="bg-card pointer-events-auto flex flex-col gap-0.5 rounded-full border p-1 shadow-md"
        >
            {SHAPE_TYPES.map((shape) => (
                <button
                    key={shape}
                    type="button"
                    draggable
                    aria-label={`Add a ${shape}`}
                    title={`${shape[0].toUpperCase()}${shape.slice(1)}: click, or drag onto the canvas`}
                    onClick={() => add('shape', { shape })}
                    onDragStart={(event) => {
                        event.dataTransfer.setData(SHAPE_DRAG_TYPE, shape);
                        event.dataTransfer.effectAllowed = 'copy';
                    }}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-7 cursor-grab items-center justify-center rounded-full outline-none focus-visible:ring-2 active:cursor-grabbing pointer-coarse:size-10"
                >
                    <ShapePreview shape={shape} />
                </button>
            ))}
        </div>
    );
}

/** Drop handlers for the canvas: a shape dragged from the tray lands there. */
export function useShapeDrop() {
    const flow = useFlow();
    const { add } = useAddCard();
    return {
        onDragOver(event: DragEvent) {
            if (!event.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        },
        onDrop(event: DragEvent) {
            const shape = event.dataTransfer.getData(SHAPE_DRAG_TYPE);
            if (!(SHAPE_TYPES as readonly string[]).includes(shape)) return;
            event.preventDefault();
            add('shape', {
                shape: shape as ShapeType,
                at: flow.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                }),
            });
        },
    };
}
