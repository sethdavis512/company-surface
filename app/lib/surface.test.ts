import { describe, expect, it } from 'vitest';
import {
    WINDOW_GAP,
    WINDOW_SIZES,
    clampSize,
    resizeBox,
    sizeOf,
    completeStack,
    restack,
    viewCenter,
    focusFrame,
    frameItems,
    placeIssue,
    pushRecent,
    hangSlot,
    placeNewWindow,
    placeWindows,
    normalizeWebUrl,
    youtubeVideoId,
    type SurfaceItem,
} from './surface';

const chat = (id: string): SurfaceItem => ({
    kind: 'chat',
    id,
    surfaceId: 's',
    title: id,
    participantIds: [],
    messages: [],
    createdById: 'maya',
});

const doc: SurfaceItem = {
    kind: 'document',
    surfaceId: 's',
    id: 'doc',
    title: 'Doc',
    authorId: 'me',
    createdById: 'me',
    updatedAt: '2026-10-23T00:00:00Z',
    blocks: [],
};

describe('placeWindows', () => {
    it('keeps the window aspect ratios', () => {
        expect(WINDOW_SIZES.chat.width / WINDOW_SIZES.chat.height).toBe(9 / 16);
        expect(WINDOW_SIZES.document.width / WINDOW_SIZES.document.height).toBe(
            16 / 9,
        );
    });

    it('puts chats first, side by side, then documents', () => {
        const placed = placeWindows([doc, chat('a'), chat('b')]);

        expect(placed.map((p) => p.id)).toEqual(['a', 'b', 'doc']);
        expect(placed[0]!.x).toBe(0);
        expect(placed[1]!.x).toBe(WINDOW_SIZES.chat.width + WINDOW_GAP);
        expect(placed[2]!.x).toBe(2 * (WINDOW_SIZES.chat.width + WINDOW_GAP));
    });

    it('centers shorter windows on the row', () => {
        const [, placedDoc] = placeWindows([chat('a'), doc]);
        expect(placedDoc!.y).toBe(
            (WINDOW_SIZES.chat.height - WINDOW_SIZES.document.height) / 2,
        );
    });
});

describe('focusFrame', () => {
    const insets = { top: 60, right: 12, bottom: 12, left: 12 };

    it('fills the canvas minus the insets', () => {
        const { size } = focusFrame(
            { width: 1000, height: 700 },
            { x: 0, y: 0 },
            insets,
        );
        expect(size).toEqual({ width: 976, height: 628 });
    });

    it('puts the window corner at the insets, at zoom 1', () => {
        const { viewport } = focusFrame(
            { width: 1000, height: 700 },
            { x: 408, y: 50 },
            insets,
        );
        expect(viewport).toEqual({ x: 12 - 408, y: 60 - 50, zoom: 1 });
    });

    it('never goes negative on a tiny canvas', () => {
        const { size } = focusFrame(
            { width: 10, height: 10 },
            { x: 0, y: 0 },
            insets,
        );
        expect(size).toEqual({ width: 0, height: 0 });
    });
});

describe('pushRecent', () => {
    it('puts the newest first', () => {
        expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    });

    it('moves a repeat visit to the front instead of listing it twice', () => {
        expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    });

    it('keeps only the last five', () => {
        expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual([
            'f',
            'a',
            'b',
            'c',
            'd',
        ]);
    });
});

describe('placeNewWindow', () => {
    it('starts at the origin on an empty canvas', () => {
        expect(placeNewWindow([], 'chat')).toEqual({ x: 0, y: 0 });
    });

    it('goes right of the rightmost window, centered on the row', () => {
        const placed = placeNewWindow(
            [
                { x: 0, kind: 'chat' },
                { x: 816, kind: 'document' },
            ],
            'document',
        );
        expect(placed).toEqual({
            x: 816 + WINDOW_SIZES.document.width + WINDOW_GAP,
            y: (WINDOW_SIZES.chat.height - WINDOW_SIZES.document.height) / 2,
        });
    });
});

describe('restack', () => {
    it('moves an item to the top or the bottom', () => {
        expect(restack(['a', 'b', 'c'], 'a', 'front')).toEqual(['b', 'c', 'a']);
        expect(restack(['a', 'b', 'c'], 'c', 'back')).toEqual(['c', 'a', 'b']);
    });
});

describe('completeStack', () => {
    it('keeps the known order, drops gone ids, and puts new ones on top', () => {
        expect(completeStack(['b', 'gone', 'a'], ['a', 'b', 'new'])).toEqual([
            'b',
            'a',
            'new',
        ]);
    });
});

describe('viewCenter', () => {
    it('finds the flow point at the middle of the canvas', () => {
        // At zoom 2, offset (100, 50), the middle of an 800x600 canvas
        // (400, 300) shows flow point ((400 - 100) / 2, (300 - 50) / 2).
        expect(
            viewCenter({ x: 100, y: 50, zoom: 2 }, { width: 800, height: 600 }),
        ).toEqual({ x: 150, y: 125 });
    });
});

