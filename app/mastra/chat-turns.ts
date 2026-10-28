import { AGENT_ID, type ChatMessage, type Person } from '~/lib/surface';

/** At most this many messages go in on a chat's first turn. */
export const FIRST_TURN_LIMIT = 40;

/**
 * The chat messages the agent hasn't seen yet: everything after `cursor`
 * (the last message it was given), less its own replies, which its thread
 * already holds. With no cursor (a chat it hasn't answered in since the
 * store started), the latest `FIRST_TURN_LIMIT`. A cursor that's no longer
 * in the chat counts as none.
 */
export function unseenMessages(
    messages: ChatMessage[],
    cursor: string | undefined,
    ownIds: ReadonlySet<string>,
): ChatMessage[] {
    const at = cursor ? messages.findIndex(({ id }) => id === cursor) : -1;
    const after =
        at === -1 ? messages.slice(-FIRST_TURN_LIMIT) : messages.slice(at + 1);
    return after.filter(({ id }) => !ownIds.has(id));
}

function escapeAttribute(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * A chat message as one user turn, tagged with who wrote it (Mastra's
 * multi-user thread pattern): one thread holds everyone in the chat, so the
 * tag is how the model tells them apart, now and when history is recalled.
 * The agent's own name on a message it didn't write means another agent
 * session posted it (through MCP).
 */
export function asUserTurn(
    message: Pick<ChatMessage, 'authorId' | 'text'>,
    author: Pick<Person, 'name' | 'role'> | undefined,
) {
    const name =
        message.authorId === AGENT_ID
            ? 'Surface Agent (another session)'
            : (author?.name ?? message.authorId);
    return {
        role: 'user' as const,
        content: `<turn author_id="${escapeAttribute(message.authorId)}" author_name="${escapeAttribute(name)}" functional_role="${escapeAttribute(author?.role ?? '')}">\n${message.text}\n</turn>`,
    };
}

/**
 * Builds a reply from streamed text, a blank line between the text of
 * separate steps (before and after a tool call), so "Let me check." and
 * the answer don't run together.
 */
export function createReplyText() {
    let text = '';
    let stepBreak = false;
    return {
        /** Adds streamed text; returns the reply so far. */
        add(delta: string): string {
            if (!delta.trim()) {
                text += delta;
                return text;
            }
            if (stepBreak && text.trim()) text = `${text.trimEnd()}\n\n`;
            stepBreak = false;
            text += delta;
            return text;
        },
        /** A tool call happened: the next text starts a new paragraph. */
        breakStep() {
            stepBreak = true;
        },
        get text() {
            return text.trim();
        },
    };
}
