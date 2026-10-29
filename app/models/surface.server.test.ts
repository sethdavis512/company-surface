import invariant from 'tiny-invariant';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '~/context';
import type { DocumentItem } from '~/lib/surface';
import { MOCK_REPLY_DELAY_MS } from '~/lib/mock-chat';
import { markdownToPortableText } from '~/lib/portable-text';
import {
    AGENT_ID,
    ME_ID,
    SurfaceError,
    appendToDocument,
    createChat,
    createChart,
    createBoard,
    createIssue,
    updateIssue,
    setPullRequestStatus,
    createDocument,
    getItem,
    getSurfaceForUser,
    linkItems,
    listItems,
    postMessage,
    resetSurface,
    SEED_SURFACE_ID,
    restackItem,
    saveView,
    deleteView,
    getSavedView,
    setItemColor,
    moveWindows,
    createVideo,
    createWebPage,
    createImage,
    duplicateItem,
    addCard,
    createNote,
    updateNote,
    navigateWebPage,
    updateDocument,
    SurfaceConflictError,
    resetWindowPositions,
    createSketch,
    updateSketch,
    setItemLocked,
    unlinkItems,
    unlinkCards,
    commentOnIssue,
    renameItem,
    resizeItem,
    getLayout,
    deleteItem,
} from './surface.server';

const user = {
    name: 'Alice Smith',
    email: 'alice@example.test',
} as SessionUser;

beforeEach(() => resetSurface());
afterEach(() => vi.useRealTimers());

