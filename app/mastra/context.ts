import { RequestContext } from '@mastra/core/request-context';

const USER_ID_KEY = 'userId';
const THREAD_ID_KEY = 'threadId';
const MODEL_KEY = 'model';

/**
 * The request context every agent run carries. Mastra hands it to the
 * agent's dynamic `model` callback, to input processors, and to every tool
 * call made during the run, so tools act for the signed-in user without any
 * user id in the model-visible prompt.
 */
export function userRequestContext({
    userId,
    threadId,
    model,
}: {
    userId: string;
    threadId?: string;
    /** The thread's model id, validated against the allowlist by the agent. */
    model?: string;
}): RequestContext {
    const requestContext = new RequestContext();
    requestContext.set(USER_ID_KEY, userId);
    if (threadId) requestContext.set(THREAD_ID_KEY, threadId);
    if (model) requestContext.set(MODEL_KEY, model);
    return requestContext;
}

type WithRequestContext = { requestContext?: RequestContext };

function readString(
    context: WithRequestContext | undefined,
    key: string,
): string | undefined {
    const value = context?.requestContext?.get(key);
    return typeof value === 'string' ? value : undefined;
}

/** The signed-in user a tool or processor is acting for. */
export function contextUserId(
    context?: WithRequestContext,
): string | undefined {
    return readString(context, USER_ID_KEY);
}

/** The chat thread the run belongs to. */
export function contextThreadId(
    context?: WithRequestContext,
): string | undefined {
    return readString(context, THREAD_ID_KEY);
}

/** The model id the caller asked for, before allowlist validation. */
export function contextModel(context?: WithRequestContext): string | undefined {
    return readString(context, MODEL_KEY);
}

const CHAT_KEY = 'surfaceChat';

/** Where the surface agent is answering: the chat card and its surface. */
export type ChatContext = {
    chatId: string;
    title: string;
    surfaceId: string;
    surfaceName: string;
    spaceName: string;
};

/** The request context for one of the surface agent's replies. */
export function chatRequestContext(chat: ChatContext): RequestContext {
    const requestContext = new RequestContext();
    requestContext.set(CHAT_KEY, chat);
    return requestContext;
}

/** The chat the surface agent is answering in, if any. */
export function contextChat(
    context?: WithRequestContext,
): ChatContext | undefined {
    const value = context?.requestContext?.get(CHAT_KEY);
    return value && typeof value === 'object'
        ? (value as ChatContext)
        : undefined;
}