describe('frameItems', () => {
    const items = [chat('a'), chat('b'), doc];

    it('centers on the chosen windows and zooms to fit them', () => {
        const framed = frameItems(items, ['a'], { width: 456, height: 736 });
        // One chat (360x640) plus 48px padding fits a 456x736 canvas at zoom 1.
        expect(framed).toEqual({ center: { x: 180, y: 320 }, zoom: 1 });
    });

    it('zooms out to fit several windows, within the canvas limits', () => {
        const framed = frameItems(items, ['a', 'doc']);
        expect(framed!.zoom).toBeLessThan(1);
        expect(framed!.zoom).toBeGreaterThanOrEqual(0.2);
    });

    it('returns null when none of the ids exist', () => {
        expect(frameItems(items, ['missing'])).toBeNull();
    });
});

describe('placeWindows with pull requests', () => {
    const pr = (id: string, chatId?: string): SurfaceItem => ({
        kind: 'pull-request',
        id,
        surfaceId: 's',
        title: id,
        number: 1,
        repo: 'r',
        branch: 'b',
        base: 'main',
        status: 'open',
        authorId: 'agent',
        createdById: 'agent',
        chatId,
        summary: '',
        checks: { passed: 0, failed: 0, pending: 0 },
        files: [],
        updatedAt: '2026-10-23T00:00:00Z',
    });

    it('hangs pull requests in a column under their chat', () => {
        const placed = placeWindows([
            chat('a'),
            chat('b'),
            pr('p1', 'b'),
            pr('p2', 'b'),
        ]);
        const b = placed.find((p) => p.id === 'b')!;
        const prHeight = WINDOW_SIZES['pull-request'].height;
        expect(placed.find((p) => p.id === 'p1')).toMatchObject(
            hangSlot(b, []),
        );
        expect(placed.find((p) => p.id === 'p2')).toMatchObject(
            hangSlot(b, [prHeight]),
        );
        expect(hangSlot(b, []).y).toBe(WINDOW_SIZES.chat.height + WINDOW_GAP);
        expect(hangSlot(b, [prHeight]).y).toBe(
            WINDOW_SIZES.chat.height + 2 * WINDOW_GAP + prHeight,
        );
    });

    it('puts a pull request without a chat on the row', () => {
        const placed = placeWindows([chat('a'), pr('loose')]);
        expect(placed.find((p) => p.id === 'loose')!.x).toBe(
            WINDOW_SIZES.chat.width + WINDOW_GAP,
        );
    });
});

describe('placeIssue', () => {
    const board = [
        { id: 'a', status: 'todo' as const },
        { id: 'b', status: 'todo' as const },
        { id: 'c', status: 'done' as const },
        { id: 'd', status: 'todo' as const },
    ];
    const column = (issues: typeof board, status: string) =>
        issues.filter((issue) => issue.status === status).map((i) => i.id);

    it('reorders within a column', () => {
        const moved = placeIssue(board, 'd', 'todo', 0);
        expect(column(moved, 'todo')).toEqual(['d', 'a', 'b']);
        expect(column(placeIssue(board, 'a', 'todo', 2), 'todo')).toEqual([
            'b',
            'd',
            'a',
        ]);
    });

    it('moves across columns at a position, or to the bottom', () => {
        expect(column(placeIssue(board, 'b', 'done', 0), 'done')).toEqual([
            'b',
            'c',
        ]);
        expect(column(placeIssue(board, 'b', 'done'), 'done')).toEqual([
            'c',
            'b',
        ]);
        expect(
            placeIssue(board, 'b', 'done').find((i) => i.id === 'b')!.status,
        ).toBe('done');
    });

    it('lands in an empty column and clamps wild positions', () => {
        expect(
            column(placeIssue(board, 'a', 'in_review', 5), 'in_review'),
        ).toEqual(['a']);
        expect(column(placeIssue(board, 'a', 'todo', -3), 'todo')).toEqual([
            'a',
            'b',
            'd',
        ]);
    });

    it('leaves the list alone for an unknown issue', () => {
        expect(placeIssue(board, 'zzz', 'done', 0)).toEqual(board);
    });
});

describe('youtubeVideoId', () => {
    it.each([
        ['https://www.youtube.com/watch?v=MnrJzXM7a6o&t=30s', 'MnrJzXM7a6o'],
        ['youtube.com/watch?v=MnrJzXM7a6o', 'MnrJzXM7a6o'],
        ['https://youtu.be/MnrJzXM7a6o?si=abc', 'MnrJzXM7a6o'],
        ['https://m.youtube.com/shorts/MnrJzXM7a6o', 'MnrJzXM7a6o'],
        ['https://www.youtube-nocookie.com/embed/MnrJzXM7a6o', 'MnrJzXM7a6o'],
        ['MnrJzXM7a6o', 'MnrJzXM7a6o'],
    ])('finds the id in %s', (input, id) => {
        expect(youtubeVideoId(input)).toBe(id);
    });

    it.each([
        'https://vimeo.com/123456',
        'https://www.youtube.com/@stanford',
        'https://www.youtube.com/watch?v=short',
        'not a link',
    ])('rejects %s', (input) => {
        expect(youtubeVideoId(input)).toBeNull();
    });
});

