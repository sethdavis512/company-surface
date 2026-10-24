import { describe, expect, it } from 'vitest';
import { pickMockReply } from './mock-chat';

const chat = { participantIds: ['me', 'maya', 'dev'] };

describe('pickMockReply', () => {
    it('replies as someone other than me', () => {
        for (const value of [0, 0.5, 0.99]) {
            const reply = pickMockReply(chat, {
                meId: 'me',
                random: () => value,
            });
            expect(reply.authorId).not.toBe('me');
            expect(reply.text.length).toBeGreaterThan(0);
        }
    });

    it('skips excluded participants while anyone else is left', () => {
        const reply = pickMockReply(
            { participantIds: ['me', 'agent', 'maya'] },
            { meId: 'me', exclude: ['agent'], random: () => 0 },
        );
        expect(reply.authorId).toBe('maya');
    });

    it('falls back to an excluded participant when no one else is in the chat', () => {
        const reply = pickMockReply(
            { participantIds: ['me', 'agent'] },
            { meId: 'me', exclude: ['agent'] },
        );
        expect(reply.authorId).toBe('agent');
    });

    it('stamps the reply with the current time', () => {
        const now = new Date('2026-10-23T12:00:00Z');
        const reply = pickMockReply(chat, { meId: 'me', now: () => now });
        expect(reply.sentAt).toBe(now.toISOString());
    });
});
