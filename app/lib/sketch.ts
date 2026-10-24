import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { z } from 'zod';
import { SKETCH_COLORS, SKETCH_SIZE, type SketchStroke } from './surface';

/** The brush widths a sketch offers, in sketch units. */
export const SKETCH_BRUSHES = [3, 6, 14] as const;

/** White paints the paper back, so it's the eraser's color. */
export const SKETCH_PAPER = '#ffffff';

/** The eraser paints white, this many times the brush width. */
export const ERASER_SCALE = 3;

/** A whole drawing's strokes, as saved (`update-sketch`, `add_sketch`). */
export const sketchStrokesSchema = z
    .array(
        z
            .object({
                color: z.enum(SKETCH_COLORS),
                size: z.number().positive().max(60),
                points: z
                    .array(z.number().finite())
                    .min(2)
                    .max(4000)
                    .refine((points) => points.length % 2 === 0, {
                        message: 'Points come in x, y pairs.',
                    }),
                pressures: z
                    .array(z.number().min(0).max(1))
                    .max(2000)
                    .optional(),
            })
            .refine(
                (stroke) =>
                    !stroke.pressures ||
                    stroke.pressures.length * 2 === stroke.points.length,
                { message: 'One pressure per point.' },
            ),
    )
    .max(1000);

/** Rounds a point to a tenth and keeps it on the paper. */
export function clampPoint(x: number, y: number): [number, number] {
    const round = (value: number, max: number) =>
        Math.round(Math.min(max, Math.max(0, value)) * 10) / 10;
    return [round(x, SKETCH_SIZE.width), round(y, SKETCH_SIZE.height)];
}

/**
 * Adds a point (and a pen's pressure there) to a stroke, unless it's within
 * `minGap` of the last one, so a slow hand doesn't save hundreds of points
 * on top of each other. Returns the same stroke when nothing was added.
 */
export function extendStroke(
    stroke: SketchStroke,
    x: number,
    y: number,
    pressure?: number,
    minGap = 1,
): SketchStroke {
    const [px, py] = clampPoint(x, y);
    const { points } = stroke;
    const lastX = points.at(-2);
    const lastY = points.at(-1);
    if (
        lastX !== undefined &&
        lastY !== undefined &&
        Math.hypot(px - lastX, py - lastY) < minGap
    ) {
        return stroke;
    }
    const next: SketchStroke = { ...stroke, points: [...points, px, py] };
    if (stroke.pressures && pressure !== undefined) {
        next.pressures = [
            ...stroke.pressures,
            Math.round(Math.min(1, Math.max(0, pressure)) * 100) / 100,
        ];
    }
    return next;
}

/**
 * How ink lays down (perfect-freehand): it swells where you slow down and
 * thins where you speed up (or follows a pen's pressure), with round ends
 * like Paint's brush (a taper pinches closed shapes shut). The eraser is an
 * even width.
 */
function inkOptions(stroke: SketchStroke): StrokeOptions {
    const eraser = stroke.color === SKETCH_PAPER;
    return {
        size: stroke.size,
        thinning: eraser ? 0 : 0.4,
        smoothing: 0.5,
        streamline: 0.3,
        simulatePressure: !stroke.pressures,
        start: { cap: true, taper: 0 },
        end: { cap: true, taper: 0 },
        // Drawn the same while the pointer is down as once it lifts, so
        // the stroke never jumps on mouse up.
        last: true,
    };
}

/** The SVG path of a stroke's ink: an outline to fill, not a line to stroke. */
export function strokePath(stroke: SketchStroke): string {
    const { points, pressures } = stroke;
    if (points.length < 2) return '';
    const input = Array.from({ length: points.length / 2 }, (_, i) =>
        pressures
            ? [points[i * 2], points[i * 2 + 1], pressures[i]]
            : [points[i * 2], points[i * 2 + 1]],
    );
    return outlinePath(getStroke(fillGaps(input), inkOptions(stroke)));
}

/** Gaps longer than this get points in between (`fillGaps`). */
const MAX_GAP = 24;
const GAP_STEP = 6;

/**
 * Adds points along long, straight gaps. Simulated pressure reads a long
 * gap as a very fast stroke and draws a hairline, so sparse strokes (an
 * agent's, or a quick flick) would come out as wisps. Hand-drawn strokes
 * are sampled far more densely than this and keep their speed.
 */
function fillGaps(input: number[][]): number[][] {
    return input.flatMap((point, i) => {
        const next = input[i + 1];
        if (!next) return [point];
        const steps = Math.ceil(
            Math.hypot(next[0] - point[0], next[1] - point[1]) / GAP_STEP,
        );
        if (steps * GAP_STEP <= MAX_GAP) return [point];
        return Array.from({ length: steps }, (_, step) =>
            point.map((value, k) => value + ((next[k] - value) * step) / steps),
        );
    });
}

/** A closed path through outline points, smoothed with quadratic curves. */
function outlinePath(outline: number[][]): string {
    if (outline.length < 3) return '';
    const round = (value: number) => Math.round(value * 100) / 100;
    const mid = (a: number[], b: number[]) => [
        round((a[0] + b[0]) / 2),
        round((a[1] + b[1]) / 2),
    ];
    const [first, second] = outline;
    let path = `M${round(first[0])} ${round(first[1])}Q${round(second[0])} ${round(second[1])} ${mid(second, outline[2]).join(' ')}T`;
    for (let i = 2; i < outline.length - 1; i++) {
        path += `${mid(outline[i], outline[i + 1]).join(' ')} `;
    }
    return `${path.trimEnd()}Z`;
}