describe('normalizeWebUrl', () => {
    it('keeps https and adds it to bare addresses', () => {
        expect(normalizeWebUrl('https://example.com/a?b=1')).toBe(
            'https://example.com/a?b=1',
        );
        expect(normalizeWebUrl(' example.com ')).toBe('https://example.com/');
    });

    it.each([
        'http://example.com',
        'javascript:alert(1)',
        'data:text/html,hi',
        'localhost',
        '',
    ])('rejects %s', (input) => {
        expect(normalizeWebUrl(input)).toBeNull();
    });
});

describe('placeWindows with videos and web pages', () => {
    it('hangs them under their document, and puts loose ones on the row', () => {
        const video: SurfaceItem = {
            kind: 'video',
            surfaceId: 's',
            id: 'video',
            title: 'Video',
            videoId: 'MnrJzXM7a6o',
            attachedTo: 'doc',
            createdById: 'me',
            updatedAt: '2026-10-23T00:00:00Z',
        };
        const web: SurfaceItem = {
            kind: 'web',
            surfaceId: 's',
            id: 'web',
            title: 'Web',
            url: 'https://example.com/',
            createdById: 'me',
            updatedAt: '2026-10-23T00:00:00Z',
        };
        const placed = placeWindows([doc, video, web]);
        const spot = (id: string) => placed.find((p) => p.id === id)!;
        expect(spot('video').x).toBe(spot('doc').x);
        expect(spot('video').y).toBe(
            spot('doc').y + WINDOW_SIZES.document.height + WINDOW_GAP,
        );
        expect(spot('web').x).toBe(WINDOW_SIZES.document.width + WINDOW_GAP);
    });
});

describe('placeWindows column widths', () => {
    it('makes room for a wide card hanging under a narrow one', () => {
        const page: SurfaceItem = {
            kind: 'web',
            id: 'page',
            surfaceId: 's',
            title: 'Docs',
            url: 'https://example.com/',
            attachedTo: 'a',
            createdById: 'me',
            updatedAt: '2026-10-23T00:00:00Z',
        };
        const placed = placeWindows([chat('a'), chat('b'), page]);
        const spot = (id: string) => placed.find((p) => p.id === id)!;
        // The page (960) hangs under chat a (360): chat b starts past it.
        expect(spot('b').x).toBe(WINDOW_SIZES.web.width + WINDOW_GAP);
        expect(spot('page').x).toBe(spot('a').x);
    });
});

describe('resizing', () => {
    it('keeps chats between their resting size and a 16:9-wide box', () => {
        expect(clampSize('chat', { width: 10, height: 10 })).toEqual({
            width: 360,
            height: 640,
        });
        expect(clampSize('chat', { width: 5000, height: 5000 })).toEqual({
            width: 1138,
            height: 1138,
        });
        expect(clampSize('chat', { width: 480.6, height: 700.2 })).toEqual({
            width: 481,
            height: 700,
        });
    });

    const start = { x: 100, y: 50, width: 400, height: 700 };

    it('grows from the right and bottom without moving the card', () => {
        expect(
            resizeBox(
                'chat',
                start,
                { x: 'right', y: 'bottom' },
                { x: 60, y: 30 },
            ),
        ).toEqual({ x: 100, y: 50, width: 460, height: 730 });
        // One edge only moves one dimension.
        expect(
            resizeBox('chat', start, { x: 'right' }, { x: 60, y: 30 }),
        ).toEqual({ x: 100, y: 50, width: 460, height: 700 });
    });

    it('keeps the opposite edges put when dragging left or top', () => {
        expect(
            resizeBox(
                'chat',
                start,
                { x: 'left', y: 'top' },
                { x: -60, y: -30 },
            ),
        ).toEqual({ x: 40, y: 20, width: 460, height: 730 });
        // Clamped at the minimum: the card stops, its right edge stays.
        expect(
            resizeBox('chat', start, { x: 'left' }, { x: 500, y: 0 }),
        ).toEqual({ x: 140, y: 50, width: 360, height: 700 });
    });

    it("makes a chat's saved size its resting size, everywhere it's placed", () => {
        const big = { ...chat('a'), size: { width: 600, height: 900 } };
        expect(sizeOf(big)).toEqual({ width: 600, height: 900 });
        expect(sizeOf(chat('b'))).toEqual(WINDOW_SIZES.chat);
        const placed = placeWindows([big, chat('b')]);
        expect(placed[0]).toMatchObject({ width: 600, height: 900 });
        expect(placed[1]!.x).toBe(600 + WINDOW_GAP);
        expect(
            placeNewWindow([{ x: 0, kind: 'chat', width: 600 }], 'chat').x,
        ).toBe(600 + WINDOW_GAP);
    });
});
