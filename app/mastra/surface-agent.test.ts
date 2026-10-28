import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '~/lib/surface';
import {
    AGENT_ID,
    ME_ID,
    createChat,
    getItem,
    postMessage,
    resetSurface,
    SEED_SURFACE_ID,
} from '~/models/surface.server';
import { ResourceUnavailableError } from './lazy-resource';

type Chunk =
    | { type: 'text-delta'; payload: { text: string } }
    | { type: 'tool-call'; payload: object };

const { stream, getChat } = vi.hoisted(() => {
    const stream = vi.fn();
    return { stream, getChat: vi.fn(async () => ({ agent: { stream } })) };
});

// Only the model is faked: the store, the tools, and the reply plumbing are
// the real ones.
vi.mock('./agents', () => ({ getChat, WORKSPACE_RESOURCE_ID: 'workspace' }));

const { answerInChat } = await import('./surface-agent');

function streamOf(...chunks: Chunk[]) {
    return {
        fullStream: (async function* () {
            yield* chunks;
        })(),
    };
}

const text = (value: string): Chunk => ({
    type: 'text-delta',
    payload: { text: value },
});

function chat(id: string): ChatItem {
    const item = getItem(id);
    if (item.kind !== 'chat') throw new Error('expected a chat');
    return item;
}

/** A chat with the agent, my message posted (the mock replies off). */
function chatWithMessage(message: string) {
    const { id } = createChat({ surfaceId: SEED_SURFACE_ID, title: 'Ask' });
    postMessage({ chatId: id, authorId: AGENT_ID, text: message });
    return id;
}

beforeEach(() => {
    stream.mockReset();
    getChat.mockClear();
});
afterEach(() => resetSurface());

describe('answerInChat', () => {
    it('streams the reply into one agent message, then stops typing', async () => {
        const chatId = chatWithMessage('Who owns the launch?');
        stream.mockResolvedValueOnce(
            streamOf(
                text('Let me look.'),
                { type: 'tool-call', payload: {} },
                text('Maya'),
                text(' owns it.'),
            ),
        );

        await answerInChat(chatId);

        const answered = chat(chatId);
        expect(answered.messages.at(-1)).toMatchObject({
            authorId: AGENT_ID,
            text: 'Let me look.\n\nMaya owns it.',
        });
        expect(answered.messages).toHaveLength(2);
        expect(answered.awaitingReply).toBe(false);
    });

    it('gives the agent each message once, tagged, in the workspace memory', async () => {
        const chatId = chatWithMessage('First');
        stream.mockResolvedValue(streamOf(text('Ok.')));

        await answerInChat(chatId);
        postMessage({ chatId, authorId: 'maya', text: 'Second' });
        await answerInChat(chatId);

        const [firstInput, firstOptions] = stream.mock.calls[0]!;
        expect(firstInput).toHaveLength(1);
        expect(firstInput[0].content).toContain('First');
        expect(firstOptions.memory.resource).toBe('workspace');
        expect(firstOptions.memory.thread).toMatch(new RegExp(`:${chatId}$`));
        expect(firstOptions.toolsets.surface).toHaveProperty('create_document');

        const [secondInput, secondOptions] = stream.mock.calls[1]!;
        expect(secondInput).toHaveLength(1);
        expect(secondInput[0].content).toContain('author_name="Maya Chen"');
        expect(secondOptions.memory.thread).toBe(firstOptions.memory.thread);
    });

    it('says "Done." when the agent only used tools', async () => {
        const chatId = chatWithMessage('Make a note');
        stream.mockResolvedValueOnce(
            streamOf({ type: 'tool-call', payload: {} }),
        );

        await answerInChat(chatId);

        expect(chat(chatId).messages.at(-1)!.text).toBe('Done.');
    });

    it('says so when its memory is unreachable', async () => {
        const chatId = chatWithMessage('Hello?');
        getChat.mockRejectedValueOnce(
            new ResourceUnavailableError('mastra_memory', 1000),
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await answerInChat(chatId);

        const answered = chat(chatId);
        expect(answered.messages.at(-1)).toMatchObject({
            authorId: AGENT_ID,
            text: expect.stringContaining("can't reach my memory"),
        });
        expect(answered.awaitingReply).toBe(false);
    });

    it('answers messages that arrive mid-reply in one more pass', async () => {
        const chatId = chatWithMessage('One');
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        stream.mockImplementationOnce(async () => {
            await gate;
            return streamOf(text('First answer.'));
        });
        stream.mockResolvedValueOnce(streamOf(text('Second answer.')));

        const running = answerInChat(chatId);
        postMessage({ chatId, authorId: 'dev', text: 'Two' });
        await answerInChat(chatId); // Already running: queued, returns.
        release();
        await running;

        expect(stream).toHaveBeenCalledTimes(2);
        expect(stream.mock.calls[1]![0][0].content).toContain('Two');
        expect(chat(chatId).messages.map(({ text }) => text)).toEqual([
            'One',
            'Two',
            'First answer.',
            'Second answer.',
        ]);
    });

    it('stays quiet in a chat that was deleted', async () => {
        await expect(answerInChat('chat-nope')).resolves.toBeUndefined();
        expect(stream).not.toHaveBeenCalled();
    });

    it('never runs for my own posts in tests (the mock answers)', () => {
        const { id } = createChat({ surfaceId: SEED_SURFACE_ID, title: 'x' });
        vi.useFakeTimers();
        postMessage({ chatId: id, authorId: ME_ID, text: '@agent hi' });
        vi.useRealTimers();
        expect(getChat).not.toHaveBeenCalled();
    });
});
