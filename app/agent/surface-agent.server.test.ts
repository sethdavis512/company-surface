import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolExecutionOptions } from 'ai';
import { AGENT_ID, isAgentChat, type ChatItem } from '~/lib/surface';
import {
    ME_ID,
    allItems,
    getItem,
    getSurfaceForUser,
    postMessage,
    resetSurface,
} from '~/models/surface.server';
import type { SessionUser } from '~/context';
import {
    chatHistory,
    readableToolError,
    replyText,
    surfaceTools,
} from './surface-agent.server';

const CHAT_ID = 'chat-agent';
const SURFACE_ID = 'agent-test-drive';
const options = { toolCallId: 'call', messages: [] } as ToolExecutionOptions;

function tools() {
    return surfaceTools({ surfaceId: SURFACE_ID, chatId: CHAT_ID });
}

function chat(): ChatItem {
    const item = getItem(CHAT_ID);
    if (item.kind !== 'chat') throw new Error('not a chat');
    return item;
}

beforeEach(() => resetSurface());

describe('the playground', () => {
    it('is a space with one live agent chat', async () => {
        const surface = await getSurfaceForUser(
            { name: 'Pat' } as SessionUser,
            SURFACE_ID,
        );
        expect(surface?.space.name).toBe('Playground');
        expect(surface?.items.map((item) => item.id)).toEqual([CHAT_ID]);
        expect(isAgentChat(chat())).toBe(true);
    });
});

describe('isAgentChat', () => {
    it('is the agent with people from this side only', () => {
        expect(isAgentChat({ participantIds: [ME_ID, AGENT_ID] })).toBe(true);
        expect(isAgentChat({ participantIds: [ME_ID, 'maya'] })).toBe(false);
        expect(isAgentChat({ participantIds: [AGENT_ID, 'dev', ME_ID] })).toBe(
            false,
        );
    });
});

describe('postMessage for the live agent', () => {
    it('keeps the id it is given and leaves the reply to the agent', () => {
        postMessage({
            chatId: CHAT_ID,
            authorId: ME_ID,
            text: 'Hi',
            id: 'client-id',
            mockReply: false,
        });
        expect(chat().messages.at(-1)?.id).toBe('client-id');
        expect(chat().awaitingReply).toBeFalsy();
        expect(() =>
            postMessage({
                chatId: CHAT_ID,
                authorId: ME_ID,
                text: 'Hi',
                id: 'client-id',
            }),
        ).toThrow(/already there/);
    });
});

