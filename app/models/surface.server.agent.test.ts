import { afterEach, describe, expect, it, vi } from 'vitest';
import { mentionsAgent } from '~/lib/surface';

// The agent is live (a key, outside tests and E2E); its replies are faked.
const { answerInChat } = vi.hoisted(() => ({ answerInChat: vi.fn() }));
vi.mock('~/mastra/surface-agent', () => ({ answerInChat }));
vi.mock('~/lib/env.server', async (importOriginal) => {
    const original = await importOriginal<typeof import('~/lib/env.server')>();
    return {
        ...original,
        env: {
            ...original.env,
            ANTHROPIC_API_KEY: 'test-key',
            E2E_TEST_HOOKS: false,
            NODE_ENV: 'development',
        },
    };
});

const {
    AGENT_ID,
    ME_ID,
    agentIsLive,
    createChat,
    getItem,
    postMessage,
    resetSurface,
    SEED_SURFACE_ID,
} = await import('./surface.server');

function chat(id: string) {
    const item = getItem(id);
    if (item.kind !== 'chat') throw new Error('expected a chat');
    return item;
}

afterEach(() => {
    resetSurface();
    answerInChat.mockClear();
    vi.useRealTimers();
});

describe('postMessage with the agent live', () => {
    it('is live', () => {
        expect(agentIsLive()).toBe(true);
    });

    it('hands my message to the agent in a chat it’s part of', async () => {
        const { id } = createChat({ surfaceId: SEED_SURFACE_ID, title: 'x' });
        postMessage({ chatId: id, authorId: ME_ID, text: 'Hi' });
        expect(chat(id).awaitingReply).toBe(true);
        await vi.waitFor(() => expect(answerInChat).toHaveBeenCalledWith(id));
    });

    it('brings the agent into a chat when I write @agent', async () => {
        postMessage({
            chatId: 'chat-launch',
            authorId: ME_ID,
            text: '@agent summarize this',
        });
        expect(chat('chat-launch').participantIds).toContain(AGENT_ID);
        await vi.waitFor(() =>
            expect(answerInChat).toHaveBeenCalledWith('chat-launch'),
        );
    });

    it('leaves chats without the agent to the mock', () => {
        vi.useFakeTimers();
        postMessage({ chatId: 'chat-launch', authorId: ME_ID, text: 'Hi' });
        expect(chat('chat-launch').participantIds).not.toContain(AGENT_ID);
        expect(answerInChat).not.toHaveBeenCalled();
    });

    it('never answers the agent’s own messages', () => {
        const { id } = createChat({ surfaceId: SEED_SURFACE_ID, title: 'x' });
        postMessage({ chatId: id, authorId: AGENT_ID, text: '@agent' });
        expect(answerInChat).not.toHaveBeenCalled();
    });
});

describe('mentionsAgent', () => {
    it('matches @agent and @Surface Agent as words', () => {
        expect(mentionsAgent('@agent what do we know?')).toBe(true);
        expect(mentionsAgent('hey @Surface Agent, help')).toBe(true);
        expect(mentionsAgent('ask (@AGENT)')).toBe(true);
    });

    it('ignores emails, longer handles, and plain words', () => {
        expect(mentionsAgent('mail sales@agent.com')).toBe(false);
        expect(mentionsAgent('@agents unite')).toBe(false);
        expect(mentionsAgent('the agent said')).toBe(false);
    });
});
