import { describe, expect, it } from 'vitest';
import type { SketchStroke } from './surface';
import {
    SKETCH_PAPER,
    clampPoint,
    extendStroke,
    sketchStrokesSchema,
    strokePath,
} from './sketch';

const ink = (points: number[], extra: Partial<SketchStroke> = {}) => ({
    color: '#000000',
    size: 6,
    points,
    ...extra,
});

/** Every x, y in a path, to measure how wide the ink is. */
function extent(path: string) {
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
}

describe('clampPoint', () => {
    it('keeps points on the paper, rounded to a tenth', () => {
        expect(clampPoint(-5, 1000)).toEqual([0, 400]);
        expect(clampPoint(12.345, 6.789)).toEqual([12.3, 6.8]);
    });
});

describe('extendStroke', () => {
    it('skips points too close to the last one', () => {
        const stroke = ink([10, 10]);
        expect(extendStroke(stroke, 10.5, 10.5)).toBe(stroke);
        expect(extendStroke(stroke, 20, 10).points).toEqual([10, 10, 20, 10]);
    });

    it("keeps a pen's pressure alongside each point", () => {
        const pen = extendStroke(ink([], { pressures: [] }), 3, 4, 0.333);
        expect(extendStroke(pen, 30, 4, 1.4)).toMatchObject({
            points: [3, 4, 30, 4],
            pressures: [0.33, 1],
        });
    });

    it('ignores pressure for strokes drawn without a pen', () => {
        expect(extendStroke(ink([]), 3, 4, 0.5).pressures).toBeUndefined();
    });
});

describe('strokePath', () => {
    it('draws a filled outline, even for a single dot', () => {
        expect(strokePath(ink([100, 100]))).toMatch(/^M.*Z$/);
        expect(strokePath(ink([10, 10, 200, 10]))).toMatch(/^M.*Z$/);
    });

    it('draws nothing without points', () => {
        expect(strokePath(ink([]))).toBe('');
    });

    it('follows a pen: heavy pressure lays down wider ink than light', () => {
        const line = [10, 100, 60, 100, 110, 100, 160, 100];
        const light = strokePath(
            ink(line, { pressures: [0.1, 0.1, 0.1, 0.1] }),
        );
        const heavy = strokePath(ink(line, { pressures: [1, 1, 1, 1] }));
        expect(extent(heavy)).toBeGreaterThan(extent(light));
    });

    it('erases at an even width', () => {
        const line = [10, 100, 60, 100, 110, 100, 160, 100];
        const eraser = strokePath(ink(line, { color: SKETCH_PAPER, size: 18 }));
        expect(extent(eraser)).toBeCloseTo(18, 0);
    });
});

describe('sketchStrokesSchema', () => {
    it('accepts Paint colors and paired points, with or without pressure', () => {
        const strokes = [
            ink([1, 2, 3, 4], { color: '#ff0000' }),
            ink([1, 2, 3, 4], { pressures: [0.2, 0.8] }),
        ];
        expect(sketchStrokesSchema.parse(strokes)).toEqual(strokes);
    });

    it('refuses other colors, odd point lists, and stray pressures', () => {
        for (const stroke of [
            ink([1, 2], { color: '#123456' }),
            ink([1, 2, 3]),
            ink([1, 2, 3, 4], { pressures: [0.5] }),
        ]) {
            expect(sketchStrokesSchema.safeParse([stroke]).success).toBe(false);
        }
    });
});
