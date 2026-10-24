import type { ChatItem, ChatMessage } from '~/lib/surface';

/**
 * A stand-in chat service: replies come from the other participants, after a
 * short "typing" pause (the store schedules them). Swap for a real transport
 * when chat goes live.
 */

const CANNED_REPLIES = [
    'Makes sense. I will fold that into the brief.',
    'Good call. Want me to loop in the rest of the team?',
    'On it. I will report back before standup.',
    'Agreed. Let us keep the timeline as is for now.',
    'Can you drop a link to the source? I want to check one detail.',
];

export const MOCK_REPLY_DELAY_MS = 900;

type ReplyOptions = {
    meId: string;
    /** Participants who never send canned replies, unless no one else is left. */
    exclude?: string[];
    /** Returns a number in [0, 1); injectable so tests are deterministic. */
    random?: () => number;
    now?: () => Date;
};

export function pickMockReply(
    chat: Pick<ChatItem, 'participantIds'>,
    {
        meId,
        exclude = [],
        random = Math.random,
        now = () => new Date(),
    }: ReplyOptions,
): ChatMessage {
    const others = chat.participantIds.filter((id) => id !== meId);
    const preferred = others.filter((id) => !exclude.includes(id));
    const pool = preferred.length > 0 ? preferred : others;
    const authorId = pool[Math.floor(random() * pool.length)] ?? meId;
    const text = CANNED_REPLIES[Math.floor(random() * CANNED_REPLIES.length)]!;

    return {
        id: crypto.randomUUID(),
        authorId,
        text,
        sentAt: now().toISOString(),
    };
}
