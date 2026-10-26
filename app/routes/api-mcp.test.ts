import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
    env: {
        NODE_ENV: 'development' as 'development' | 'production' | 'test',
        MCP_API_KEY: undefined as string | undefined,
        BETTER_AUTH_BASE_URL: 'http://localhost:5173',
    },
}));
vi.mock('~/lib/env.server', () => ({ env }));

import type { SessionUser } from '~/context';
import { getSurfaceForUser, resetSurface } from '~/models/surface.server';
import { action } from './api-mcp';
import type { Route } from './+types/api-mcp';

const KEY = 'k'.repeat(40);

function rpc(
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
) {
    const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return action({ request } as Route.ActionArgs);
}

async function callTool(
    name: string,
    args: Record<string, unknown>,
    headers: Record<string, string> = {},
) {
    const response = await rpc(
        'tools/call',
        { name, arguments: args },
        headers,
    );
    const body = await response.json();
    return body.result as {
        content: { text: string }[];
        isError?: boolean;
    };
}

beforeEach(() => {
    resetSurface();
    env.NODE_ENV = 'development';
    env.MCP_API_KEY = undefined;
});

describe('/api/mcp', () => {
    it('lists the surface tools', async () => {
        const response = await rpc('tools/list');
        expect(response.status).toBe(200);
        const { result } = await response.json();
        expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(
            expect.arrayContaining([
                'create_chat',
                'create_document',
                'post_message',
                'link_cards',
            ]),
        );
    });

    it("still answers to the tools' old names, pointing agents at the new ones", async () => {
        const { result } = await (await rpc('tools/list')).json();
        const tools: { name: string; description: string }[] = result.tools;
        for (const [oldName, newName] of [
            ['list_items', 'list_cards'],
            ['get_item', 'get_card'],
            ['link_items', 'link_cards'],
            ['duplicate_item', 'duplicate_card'],
            ['set_window_color', 'set_card_color'],
            ['restack_window', 'restack_card'],
        ]) {
            expect(
                tools.find((tool) => tool.name === oldName)?.description,
            ).toMatch(new RegExp(`old name for ${newName}`));
        }
        const old = JSON.parse(
            (await callTool('get_item', { itemId: 'doc-brief' })).content[0]!
                .text,
        );
        expect(old.title).toBe('Atlas launch brief');
    });

    it('creates a document an agent can then read back', async () => {
        const created = await callTool('create_document', {
            surfaceId: 'atlas-launch',
            title: 'Roadmap',
            markdown: 'Q1 goals',
        });
        const doc = JSON.parse(created.content[0]!.text);
        expect(doc.url).toBe(
            `http://localhost:5173/surfaces/atlas-launch/cards/${doc.id}`,
        );

        const items = await callTool('list_cards', {});
        expect(JSON.parse(items.content[0]!.text)).toContainEqual({
            id: doc.id,
            kind: 'document',
            title: 'Roadmap',
            surfaceId: 'atlas-launch',
        });
    });

    it('writes documents from Markdown and reads them back as Markdown', async () => {
        const markdown =
            '## Plan\n\nAsk [Rosa](item:chat-customers) about **SSO**.\n\n![](item:board-atlas)';
        const created = await callTool('create_document', {
            surfaceId: 'atlas-launch',
            title: 'Linked',
            markdown,
        });
        const doc = JSON.parse(created.content[0]!.text);
        expect(doc.markdown).toBe(markdown);
        expect(doc.blocks).toBeUndefined();

        await callTool('append_to_document', {
            documentId: doc.id,
            markdown: '- One more',
        });
        const read = await callTool('get_card', { itemId: doc.id });
        expect(JSON.parse(read.content[0]!.text).markdown).toBe(
            `${markdown}\n\n- One more`,
        );

        const bad = await callTool('create_document', {
            surfaceId: 'atlas-launch',
            title: 'Broken',
            markdown: '[gone](item:missing)',
        });
        expect(bad.isError).toBe(true);
        expect(bad.content[0]!.text).toMatch(/No item/);
    });

    it('adds YouTube videos and web pages, and moves a page elsewhere', async () => {
        const video = JSON.parse(
            (
                await callTool('add_video', {
                    url: 'https://www.youtube.com/watch?v=MnrJzXM7a6o',
                    title: 'Keynote',
                    attachedTo: 'doc-brief',
                })
            ).content[0]!.text,
        );
        expect(video).toMatchObject({
            kind: 'video',
            videoId: 'MnrJzXM7a6o',
            url: `http://localhost:5173/surfaces/atlas-launch/cards/${video.id}`,
        });

        const page = JSON.parse(
            (
                await callTool('add_web_page', {
                    surfaceId: 'atlas-launch',
                    url: 'example.com',
                    title: 'Ex',
                })
            ).content[0]!.text,
        );
        expect(page).toMatchObject({
            kind: 'web',
            url: 'https://example.com/',
            link: `http://localhost:5173/surfaces/atlas-launch/cards/${page.id}`,
        });
        const moved = JSON.parse(
            (
                await callTool('navigate_web_page', {
                    webId: page.id,
                    url: 'https://example.org/',
                })
            ).content[0]!.text,
        );
        expect(moved.url).toBe('https://example.org/');

        const image = JSON.parse(
            (
                await callTool('add_image', {
                    surfaceId: 'atlas-launch',
                    url: 'https://example.com/loop.gif',
                    title: 'Loop',
                    alt: 'A loop',
                })
            ).content[0]!.text,
        );
        expect(image).toMatchObject({ kind: 'image', animated: true });

        const copy = JSON.parse(
            (await callTool('duplicate_card', { itemId: image.id })).content[0]!
                .text,
        );
        expect(copy).toMatchObject({ kind: 'image', title: 'Loop (copy)' });

        const bad = await callTool('add_video', {
            surfaceId: 'atlas-launch',
            url: 'https://vimeo.com/1',
            title: 'Nope',
        });
        expect(bad.isError).toBe(true);
    });

    it('searches messages, issues, and documents, pointing inside windows', async () => {
        const result = await callTool('search', { query: 'fast follow' });
        const hits: { itemId: string; snippet: string }[] = JSON.parse(
            result.content[0]!.text,
        );
        // The pull request's title says it too, and titles count most.
        expect(hits[0]!.itemId).toBe('pr-sso-flag');
        const doc = hits.find((hit) => hit.itemId === 'doc-sso-notes');
        expect(doc).toMatchObject({
            kind: 'document',
            url: 'http://localhost:5173/surfaces/atlas-launch/cards/doc-sso-notes',
        });
        expect(doc!.snippet).toMatch(/fast follow/i);
        expect(doc).not.toHaveProperty('ranges');

        const issue = JSON.parse(
            (await callTool('search', { query: 'ATL-13' })).content[0]!.text,
        )[0];
        expect(issue).toMatchObject({ kind: 'board', subLabel: 'ATL-13' });
    });

    it('lists spaces and surfaces, starts new ones, and keeps cards on theirs', async () => {
        const spaces = JSON.parse(
            (await callTool('list_spaces', {})).content[0]!.text,
        );
        expect(spaces.map((space: { id: string }) => space.id)).toEqual([
            'product',
            'customers',
            'design',
            'playground',
        ]);
        expect(spaces[0].surfaces[0]).toMatchObject({
            id: 'atlas-launch',
            url: 'http://localhost:5173/surfaces/atlas-launch',
        });

        const space = JSON.parse(
            (await callTool('create_space', { name: 'Ops' })).content[0]!.text,
        );
        const surface = JSON.parse(
            (
                await callTool('create_surface', {
                    spaceId: space.id,
                    name: 'On-call',
                })
            ).content[0]!.text,
        );
        expect(surface).toMatchObject({ cardCount: 0, spaceId: space.id });
        await callTool('create_chat', {
            surfaceId: surface.id,
            title: 'Pager',
        });
        const onCall = JSON.parse(
            (await callTool('list_cards', { surfaceId: surface.id }))
                .content[0]!.text,
        );
        expect(onCall.map((card: { title: string }) => card.title)).toEqual([
            'Pager',
        ]);

        // Cards and links stay within one surface.
        const crossLink = await callTool('link_cards', {
            from: onCall[0].id,
            to: 'doc-brief',
            label: 'about',
        });
        expect(crossLink.isError).toBe(true);
        const noSurface = await callTool('create_chat', { title: 'Lost' });
        expect(noSurface.isError).toBe(true);
    });

    it('reports store errors as tool errors', async () => {
        const result = await callTool('get_card', { itemId: 'missing' });
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toMatch(/No item/);
    });

    it('saves a view framing items, lists it, and deletes it', async () => {
        const saved = await callTool('save_view', {
            surfaceId: 'atlas-launch',
            name: 'Launch chat',
            itemIds: ['chat-launch'],
        });
        const view = JSON.parse(saved.content[0]!.text);
        expect(view).toMatchObject({
            name: 'Launch chat',
            itemIds: ['chat-launch'],
            center: { x: 180, y: 320 },
            url: `http://localhost:5173/surfaces/atlas-launch/views/${view.id}`,
        });

        const listed = await callTool('list_views', {});
        expect(JSON.parse(listed.content[0]!.text)).toContainEqual(view);

        await callTool('delete_view', { viewId: view.id });
        const after = await callTool('list_views', {});
        expect(JSON.parse(after.content[0]!.text)).not.toContainEqual(view);
    });

    it('saves a view at an exact spot, and refuses one with neither', async () => {
        const saved = await callTool('save_view', {
            surfaceId: 'atlas-launch',
            name: 'Here',
            center: { x: 10, y: 20 },
            zoom: 0.5,
        });
        expect(JSON.parse(saved.content[0]!.text)).toMatchObject({
            center: { x: 10, y: 20 },
            zoom: 0.5,
        });

        const refused = await callTool('save_view', {
            surfaceId: 'atlas-launch',
            name: 'Nowhere',
        });
        expect(refused.isError).toBe(true);

        const unknown = await callTool('save_view', {
            surfaceId: 'atlas-launch',
            name: 'Ghosts',
            itemIds: ['missing'],
        });
        expect(unknown.isError).toBe(true);
    });

    it('colors and restacks windows the app then shows', async () => {
        await callTool('set_card_color', {
            itemId: 'doc-brief',
            color: 'sky',
        });
        const restacked = await callTool('restack_card', {
            itemId: 'chat-launch',
            to: 'front',
        });
        expect(JSON.parse(restacked.content[0]!.text).stack.at(-1)).toBe(
            'chat-launch',
        );

        const { arrangement } = await getSurfaceForUser(
            {
                name: 'A',
                email: 'a@example.test',
            } as SessionUser,
            'atlas-launch',
        ).then((surface) => surface!);
        expect(arrangement.colors).toEqual({ 'doc-brief': 'sky' });
        expect(arrangement.stack.at(-1)).toBe('chat-launch');

        await callTool('set_card_color', {
            itemId: 'doc-brief',
            color: null,
        });
        const cleared = await getSurfaceForUser(
            {
                name: 'A',
                email: 'a@example.test',
            } as SessionUser,
            'atlas-launch',
        ).then((surface) => surface!);
        expect(cleared.arrangement.colors).toEqual({});
    });

    it('rejects colors outside the palette', async () => {
        const result = await callTool('set_card_color', {
            itemId: 'doc-brief',
            color: 'chartreuse',
        });
        expect(result.isError).toBe(true);
    });

    it('opens a pull request from a chat and merges it', async () => {
        const opened = await callTool('open_pull_request', {
            chatId: 'chat-launch',
            title: 'Rate limit the public API',
            branch: 'atlas/rate-limit',
            files: [{ path: 'api/limits.ts', additions: 40, deletions: 2 }],
        });
        const pr = JSON.parse(opened.content[0]!.text);
        expect(pr).toMatchObject({
            kind: 'pull-request',
            chatId: 'chat-launch',
            status: 'open',
            // The seed's pull requests run up to #495.
            number: 496,
            checks: { pending: 8 },
        });

        const chat = JSON.parse(
            (await callTool('get_card', { itemId: 'chat-launch' })).content[0]!
                .text,
        );
        expect(chat.messages.at(-1).text).toMatch(/Opened #496/);

        const merged = await callTool('set_pull_request_status', {
            pullRequestId: pr.id,
            status: 'merged',
        });
        expect(JSON.parse(merged.content[0]!.text)).toMatchObject({
            status: 'merged',
            checks: { passed: 8, pending: 0 },
        });
    });

    it('only opens pull requests from chats', async () => {
        const result = await callTool('open_pull_request', {
            chatId: 'doc-brief',
            title: 'x',
            branch: 'x',
        });
        expect(result.isError).toBe(true);
    });

    it('charts a document, marked as agent-made', async () => {
        const created = await callTool('create_chart', {
            attachedTo: 'doc-brief',
            title: 'Partners',
            chart: 'bar',
            unit: 'partners',
            points: [
                { label: 'Q1', value: 4 },
                { label: 'Q2', value: 9 },
            ],
        });
        expect(JSON.parse(created.content[0]!.text)).toMatchObject({
            kind: 'chart',
            attachedTo: 'doc-brief',
            createdById: 'agent',
        });

        const tooFew = await callTool('create_chart', {
            attachedTo: 'doc-brief',
            title: 'One point',
            chart: 'line',
            unit: 'x',
            points: [{ label: 'Q1', value: 1 }],
        });
        expect(tooFew.isError).toBe(true);
    });

    it('runs a board: create it, file issues, move one', async () => {
        const board = JSON.parse(
            (
                await callTool('create_board', {
                    surfaceId: 'atlas-launch',
                    title: 'Billing',
                    key: 'bil',
                })
            ).content[0]!.text,
        );
        expect(board).toMatchObject({ kind: 'board', key: 'BIL' });

        const filed = JSON.parse(
            (
                await callTool('create_issue', {
                    boardId: board.id,
                    title: 'Invoice PDFs',
                    priority: 'high',
                    links: ['doc-brief'],
                })
            ).content[0]!.text,
        );
        expect(filed).toMatchObject({
            identifier: 'BIL-1',
            status: 'todo',
            priority: 'high',
            createdById: 'agent',
        });

        const moved = JSON.parse(
            (
                await callTool('update_issue', {
                    boardId: board.id,
                    issueId: 'BIL-1',
                    status: 'in_progress',
                })
            ).content[0]!.text,
        );
        expect(moved.status).toBe('in_progress');

        const badKey = await callTool('create_board', {
            surfaceId: 'atlas-launch',
            title: 'x',
            key: 'way-too-long',
        });
        expect(badKey.isError).toBe(true);
    });

    it('is open in development when no key is set', async () => {
        expect((await rpc('tools/list')).status).toBe(200);
    });

    it('is off in production when no key is set', async () => {
        env.NODE_ENV = 'production';
        expect((await rpc('tools/list')).status).toBe(503);
    });

    it('requires the bearer token once a key is set', async () => {
        env.MCP_API_KEY = KEY;
        expect((await rpc('tools/list')).status).toBe(401);
        expect(
            (await rpc('tools/list', {}, { Authorization: 'Bearer wrong' }))
                .status,
        ).toBe(401);
        expect(
            (await rpc('tools/list', {}, { Authorization: `Bearer ${KEY}` }))
                .status,
        ).toBe(200);
    });
});
