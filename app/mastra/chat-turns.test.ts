import { describe, expect, it } from 'vitest';
import { AGENT_ID, type ChatMessage } from '~/lib/surface';
import {
    FIRST_TURN_LIMIT,
    asUserTurn,
    createReplyText,
    unseenMessages,
} from './chat-turns';

function message(id: string, authorId = 'me'): ChatMessage {
    return { id, authorId, text: id, sentAt: '2026-10-28T12:00:00Z' };
}

describe('unseenMessages', () => {
    const messages = ['a', 'b', 'c', 'd'].map((id) => message(id));

    it('gives everything after the cursor', () => {
        expect(
            unseenMessages(messages, 'b', new Set()).map(({ id }) => id),
        ).toEqual(['c', 'd']);
    });

    it('leaves out the agent’s own replies', () => {
        expect(
            unseenMessages(messages, 'a', new Set(['c'])).map(({ id }) => id),
        ).toEqual(['b', 'd']);
    });

    it('gives nothing when the cursor is the last message', () => {
        expect(unseenMessages(messages, 'd', new Set())).toEqual([]);
    });

    it('starts from the latest messages without a cursor, or a lost one', () => {
        const many = Array.from({ length: FIRST_TURN_LIMIT + 5 }, (_, i) =>
            message(`m${i}`),
        );
        for (const cursor of [undefined, 'gone']) {
            const unseen = unseenMessages(many, cursor, new Set());
            expect(unseen).toHaveLength(FIRST_TURN_LIMIT);
            expect(unseen.at(-1)!.id).toBe(`m${FIRST_TURN_LIMIT + 4}`);
        }
    });
});

describe('asUserTurn', () => {
    it('tags the message with who wrote it, escaped', () => {
        const turn = asUserTurn(
            { authorId: 'maya', text: 'Ship <it>' },
            { name: 'Maya "MC" Chen', role: 'Head of Product' },
        );
        expect(turn.role).toBe('user');
        expect(turn.content).toBe(
            '<turn author_id="maya" author_name="Maya &quot;MC&quot; Chen" functional_role="Head of Product">\nShip <it>\n</turn>',
        );
    });

    it('marks the agent’s name on messages it didn’t write', () => {
        const turn = asUserTurn(
            { authorId: AGENT_ID, text: 'Opened #12' },
            { name: 'Surface Agent', role: 'Agent' },
        );
        expect(turn.content).toContain(
            'author_name="Surface Agent (another session)"',
        );
    });
});

describe('createReplyText', () => {
    it('joins streamed text', () => {
        const reply = createReplyText();
        reply.add('Hel');
        expect(reply.add('lo.')).toBe('Hello.');
    });

    it('starts a new paragraph after a tool call', () => {
        const reply = createReplyText();
        reply.add('Let me check.');
        reply.breakStep();
        reply.add(' ');
        reply.add('Found');
        reply.add(' it.');
        expect(reply.text).toBe('Let me check.\n\nFound it.');
    });

    it('adds no break when the reply starts after a tool call', () => {
        const reply = createReplyText();
        reply.breakStep();
        reply.add('Found');
        reply.add(' it.');
        expect(reply.text).toBe('Found it.');
    });
});
