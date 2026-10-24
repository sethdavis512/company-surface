import { describe, expect, it } from 'vitest';
import { borderPoint, floatingEnds, offsetEnds } from './floating-edge';

const box = { x: 0, y: 0, width: 200, height: 100 };

describe('borderPoint', () => {
    it('leaves through the side facing the point', () => {
        expect(borderPoint(box, { x: 1000, y: 50 })).toEqual({
            x: 203,
            y: 50,
            side: 'right',
        });
        expect(borderPoint(box, { x: 100, y: -500 })).toMatchObject({
            x: 100,
            y: -3,
            side: 'top',
        });
    });

    it('picks the nearer side on a diagonal', () => {
        // Wide box: a 45° line hits the bottom before the right side.
        expect(borderPoint(box, { x: 400, y: 350 }).side).toBe('bottom');
    });
});

describe('floatingEnds', () => {
    it('joins two cards side by side across the gap between them', () => {
        const right = { x: 400, y: 0, width: 200, height: 100 };
        expect(floatingEnds(box, right)).toEqual({
            sourceX: 203,
            sourceY: 50,
            sourcePosition: 'right',
            targetX: 397,
            targetY: 50,
            targetPosition: 'left',
        });
    });

    it('turns to join a card below', () => {
        const below = { x: 0, y: 400, width: 200, height: 100 };
        expect(floatingEnds(box, below)).toMatchObject({
            sourcePosition: 'bottom',
            targetPosition: 'top',
        });
    });
});

describe('offsetEnds', () => {
    it('moves a link to its left, so one each way run side by side', () => {
        const there = { sourceX: 0, sourceY: 0, targetX: 100, targetY: 0 };
        const back = { sourceX: 100, sourceY: 0, targetX: 0, targetY: 0 };
        expect(offsetEnds(there, 7)).toMatchObject({
            sourceY: -7,
            targetY: -7,
        });
        expect(offsetEnds(back, 7)).toMatchObject({ sourceY: 7, targetY: 7 });
    });
});