describe('surfaceTools', () => {
    it('writes a document on the chat surface, linked from the chat', async () => {
        const made = await tools().create_document.execute!(
            { title: 'Launch plan', markdown: '## Goals\n\n- Ship it' },
            options,
        );
        expect(made).toMatchObject({ kind: 'document', title: 'Launch plan' });
        const doc = getItem((made as { id: string }).id);
        expect(doc.surfaceId).toBe(SURFACE_ID);
        const surface = await getSurfaceForUser(
            { name: 'Pat' } as SessionUser,
            SURFACE_ID,
        );
        expect(surface?.relations).toContainEqual(
            expect.objectContaining({
                from: CHAT_ID,
                to: doc.id,
                label: 'made',
            }),
        );
    });

    it('hangs charts under the chat by default', async () => {
        const made = await tools().create_chart.execute!(
            {
                title: 'Signups',
                chart: 'line',
                unit: 'signups',
                points: [
                    { label: 'W1', value: 3 },
                    { label: 'W2', value: 5 },
                ],
            },
            options,
        );
        const item = getItem((made as { id: string }).id);
        expect(item).toMatchObject({ kind: 'chart', attachedTo: CHAT_ID });
    });

    it('files issues by board, and moves them by identifier', async () => {
        const board = (await tools().create_board.execute!(
            { title: 'Website', key: 'WEB' },
            options,
        )) as { id: string };
        const filed = await tools().create_issue.execute!(
            { boardId: board.id, title: 'Hero copy', description: 'Warmer' },
            options,
        );
        expect(filed).toMatchObject({
            id: board.id,
            issue: { identifier: 'WEB-1', title: 'Hero copy' },
        });
        await tools().update_issue.execute!(
            { boardId: board.id, issue: 'WEB-1', status: 'done' },
            options,
        );
        const saved = getItem(board.id);
        expect(saved.kind === 'board' && saved.issues[0]).toMatchObject({
            status: 'done',
            description: 'Warmer',
        });
    });

    it('reads other surfaces, saying where a card lives', async () => {
        const brief = (await tools().read_card.execute!(
            { cardId: 'doc-brief' },
            options,
        )) as unknown as {
            id: string;
            markdown: string;
            surface: string;
            space: string;
        };
        expect(brief).toMatchObject({
            id: 'doc-brief',
            surface: 'Atlas launch',
            space: 'Product',
        });
        expect(brief.markdown).toContain('Timeline');

        const own = (await tools().read_card.execute!(
            { cardId: CHAT_ID },
            options,
        )) as Record<string, unknown>;
        expect(own).not.toHaveProperty('surface');
    });

    it('lists spaces and other surfaces’ cards', async () => {
        const { spaces } = (await tools().list_spaces.execute!(
            {},
            options,
        )) as { spaces: { name: string; surfaces: { id: string }[] }[] };
        expect(spaces.map(({ name }) => name)).toContain('Customers');
        expect(spaces.flatMap(({ surfaces }) => surfaces)).toContainEqual(
            expect.objectContaining({ id: 'northwind' }),
        );

        const { cards } = (await tools().list_cards.execute!(
            { surfaceId: 'northwind' },
            options,
        )) as { cards: { id: string }[] };
        expect(cards.map(({ id }) => id)).toEqual(['doc-northwind-plan']);
    });

    it('searches this surface, or everywhere when asked', async () => {
        const here = (await tools().search.execute!(
            { query: 'Northwind' },
            options,
        )) as { hits: unknown[] };
        expect(here.hits).toEqual([]);

        const everywhere = (await tools().search.execute!(
            { query: 'Northwind', everywhere: true },
            options,
        )) as { hits: { id: string; surface?: string }[] };
        expect(everywhere.hits).toContainEqual(
            expect.objectContaining({
                id: 'doc-northwind-plan',
                surface: 'Northwind',
            }),
        );
    });

    it('never changes cards on other surfaces', () => {
        const before = allItems().length;
        expect(() =>
            tools().create_chart.execute!(
                {
                    title: 'Elsewhere',
                    chart: 'bar',
                    unit: 'x',
                    points: [
                        { label: 'a', value: 1 },
                        { label: 'b', value: 2 },
                    ],
                    attachedTo: 'doc-brief',
                },
                options,
            ),
        ).toThrow(/another surface/);
        expect(() =>
            tools().rename_card.execute!(
                { cardId: 'doc-brief', title: 'Mine now' },
                options,
            ),
        ).toThrow(/another surface/);
        expect(allItems()).toHaveLength(before);
        expect(getItem('doc-brief').title).not.toBe('Mine now');
    });
});

describe('chatHistory', () => {
    it("reads the agent's replies, tool calls and all, as the assistant", () => {
        postMessage({
            chatId: CHAT_ID,
            authorId: ME_ID,
            text: 'Chart it',
            mockReply: false,
        });
        postMessage({
            chatId: CHAT_ID,
            authorId: AGENT_ID,
            text: 'Done.',
            parts: [
                {
                    type: 'tool-create_chart',
                    toolCallId: 'c1',
                    state: 'output-available',
                    input: {},
                    output: { id: 'chart-1' },
                },
                { type: 'text', text: 'Done.' },
            ],
        });
        const history = chatHistory(chat());
        expect(history.map((message) => message.role)).toEqual([
            'assistant',
            'user',
            'assistant',
        ]);
        expect(history[2]?.parts[0]).toMatchObject({
            type: 'tool-create_chart',
        });
        expect(replyText(history[2]!)).toBe('Done.');
    });
});

