import { log } from '~/lib/logger.server';
import {
    AGENT_ID,
    SurfaceError,
    editMessage,
    getItem,
    getWorkspace,
    listPeople,
    postMessage,
    setAwaitingReply,
    storeEpoch,
} from '~/models/surface.server';

import { WORKSPACE_RESOURCE_ID, getChat } from './agents';
import { asUserTurn, createReplyText, unseenMessages } from './chat-turns';
import { chatRequestContext, type ChatContext } from './context';
import { ResourceUnavailableError } from './lazy-resource';
import { openSurfaceTools } from './surface-tools';

/** A reply that runs longer than this is cut off. */
const REPLY_TIMEOUT_MS = 120_000;

/**
 * What the agent keeps between replies, outside the store: per thread, the
 * last chat message it was given, and the ids of its own replies (already in
 * its thread as assistant messages); which chats it's answering in, and which
 * got new messages meanwhile. On globalThis, like the store, so dev reloads
 * keep it. A thread is `<store epoch>:<chat id>`, so a reseeded store starts
 * fresh threads instead of reading a past store's history.
 */
type AgentState = {
    cursors: Map<string, string>;
    own: Set<string>;
    running: Set<string>;
    again: Set<string>;
};

const STATE_KEY = Symbol.for('company-surface.agent-state');
type WithState = typeof globalThis & { [STATE_KEY]?: AgentState };

function state(): AgentState {
    const scope = globalThis as WithState;
    scope[STATE_KEY] ??= {
        cursors: new Map(),
        own: new Set(),
        running: new Set(),
        again: new Set(),
    };
    return scope[STATE_KEY];
}

function locate(chat: {
    id: string;
    title: string;
    surfaceId: string;
}): ChatContext {
    for (const space of getWorkspace().spaces) {
        for (const surface of space.surfaces) {
            if (surface.id === chat.surfaceId) {
                return {
                    chatId: chat.id,
                    title: chat.title,
                    surfaceId: surface.id,
                    surfaceName: surface.name,
                    spaceName: space.name,
                };
            }
        }
    }
    throw new SurfaceError(`Chat "${chat.id}" is on no surface.`);
}

function say(chatId: string, text: string): string {
    const { id } = postMessage({ chatId, authorId: AGENT_ID, text });
    state().own.add(id);
    return id;
}

/** One reply: everything new in the chat in, the agent's answer out. */
async function answerOnce(chatId: string) {
    const chat = getItem(chatId);
    if (chat.kind !== 'chat') return;

    const threadId = `${storeEpoch()}:${chatId}`;
    const { cursors, own } = state();
    const unseen = unseenMessages(chat.messages, cursors.get(threadId), own);
    if (unseen.length === 0) return;

    const people = new Map(listPeople().map((person) => [person.id, person]));
    const input = unseen.map((message) =>
        asUserTurn(message, people.get(message.authorId)),
    );

    const { agent } = await getChat();
    const surface = await openSurfaceTools();
    try {
        const stream = await agent.stream(input, {
            memory: { thread: threadId, resource: WORKSPACE_RESOURCE_ID },
            requestContext: chatRequestContext(locate(chat)),
            toolsets: { surface: surface.tools },
            abortSignal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
        });
        // Given to the agent: from here on these count as seen, whatever
        // happens to the reply.
        cursors.set(threadId, unseen.at(-1)!.id);

        const reply = createReplyText();
        let messageId: string | null = null;
        for await (const chunk of stream.fullStream) {
            if (chunk.type === 'tool-call') reply.breakStep();
            if (chunk.type !== 'text-delta') continue;
            const text = reply.add(chunk.payload.text).trim();
            if (!text) continue;
            // The reply appears as it's written: open canvases poll.
            if (messageId) editMessage({ chatId, messageId, text });
            else messageId = say(chatId, text);
        }
        if (!messageId) say(chatId, 'Done.');
    } finally {
        await surface.close();
    }
}

/**
 * Answers in a chat as Surface Agent. Called (without awaiting) when someone
 * posts where the agent is a participant; "typing" shows until it's done.
 * Messages that arrive while it works get answered in one more pass.
 */
export async function answerInChat(chatId: string): Promise<void> {
    const { running, again } = state();
    if (running.has(chatId)) {
        again.add(chatId);
        return;
    }
    running.add(chatId);
    try {
        do {
            again.delete(chatId);
            await answerOnce(chatId);
        } while (again.has(chatId));
    } catch (error) {
        if (error instanceof SurfaceError) return; // The chat is gone.
        log.exception('surface_agent_reply_failed', error, { chatId });
        try {
            say(
                chatId,
                error instanceof ResourceUnavailableError
                    ? "I can't reach my memory right now, so I can't answer. Try again in a minute."
                    : 'Something went wrong while I was answering. Try again?',
            );
        } catch {
            // The chat went away meanwhile.
        }
    } finally {
        running.delete(chatId);
        again.delete(chatId);
        try {
            setAwaitingReply(chatId, false);
        } catch {
            // The chat went away meanwhile.
        }
    }
}
