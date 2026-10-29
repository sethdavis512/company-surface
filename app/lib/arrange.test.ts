import { describe, expect, it } from 'vitest';
import {
    GROUP_GAP,
    arrangeGroups,
    clusterLayout,
    currentLayout,
    topLeftOf,
} from './arrange';
import {
    WINDOW_GAP,
    WINDOW_SIZES,
    sizeOf,
    type Relation,
    type SurfaceItem,
} from './surface';

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

const doc = (id: string): SurfaceItem => ({
    kind: 'document',
    id,
    surfaceId: 's',
    title: id,
    authorId: 'me',
    createdById: 'me',
    updatedAt: '2026-10-25T00:00:00Z',
    blocks: [],
});

const link = (from: string, to: string): Relation => ({
    id: `${from}>${to}`,
    from,
    to,
    label: 'made',
});

/** Each card's box where the layout put it. */
function boxes(
    items: SurfaceItem[],
    positions: Record<string, { x: number; y: number }>,
) {
    return items
        .filter((item) => positions[item.id])
        .map((item) => ({
            id: item.id,
            ...positions[item.id]!,
            ...sizeOf(item),
        }));
}

type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;

function bounds(rects: Rect[]): Rect {
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
        x,
        y,
        width: Math.max(...rects.map((r) => r.x + r.width)) - x,
        height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
}

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

describe('clusterLayout', () => {
    // The chat made a document and five notes, and a chart hangs under it.
    const made = [
        chat('chat'),
        chart('chart', 'chat'),
        doc('doc'),
        ...['n1', 'n2', 'n3', 'n4', 'n5'].map(note),
    ];
    const madeLinks = ['doc', 'n1', 'n2', 'n3', 'n4', 'n5'].map((id) =>
        link('chat', id),
    );

    it('puts a cluster around its hub, wrapped into rows, not one long line', () => {
        const positions = clusterLayout(made, madeLinks);
        expect(positions.chat).toEqual({ x: 0, y: 0 });
        expect(positions.chart).toEqual({
            x: 0,
            y: WINDOW_SIZES.chat.height + WINDOW_GAP,
        });
        const placed = boxes(made, positions);
        for (const box of placed.filter(
            (b) => !['chat', 'chart'].includes(b.id),
        )) {
            expect(box.x).toBeGreaterThanOrEqual(
                WINDOW_SIZES.chat.width + WINDOW_GAP,
            );
        }
        // Tallest first: the document leads the cards beside the hub.
        expect(positions.doc).toEqual({
            x: WINDOW_SIZES.chat.width + WINDOW_GAP,
            y: 0,
        });
        const all = bounds(placed);
        const inOneLine = placed.reduce(
            (sum, b) => sum + b.width + WINDOW_GAP,
            0,
        );
        expect(all.width).toBeLessThan(inOneLine / 2);
        for (const [i, a] of placed.entries()) {
            for (const b of placed.slice(i + 1))
                expect(overlap(a, b)).toBe(false);
        }
    });

    it('keeps separate topics in separate blocks, and loose cards last', () => {
        const items = [
            ...made,
            chat('other'),
            note('o1'),
            note('o2'),
            note('stray'),
            chat('quiet'),
        ];
        const relations = [
            ...madeLinks,
            link('other', 'o1'),
            link('o2', 'other'),
        ];
        const positions = clusterLayout(items, relations);
        const placed = boxes(items, positions);
        const of = (ids: string[]) =>
            bounds(placed.filter((box) => ids.includes(box.id)));
        const first = of(made.map((item) => item.id));
        const second = of(['other', 'o1', 'o2']);
        const loose = of(['stray', 'quiet']);
        expect(overlap(first, second)).toBe(false);
        expect(overlap(first, loose)).toBe(false);
        expect(overlap(second, loose)).toBe(false);
        // The biggest cluster first; loose cards after, chats first.
        expect(positions.chat).toEqual({ x: 0, y: 0 });
        expect(positions.quiet!.x).toBeLessThan(positions.stray!.x);
        expect(positions.quiet!.y).toBe(positions.stray!.y);
    });

    it('centers a cluster on the card with the most links', () => {
        const items = [chat('c'), note('hub'), note('a'), note('b')];
        const positions = clusterLayout(items, [
            link('c', 'hub'),
            link('hub', 'a'),
            link('b', 'hub'),
        ]);
        expect(positions.hub).toEqual({ x: 0, y: 0 });
        expect(positions.c!.x).toBeGreaterThan(0);
    });

    it('leaves locked cards, and what hangs under them, where they are', () => {
        const positions = clusterLayout(made, madeLinks, {
            locked: new Set(['chat']),
        });
        expect(positions.chat).toBeUndefined();
        expect(positions.chart).toBeUndefined();
        // With its hub pinned, the rest link nothing together: loose cards.
        expect(Object.keys(positions).sort()).toEqual(
            ['doc', 'n1', 'n2', 'n3', 'n4', 'n5'].sort(),
        );
    });
});
