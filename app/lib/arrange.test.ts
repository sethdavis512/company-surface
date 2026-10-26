import { describe, expect, it } from 'vitest';
import { GROUP_GAP, arrangeGroups, currentLayout, topLeftOf } from './arrange';
import { WINDOW_GAP, WINDOW_SIZES, type SurfaceItem } from './surface';

const chat = (id: string): SurfaceItem => ({
    kind: 'chat',
    id,
    surfaceId: 's',
    title: id,
    participantIds: [],
    messages: [],
    createdById: 'me',
});

const note = (id: string): SurfaceItem => ({
    kind: 'note',
    id,
    surfaceId: 's',
    title: id,
    text: id,
    createdById: 'me',
    updatedAt: '2026-10-25T00:00:00Z',
});

const chart = (id: string, attachedTo: string): SurfaceItem => ({
    kind: 'chart',
    id,
    surfaceId: 's',
    title: id,
    chart: 'bar',
    unit: 'x',
    caption: '',
    points: [],
    attachedTo,
    updatedAt: '2026-10-25T00:00:00Z',
    createdById: 'me',
});

const origin = { x: 100, y: 50 };

describe('arrangeGroups', () => {
    it('stacks each group as a column, groups left to right', () => {
        const items = [note('a'), note('b'), chat('c')];
        const { positions, groups } = arrangeGroups(
            items,
            [['a', 'b'], ['c']],
            {
                direction: 'columns',
                origin,
            },
        );
        expect(positions).toEqual({
            a: { x: 100, y: 50 },
            b: { x: 100, y: 50 + WINDOW_SIZES.note.height + WINDOW_GAP },
            c: { x: 100 + WINDOW_SIZES.note.width + GROUP_GAP, y: 50 },
        });
        expect(groups[0]).toEqual({
            x: 100,
            y: 50,
            width: WINDOW_SIZES.note.width,
            height: WINDOW_SIZES.note.height * 2 + WINDOW_GAP,
        });
    });

    it('lines each group up as a row, groups top to bottom', () => {
        const items = [note('a'), note('b'), note('c')];
        const { positions } = arrangeGroups(items, [['a', 'b'], ['c']], {
            direction: 'rows',
            origin: { x: 0, y: 0 },
            gap: 10,
        });
        expect(positions.b).toEqual({ x: WINDOW_SIZES.note.width + 10, y: 0 });
        expect(positions.c).toEqual({
            x: 0,
            y: WINDOW_SIZES.note.height + GROUP_GAP,
        });
    });

    it('takes hanging cards along under their parent', () => {
        const items = [chat('c'), chart('k', 'c'), note('n')];
        const { positions, skipped } = arrangeGroups(items, [['k', 'n', 'c']], {
            direction: 'rows',
            origin: { x: 0, y: 0 },
        });
        expect(skipped).toEqual([
            { id: 'k', reason: 'hangs under c and moves with it' },
        ]);
        expect(positions.k).toEqual({
            x: positions.c!.x,
            y: positions.c!.y + WINDOW_SIZES.chat.height + WINDOW_GAP,
        });
        // The chat's block is as wide as the chat; the note sits right of it.
        expect(positions.n).toEqual({ x: 0, y: 0 });
        expect(positions.c!.x).toBe(WINDOW_SIZES.note.width + WINDOW_GAP);
    });

    it('leaves locked cards, and appends the rest unless told not to', () => {
        const items = [note('a'), note('b'), note('locked')];
        const locked = new Set(['locked']);
        const appended = arrangeGroups(items, [['a', 'locked']], {
            direction: 'columns',
            origin,
            locked,
        });
        expect(Object.keys(appended.positions).sort()).toEqual(['a', 'b']);
        expect(appended.skipped).toEqual([
            { id: 'locked', reason: 'locked in place' },
        ]);
        expect(appended.groups).toHaveLength(2);

        const left = arrangeGroups(items, [['a']], {
            direction: 'columns',
            origin,
            locked,
            rest: 'leave',
        });
        expect(Object.keys(left.positions)).toEqual(['a']);
    });

    it('places a card once, in the first group that names it', () => {
        const items = [note('a'), note('b')];
        const { positions, groups } = arrangeGroups(
            items,
            [['a'], ['a', 'b']],
            { direction: 'columns', origin, rest: 'leave' },
        );
        expect(positions.a).toEqual(origin);
        expect(groups).toHaveLength(2);
    });
});

describe('currentLayout', () => {
    it('is the tidy layout, with saved spots where people left cards', () => {
        const layout = currentLayout([note('a'), note('b')], {
            b: { x: 9, y: 9 },
        });
        expect(layout.find((spot) => spot.id === 'b')).toMatchObject({
            x: 9,
            y: 9,
        });
        expect(layout.find((spot) => spot.id === 'a')!.x).toBe(0);
    });
});

describe('topLeftOf', () => {
    it('is the smallest x and y', () => {
        expect(
            topLeftOf([
                { x: 5, y: 40 },
                { x: 20, y: 3 },
            ]),
        ).toEqual({ x: 5, y: 3 });
        expect(topLeftOf([])).toEqual({ x: 0, y: 0 });
    });
});