describe('surface store', () => {
    it('starts from the seed: every kind, with agent-made work marked', () => {
        const items = listItems();
        expect(new Set(items.map((item) => item.kind))).toEqual(
            new Set([
                'chat',
                'document',
                'pull-request',
                'chart',
                'board',
                'video',
                'web',
                'image',
                'note',
                'sketch',
            ]),
        );
        expect(getItem('doc-sso-notes').createdById).toBe(AGENT_ID);
        expect(getItem('doc-brief').createdById).toBe('maya');
    });

    it('names "me" after the signed-in user', async () => {
        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (surface) => surface!,
        );
        const me = surface.people.find((person) => person.id === ME_ID);
        expect(me).toMatchObject({ name: 'Alice Smith', initials: 'AS' });
    });

    it('hands out copies, so callers cannot change the store', async () => {
        const before = listItems().length;
        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (surface) => surface!,
        );
        surface.items.pop();
        expect(listItems()).toHaveLength(before);
    });

    it('creates a chat with the agent and me, and an opening message', () => {
        const chat = createChat({
            surfaceId: SEED_SURFACE_ID,
            title: 'Pricing',
            firstMessage: 'Hi all',
        });

        expect(chat.participantIds).toEqual([ME_ID, AGENT_ID]);
        const stored = getItem(chat.id);
        expect(stored.kind === 'chat' && stored.messages[0]).toMatchObject({
            authorId: AGENT_ID,
            text: 'Hi all',
        });
        expect(listItems().at(-1)).toMatchObject({ id: chat.id, kind: 'chat' });
    });

    it('rejects people it does not know', () => {
        expect(() =>
            createChat({
                surfaceId: SEED_SURFACE_ID,
                title: 'x',
                participantIds: ['nobody'],
            }),
        ).toThrow(SurfaceError);
    });

    it('answers my message after a pause, flagging the wait meanwhile', async () => {
        vi.useFakeTimers();
        postMessage({ chatId: 'chat-launch', authorId: ME_ID, text: 'Ping' });

        const waiting = getItem('chat-launch');
        expect(waiting.kind === 'chat' && waiting.awaitingReply).toBe(true);

        await vi.advanceTimersByTimeAsync(MOCK_REPLY_DELAY_MS);
        const answered = getItem('chat-launch');
        if (answered.kind !== 'chat') throw new Error('expected a chat');
        expect(answered.awaitingReply).toBe(false);
        expect(answered.messages.at(-1)!.authorId).not.toBe(ME_ID);
    });

    it('does not auto-answer agents', () => {
        vi.useFakeTimers();
        postMessage({ chatId: 'chat-launch', authorId: AGENT_ID, text: 'Hi' });
        const chat = getItem('chat-launch');
        expect(chat.kind === 'chat' && chat.awaitingReply).toBeFalsy();
        expect(chat.kind === 'chat' && chat.participantIds).toContain(AGENT_ID);
    });

    it('will not post to a document', () => {
        expect(() =>
            postMessage({ chatId: 'doc-brief', authorId: ME_ID, text: 'x' }),
        ).toThrow(/not a chat/);
    });

    it('creates and extends documents', () => {
        const doc = createDocument({
            surfaceId: SEED_SURFACE_ID,
            title: 'Notes',
            blocks: markdownToPortableText('One'),
        });
        appendToDocument({
            documentId: doc.id,
            blocks: markdownToPortableText('## Two'),
        });
        const stored = getItem(doc.id);
        expect(stored.kind === 'document' && stored.blocks).toHaveLength(2);
    });

    it('only links and embeds items that exist', () => {
        expect(() =>
            createDocument({
                surfaceId: SEED_SURFACE_ID,
                title: 'Bad link',
                blocks: markdownToPortableText('See [it](item:missing)'),
            }),
        ).toThrow(/No item/);
        const doc = createDocument({
            surfaceId: SEED_SURFACE_ID,
            title: 'Good link',
            blocks: markdownToPortableText('See [Rosa](item:chat-customers)'),
        });
        expect(() =>
            appendToDocument({
                documentId: doc.id,
                blocks: markdownToPortableText('![](item:missing)'),
            }),
        ).toThrow(/No item/);
        const stored = getItem(doc.id);
        expect(stored.kind === 'document' && stored.blocks).toHaveLength(1);
    });

    it('saves edits on top of the version they started from, and refuses stale ones', () => {
        const doc = createDocument({
            surfaceId: SEED_SURFACE_ID,
            title: 'Edited',
            blocks: markdownToPortableText('First'),
        });
        const saved = updateDocument({
            documentId: doc.id,
            blocks: markdownToPortableText('Second'),
            baseUpdatedAt: doc.updatedAt,
        });
        expect(saved.authorId).toBe(ME_ID);
        expect(saved.updatedAt > doc.updatedAt).toBe(true);

        // An agent appends; a save still based on the earlier version fails.
        appendToDocument({
            documentId: doc.id,
            blocks: markdownToPortableText('Agent'),
        });
        expect(() =>
            updateDocument({
                documentId: doc.id,
                blocks: markdownToPortableText('Third'),
                baseUpdatedAt: saved.updatedAt,
            }),
        ).toThrow(SurfaceConflictError);
        expect(() =>
            updateDocument({
                documentId: doc.id,
                blocks: markdownToPortableText('[x](item:missing)'),
                baseUpdatedAt: (getItem(doc.id) as DocumentItem).updatedAt,
            }),
        ).toThrow(/No item/);
    });

    it('duplicates items with their color, relations, and own ids, but not pull requests', async () => {
        setItemColor('chat-launch', 'rose');
        const copy = duplicateItem({
            itemId: 'chat-launch',
            position: { x: 40, y: 50 },
        });
        const original = getItem('chat-launch');
        expect(copy).toMatchObject({
            kind: 'chat',
            title: `${original.title} (copy)`,
            createdById: ME_ID,
        });
        expect(copy.id).not.toBe('chat-launch');
        invariant(copy.kind === 'chat' && original.kind === 'chat');
        expect(copy.messages.map((m) => m.text)).toEqual(
            original.messages.map((m) => m.text),
        );
        expect(copy.messages[0]!.id).not.toBe(original.messages[0]!.id);

        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (surface) => surface!,
        );
        expect(surface.arrangement.colors[copy.id]).toBe('rose');
        expect(surface.arrangement.positions[copy.id]).toEqual({
            x: 40,
            y: 50,
        });
        expect(surface.arrangement.stack.at(-1)).toBe(copy.id);
        const linked = (id: string) =>
            surface.relations
                .filter((r) => r.from === id || r.to === id)
                .map((r) => r.label)
                .sort();
        expect(linked(copy.id)).toEqual(linked('chat-launch'));

        expect(() => duplicateItem({ itemId: 'pr-api-freeze' })).toThrow(
            /can not be duplicated/,
        );
    });

    it('adds cards as people do: placed or attached, with starting titles', async () => {
        const chat = addCard({
            surfaceId: SEED_SURFACE_ID,
            kind: 'chat',
            position: { x: 10, y: 20 },
        });
        expect(chat).toMatchObject({
            title: 'New chat',
            createdById: ME_ID,
            surfaceId: SEED_SURFACE_ID,
        });
        const board = addCard({
            surfaceId: SEED_SURFACE_ID,
            kind: 'board',
            title: 'Growth experiments',
        });
        expect(board).toMatchObject({ kind: 'board', key: 'GE' });
        const page = addCard({
            surfaceId: SEED_SURFACE_ID,
            kind: 'web',
            url: 'example.com/docs',
        });
        expect(page.title).toBe('example.com');

        const chart = addCard({
            surfaceId: SEED_SURFACE_ID,
            kind: 'chart',
            attachedTo: chat.id,
        });
        expect(chart).toMatchObject({ kind: 'chart', attachedTo: chat.id });
        const pr = addCard({
            surfaceId: SEED_SURFACE_ID,
            kind: 'pull-request',
            attachedTo: chat.id,
        });
        expect(pr).toMatchObject({ status: 'draft', chatId: chat.id });

        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (found) => found!,
        );
        expect(surface.arrangement.positions[chat.id]).toEqual({
            x: 10,
            y: 20,
        });
        // Attached cards hang from their parent, not a saved spot.
        expect(surface.arrangement.positions[chart.id]).toBeUndefined();

        expect(() =>
            addCard({ surfaceId: SEED_SURFACE_ID, kind: 'image' }),
        ).toThrow(/address/);
        expect(() =>
            addCard({ surfaceId: SEED_SURFACE_ID, kind: 'chart' }),
        ).toThrow(/chat or document/);
        expect(() =>
            addCard({
                surfaceId: 'northwind',
                kind: 'chart',
                attachedTo: chat.id,
            }),
        ).toThrow(/not on this surface/);
    });

    it('sticks notes on a surface, named by their first line, and rewrites them', async () => {
        const note = createNote({
            surfaceId: SEED_SURFACE_ID,
            text: '\n  Ship it Friday\nunless QA says no',
            color: 'rose',
        });
        expect(note).toMatchObject({ kind: 'note', title: 'Ship it Friday' });
        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (found) => found!,
        );
        expect(surface.arrangement.colors[note.id]).toBe('rose');

        const rewritten = updateNote({ noteId: note.id, text: '' });
        expect(rewritten.title).toBe('Empty note');
        expect(rewritten.updatedAt > note.updatedAt).toBe(true);
        expect(() => updateNote({ noteId: 'doc-brief', text: 'x' })).toThrow(
            /not a note/,
        );
    });

    it('adds images, marking GIFs animated', () => {
        const gif = createImage({
            url: 'https://example.com/spin.GIF?x=1',
            title: 'Spin',
            attachedTo: 'doc-brief',
        });
        expect(gif).toMatchObject({ animated: true, alt: '' });
        expect(
            createImage({
                surfaceId: SEED_SURFACE_ID,
                url: 'example.com/a.png',
                title: 'Still',
            }),
        ).toMatchObject({ src: 'https://example.com/a.png', animated: false });
        expect(() =>
            createImage({
                surfaceId: SEED_SURFACE_ID,
                url: 'http://example.com/a.png',
                title: 'x',
            }),
        ).toThrow(/not an https image/);
    });

    it('adds videos and web pages, hanging under chats and documents only', async () => {
        const video = createVideo({
            url: 'https://youtu.be/MnrJzXM7a6o',
            title: 'Launch',
            attachedTo: 'chat-launch',
        });
        expect(video.videoId).toBe('MnrJzXM7a6o');
        const page = createWebPage({
            surfaceId: SEED_SURFACE_ID,
            url: 'example.com',
            title: 'Example',
        });
        expect(page.url).toBe('https://example.com/');
        expect(page.attachedTo).toBeUndefined();
        const { relations } = await getSurfaceForUser(
            user,
            SEED_SURFACE_ID,
        ).then((surface) => surface!);
        expect(relations).toContainEqual(
            expect.objectContaining({
                from: 'chat-launch',
                to: video.id,
                label: 'video',
            }),
        );

        expect(() =>
            createVideo({
                surfaceId: SEED_SURFACE_ID,
                url: 'https://vimeo.com/1',
                title: 'x',
            }),
        ).toThrow(/not a YouTube video/);
        expect(() =>
            createWebPage({
                surfaceId: SEED_SURFACE_ID,
                url: 'http://example.com',
                title: 'x',
            }),
        ).toThrow(/not an https/);
        expect(() =>
            createWebPage({
                url: 'example.com',
                title: 'x',
                attachedTo: 'board-atlas',
            }),
        ).toThrow(/attach to chats and documents/);

        expect(
            navigateWebPage({ webId: page.id, url: 'example.org/a' }).url,
        ).toBe('https://example.org/a');
        expect(() =>
            navigateWebPage({ webId: video.id, url: 'example.org' }),
        ).toThrow(/not a web page/);
    });

    it('links items that exist, and only those', async () => {
        const relation = linkItems({
            from: 'chat-customers',
            to: 'chat-launch',
            label: 'escalates to',
        });
        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID).then(
            (surface) => surface!,
        );
        expect(surface.relations.at(-1)).toEqual(relation);
        expect(() =>
            linkItems({ from: 'chat-launch', to: 'missing', label: 'x' }),
        ).toThrow(/No item/);
    });

    it('keeps the stacking order, with new items on top', async () => {
        const seeded = (
            await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                (surface) => surface!,
            )
        ).arrangement.stack;
        restackItem('chat-launch', 'front');
        const doc = createDocument({
            surfaceId: SEED_SURFACE_ID,
            title: 'New',
            blocks: [],
        });
        restackItem('doc-brief', 'back');

        const { arrangement } = await getSurfaceForUser(
            user,
            SEED_SURFACE_ID,
        ).then((surface) => surface!);
        expect(arrangement.stack).toEqual([
            'doc-brief',
            ...seeded.filter(
                (id) => id !== 'doc-brief' && id !== 'chat-launch',
            ),
            'chat-launch',
            doc.id,
        ]);
    });

    it('sets and clears border colors', async () => {
        setItemColor('chat-launch', 'rose');
        expect(
            (
                await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                    (surface) => surface!,
                )
            ).arrangement.colors,
        ).toEqual({
            'chat-launch': 'rose',
        });
        setItemColor('chat-launch', null);
        expect(
            (
                await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                    (surface) => surface!,
                )
            ).arrangement.colors,
        ).toEqual({});
    });

    it('saves moved windows, ignores unknown ones, and forgets them on reset', async () => {
        moveWindows({
            'chat-launch': { x: 10, y: -20 },
            missing: { x: 1, y: 1 },
        });
        moveWindows({ 'doc-brief': { x: 400, y: 0 } });
        expect(
            (
                await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                    (surface) => surface!,
                )
            ).arrangement.positions,
        ).toEqual({
            'chat-launch': { x: 10, y: -20 },
            'doc-brief': { x: 400, y: 0 },
        });
        resetWindowPositions(SEED_SURFACE_ID);
        expect(
            (
                await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                    (surface) => surface!,
                )
            ).arrangement.positions,
        ).toEqual({});
    });

    it('will not arrange items that do not exist', () => {
        expect(() => restackItem('missing', 'front')).toThrow(/No item/);
        expect(() => setItemColor('missing', 'sky')).toThrow(/No item/);
    });

    it('starts with views framing related windows', async () => {
        const { views, items } = await getSurfaceForUser(
            user,
            SEED_SURFACE_ID,
        ).then((surface) => surface!);
        const ids = new Set(items.map((item) => item.id));
        expect(views.map((view) => view.name)).toEqual([
            'Atlas launch',
            'Northwind SSO',
            'Launch numbers',
            'Issue board',
        ]);
        for (const view of views) {
            expect(view.itemIds!.every((id) => ids.has(id))).toBe(true);
            expect(view.zoom).toBeGreaterThan(0);
        }
    });

    it('saves, finds, and deletes views', async () => {
        const view = saveView({
            surfaceId: SEED_SURFACE_ID,
            name: 'Launch',
            center: { x: 10, y: 20 },
            zoom: 1.5,
        });
        expect(getSavedView(view.id)).toEqual(view);
        expect(
            (
                await getSurfaceForUser(user, SEED_SURFACE_ID).then(
                    (surface) => surface!,
                )
            ).views,
        ).toContainEqual(view);

        deleteView(view.id);
        expect(getSavedView(view.id)).toBeNull();
        expect(() => deleteView(view.id)).toThrow(/No view/);
    });

    it('creates charts under chats and documents only', () => {
        const chart = createChart({
            attachedTo: 'doc-brief',
            title: 'Signups',
            chart: 'bar',
            unit: 'signups',
            points: [
                { label: 'Mon', value: 1 },
                { label: 'Tue', value: 2 },
            ],
        });
        expect(chart).toMatchObject({
            kind: 'chart',
            attachedTo: 'doc-brief',
            createdById: AGENT_ID,
        });
        expect(() =>
            createChart({
                attachedTo: 'pr-api-freeze',
                title: 'x',
                chart: 'line',
                unit: 'x',
                points: [],
            }),
        ).toThrow(/attach to chats and documents/);
    });

    it('numbers new issues after the highest on the board', () => {
        const created = createIssue({
            boardId: 'board-atlas',
            title: 'Translate the docs',
            priority: 'low',
        });
        expect(created).toMatchObject({
            identifier: 'ATL-18',
            status: 'todo',
            createdById: AGENT_ID,
        });

        const fresh = createBoard({
            surfaceId: SEED_SURFACE_ID,
            title: 'Billing',
            key: 'bil',
        });
        expect(
            createIssue({ boardId: fresh.id, title: 'First' }).identifier,
        ).toBe('BIL-1');
    });

    it('moves issues by id or identifier', () => {
        expect(
            updateIssue({
                boardId: 'board-atlas',
                issueId: 'ATL-13',
                status: 'in_progress',
            }).status,
        ).toBe('in_progress');
        expect(() =>
            updateIssue({ boardId: 'board-atlas', issueId: 'ATL-99' }),
        ).toThrow(/No issue/);
        expect(() => createIssue({ boardId: 'doc-brief', title: 'x' })).toThrow(
            /not a board/,
        );
    });

    it('reorders issues within a column', () => {
        updateIssue({ boardId: 'board-atlas', issueId: 'ATL-12', index: 0 });
        const board = getItem('board-atlas');
        if (board.kind !== 'board') throw new Error('expected a board');
        expect(
            board.issues
                .filter((i) => i.status === 'backlog')
                .map((i) => i.identifier),
        ).toEqual(['ATL-12', 'ATL-11']);
    });

    it('deletes a card with what hangs under it and everything pointing at them', async () => {
        const doc = createDocument({
            surfaceId: SEED_SURFACE_ID,
            title: 'Doomed',
            blocks: [],
        });
        const chart = createChart({
            title: 'Doomed chart',
            attachedTo: doc.id,
            chart: 'bar',
            unit: 'signups',
            points: [{ label: 'Mon', value: 1 }],
        });
        linkItems({ from: 'chat-launch', to: doc.id, label: 'related' });
        setItemColor(doc.id, 'rose');
        setItemLocked(doc.id, true, { x: 5, y: 5 });

        expect(deleteItem(doc.id)).toEqual([doc.id, chart.id]);
        expect(() => getItem(doc.id)).toThrow(SurfaceError);
        expect(() => getItem(chart.id)).toThrow(SurfaceError);
        const surface = (await getSurfaceForUser(user, SEED_SURFACE_ID))!;
        expect(
            surface.relations.some(
                (relation) =>
                    relation.to === doc.id || relation.from === doc.id,
            ),
        ).toBe(false);
        expect(surface.arrangement.stack).not.toContain(doc.id);
        expect(surface.arrangement.locked).not.toContain(doc.id);
        expect(surface.arrangement.colors[doc.id]).toBeUndefined();
        expect(surface.arrangement.positions[doc.id]).toBeUndefined();
    });

    it('drops shape cards a store from before their removal still holds', () => {
        // A dev store outlives code reloads, so one can still hold them.
        const raw = (
            globalThis as unknown as Record<
                symbol,
                {
                    items: Record<string, unknown>[];
                    relations: Record<string, unknown>[];
                    surfaces: {
                        id: string;
                        arrangement: { stack: string[] };
                    }[];
                }
            >
        )[Symbol.for('company-surface.mock-store')]!;
        raw.items.push({
            kind: 'shape',
            id: 'shape-old',
            surfaceId: SEED_SURFACE_ID,
            title: 'Old',
        });
        raw.relations.push({
            id: 'r-old',
            from: 'doc-brief',
            to: 'shape-old',
            label: 'x',
        });
        raw.surfaces
            .find((surface) => surface.id === SEED_SURFACE_ID)!
            .arrangement.stack.push('shape-old');

        expect(listItems(SEED_SURFACE_ID).map((item) => item.id)).not.toContain(
            'shape-old',
        );
        expect(raw.relations.some((relation) => relation.id === 'r-old')).toBe(
            false,
        );
        expect(
            raw.surfaces.find((surface) => surface.id === SEED_SURFACE_ID)!
                .arrangement.stack,
        ).not.toContain('shape-old');
    });

    it('renames cards, trimmed, without touching a document version', () => {
        const before = getItem('doc-brief') as DocumentItem;
        expect(
            renameItem({ itemId: 'doc-brief', title: '  Launch brief v2 ' })
                .title,
        ).toBe('Launch brief v2');
        expect((getItem('doc-brief') as DocumentItem).updatedAt).toBe(
            before.updatedAt,
        );
        expect(() => renameItem({ itemId: 'doc-brief', title: '  ' })).toThrow(
            /1 to 160/,
        );
        const note = createNote({ surfaceId: SEED_SURFACE_ID, text: 'Hi' });
        expect(() => renameItem({ itemId: note.id, title: 'Bye' })).toThrow(
            /first line/,
        );
    });

    it('resizes chats within their limits and keeps the size as their resting one', async () => {
        const chat = resizeItem({
            itemId: 'chat-launch',
            size: { width: 9000, height: 100 },
        });
        expect(chat).toMatchObject({ size: { width: 1138, height: 640 } });
        resizeItem({
            itemId: 'chat-launch',
            size: { width: 500.4, height: 800 },
            position: { x: -20.2, y: 10 },
        });
        const surface = await getSurfaceForUser(user, SEED_SURFACE_ID);
        invariant(surface);
        expect(
            surface.items.find((item) => item.id === 'chat-launch'),
        ).toMatchObject({ size: { width: 500, height: 800 } });
        expect(surface.arrangement.positions['chat-launch']).toEqual({
            x: -20,
            y: 10,
        });
        const spot = getLayout(SEED_SURFACE_ID).find(
            (card) => card.id === 'chat-launch',
        );
        expect(spot).toMatchObject({ width: 500, height: 800 });
        expect(() =>
            resizeItem({
                itemId: 'doc-brief',
                size: { width: 1000, height: 600 },
            }),
        ).toThrow(/can't be resized/);
    });

    it('starts sketches blank and saves their whole drawing', () => {
        const sketch = createSketch({ surfaceId: SEED_SURFACE_ID });
        expect(sketch).toMatchObject({
            kind: 'sketch',
            title: 'Untitled sketch',
            strokes: [],
        });
        const stroke = { color: '#ff0000', size: 5, points: [1, 2, 3, 4] };
        const saved = updateSketch({ sketchId: sketch.id, strokes: [stroke] });
        expect(getItem(sketch.id)).toMatchObject({ strokes: [stroke] });
        expect(saved.updatedAt > sketch.updatedAt).toBe(true);
        expect(() =>
            updateSketch({ sketchId: 'doc-brief', strokes: [] }),
        ).toThrow(/not a sketch/);
        expect(
            addCard({ surfaceId: SEED_SURFACE_ID, kind: 'sketch' }).kind,
        ).toBe('sketch');
    });

    it('keeps locked cards where they are through Arrange', async () => {
        moveWindows({
            'chat-launch': { x: 900, y: 900 },
            'doc-brief': { x: 50, y: 50 },
        });
        setItemLocked('chat-launch', true, { x: 1000, y: 1000 });
        resetWindowPositions(SEED_SURFACE_ID);
        const surface = (await getSurfaceForUser(user, SEED_SURFACE_ID))!;
        expect(surface.arrangement.locked).toContain('chat-launch');
        expect(surface.arrangement.positions).toEqual({
            'chat-launch': { x: 1000, y: 1000 },
        });

        setItemLocked('chat-launch', false);
        const unlocked = (await getSurfaceForUser(user, SEED_SURFACE_ID))!;
        expect(unlocked.arrangement.locked).not.toContain('chat-launch');
    });

    it('unlinks cards by link id or by the pair, either way round', () => {
        const a = createNote({ surfaceId: SEED_SURFACE_ID, text: 'A' });
        const b = createNote({ surfaceId: SEED_SURFACE_ID, text: 'B' });
        const first = linkItems({ from: a.id, to: b.id, label: 'related' });
        unlinkItems(first.id);
        expect(() => unlinkItems(first.id)).toThrow(/No link/);

        linkItems({ from: a.id, to: b.id, label: 'related' });
        linkItems({ from: b.id, to: a.id, label: 'answers' });
        expect(unlinkCards({ from: b.id, to: a.id })).toBe(2);
        expect(unlinkCards({ from: a.id, to: b.id })).toBe(0);
    });

    it('edits an issue in place and keeps its comments', () => {
        updateIssue({
            boardId: 'board-atlas',
            issueId: 'ATL-14',
            title: 'Freeze the API',
            description: 'No new endpoints after Friday.',
            assigneeId: null,
        });
        const comment = commentOnIssue({
            boardId: 'board-atlas',
            issueId: 'ATL-14',
            text: 'Agreed',
            authorId: ME_ID,
        });
        const board = getItem('board-atlas');
        if (board.kind !== 'board') throw new Error('expected a board');
        const issue = board.issues.find((i) => i.identifier === 'ATL-14')!;
        expect(issue).toMatchObject({
            title: 'Freeze the API',
            description: 'No new endpoints after Friday.',
        });
        expect(issue.assigneeId).toBeUndefined();
        expect(issue.comments).toContainEqual(comment);
        expect(() =>
            commentOnIssue({
                boardId: 'board-atlas',
                issueId: 'ATL-14',
                text: 'x',
                authorId: 'nobody',
            }),
        ).toThrow(SurfaceError);
    });

    it('finishes in-review issues when their pull request merges', () => {
        setPullRequestStatus('pr-api-freeze', 'merged');
        const board = getItem('board-atlas');
        if (board.kind !== 'board') throw new Error('expected a board');
        expect(
            board.issues.find((i) => i.identifier === 'ATL-14')!.status,
        ).toBe('done');
        // An issue not in review stays where it is.
        expect(
            board.issues.find((i) => i.identifier === 'ATL-17')!.status,
        ).toBe('in_progress');
    });
});
