import { consumeStream, createAgentUIStreamResponse, generateId } from 'ai';
import { data } from 'react-router';
import { z } from 'zod';
import {
    chatHistory,
    createSurfaceAgent,
    replyText,
} from '~/agent/surface-agent.server';
import { requireUserFromContext } from '~/context';
import { env } from '~/lib/env.server';
import { log } from '~/lib/logger.server';
import { slideWindow } from '~/lib/rate-limit.server';
import { AGENT_ID, isAgentChat } from '~/lib/surface';
import { authMiddleware } from '~/middleware/auth';
import { markChanged } from '~/models/surface-events.server';
import {
    SurfaceError,
    getItem,
    isMember,
    postMessage,
    rememberPerson,
    setAwaitingReply,
} from '~/models/surface.server';
import type { Route } from './+types/api-agent-chat';

/**
 * One turn of a live agent chat: saves the signed-in person's message, then
 * streams the agent's reply (an AI SDK UI message stream, for `useChat`)
 * and saves it, tool calls and all, when it ends. Stop (or a closed tab)
 * cuts the turn short; what it had by then is still saved.
 */

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

const bodySchema = z.object({
    chatId: z.string().min(1),
    message: z.object({
        id: z.string().min(1).max(100),
        text: z.string().trim().min(1).max(4000),
    }),
});

/**
 * Turns per person per minute. Counted in memory, like the surface store
 * these chats live in (it needs no database).
 */
const TURNS_PER_MINUTE = 20;
const turnsByUser = new Map<string, number[]>();

function allowTurn(userId: string): boolean {
    const step = slideWindow({
        hits: turnsByUser.get(userId) ?? [],
        now: Date.now(),
        maxRequests: TURNS_PER_MINUTE,
        windowMs: 60_000,
    });
    turnsByUser.set(userId, step.hits);
    return step.success;
}

/** A whole turn, tools included, never runs longer than this. */
const TURN_TIMEOUT_MS = 180_000;

export async function action({ request, context }: Route.ActionArgs) {
    const user = requireUserFromContext(context);
    const me = rememberPerson(user);
    if (request.method !== 'POST') {
        throw data('Method not allowed', { status: 405 });
    }
    if (!env.ANTHROPIC_API_KEY) {
        throw data('Agent chat is off: set ANTHROPIC_API_KEY.', {
            status: 503,
        });
    }

    if (!allowTurn(user.id)) {
        throw data('Too many messages; wait a minute.', { status: 429 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw data('Bad request', { status: 400 });
    const { chatId, message } = parsed.data;

    let chat;
    try {
        chat = getItem(chatId);
    } catch (error) {
        if (error instanceof SurfaceError) {
            throw data(error.message, { status: 404 });
        }
        throw error;
    }
    if (chat.kind !== 'chat' || !isAgentChat(chat, isMember)) {
        throw data('Only chats with the agent alone get live replies.', {
            status: 400,
        });
    }

    try {
        postMessage({
            chatId,
            authorId: me.id,
            text: message.text,
            id: message.id,
            mockReply: false,
        });
    } catch (error) {
        // The same message twice (a retry): answer it again, don't repeat it.
        if (!(error instanceof SurfaceError)) throw error;
    }
    setAwaitingReply(chatId, true);
    // Everyone else on the surface sees the message and the agent typing.
    markChanged();

    const latest = getItem(chatId);
    if (latest.kind !== 'chat') throw data('Not a chat', { status: 400 });
    const history = chatHistory(latest);
    // The model's turns start with the user: drop the agent's greeting.
    while (history[0]?.role === 'assistant') history.shift();

    return createAgentUIStreamResponse({
        agent: createSurfaceAgent(latest),
        uiMessages: history,
        abortSignal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(TURN_TIMEOUT_MS),
        ]),
        generateMessageId: generateId,
        // Drain on the server, so onFinish runs even when the stream is cut.
        consumeSseStream: consumeStream,
        onError: (error) => {
            log.exception('agent_chat_failed', error, { chatId });
            return 'The agent ran into a problem. Try again.';
        },
        onFinish: ({ responseMessage }) => {
            try {
                setAwaitingReply(chatId, false);
                markChanged();
                const said = responseMessage.parts.some(
                    (part) => part.type !== 'step-start',
                );
                if (!said) return;
                postMessage({
                    chatId,
                    authorId: AGENT_ID,
                    text: replyText(responseMessage),
                    id: responseMessage.id,
                    parts: responseMessage.parts,
                });
            } catch (error) {
                // The chat was deleted mid-turn: nowhere to save the reply.
                if (!(error instanceof SurfaceError)) throw error;
            }
        },
    });
}