describe('layout tools', () => {
    it('arrange cards into groups and save where they land', async () => {
        const doc = (await tools().create_document.execute!(
            { title: 'Plan', markdown: 'x' },
            options,
        )) as { id: string };
        const note = (await tools().add_note.execute!(
            { text: 'Heading' },
            options,
        )) as { id: string };
        const before = (await getSurfaceForUser(
            { name: 'Pat' } as SessionUser,
            SURFACE_ID,
        ))!.arrangement.layoutVersion;

        const result = (await tools().arrange_cards.execute!(
            { groups: [[note.id, doc.id], [CHAT_ID]], direction: 'columns' },
            options,
        )) as { moved: number; groups: unknown[] };
        expect(result).toMatchObject({ moved: 3 });
        expect(result.groups).toHaveLength(2);

        const { cards } = (await tools().get_layout.execute!({}, options)) as {
            cards: { id: string; x: number; y: number }[];
        };
        const at = (id: string) => cards.find((card) => card.id === id)!;
        expect(at(doc.id).x).toBe(at(note.id).x);
        expect(at(doc.id).y).toBeGreaterThan(at(note.id).y);
        expect(at(CHAT_ID).x).toBeGreaterThan(at(doc.id).x);

        const after = (await getSurfaceForUser(
            { name: 'Pat' } as SessionUser,
            SURFACE_ID,
        ))!.arrangement.layoutVersion;
        expect(after).toBe((before ?? 0) + 1);
    });

    it('move a card with what hangs under it', async () => {
        const chart = (await tools().create_chart.execute!(
            {
                title: 'Signups',
                chart: 'bar',
                unit: 'signups',
                points: [
                    { label: 'a', value: 1 },
                    { label: 'b', value: 2 },
                ],
            },
            options,
        )) as { id: string };
        const layout = async () =>
            (
                (await tools().get_layout.execute!({}, options)) as {
                    cards: { id: string; x: number; y: number }[];
                }
            ).cards;
        const was = await layout();
        const offset = (cards: typeof was) =>
            cards.find((card) => card.id === chart.id)!.y -
            cards.find((card) => card.id === CHAT_ID)!.y;

        await tools().move_card.execute!(
            { cardId: CHAT_ID, x: 2000, y: 500 },
            options,
        );
        const now = await layout();
        expect(now.find((card) => card.id === CHAT_ID)).toMatchObject({
            x: 2000,
            y: 500,
        });
        expect(now.find((card) => card.id === chart.id)!.x).toBe(2000);
        expect(offset(now)).toBe(offset(was));
    });

    it('refuse cards on other surfaces', () => {
        expect(() =>
            tools().arrange_cards.execute!(
                { groups: [['doc-brief']], direction: 'rows' },
                options,
            ),
        ).toThrow(/Not on this surface/);
    });
});

describe('readableToolError', () => {
    it("pulls the thrown message out of Mastra's error", () => {
        const mastraError = JSON.stringify({
            name: 'Error',
            cause: {
                message:
                    '"pr-api-freeze" is on another surface; documents link to cards on their own surface.',
            },
            id: 'TOOL_EXECUTION_FAILED',
            domain: 'TOOL',
            category: 'USER',
            details: {
                errorMessage:
                    'Error: "pr-api-freeze" is on another surface; documents link to cards on their own surface.',
                model: 'claude-sonnet-5-5',
            },
        });
        expect(readableToolError(mastraError)).toBe(
            '"pr-api-freeze" is on another surface; documents link to cards on their own surface.',
        );
    });

    it('falls back to details, then the text as given', () => {
        expect(
            readableToolError(
                JSON.stringify({ details: { errorMessage: 'Error: Nope' } }),
            ),
        ).toBe('Nope');
        expect(readableToolError('No issue "X-1" on that board.')).toBe(
            'No issue "X-1" on that board.',
        );
        expect(readableToolError('42')).toBe('42');
    });
});
