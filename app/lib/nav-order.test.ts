import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, completeNavOrder } from './nav-order';

describe('completeNavOrder', () => {
    it('keeps a saved order and appends sections it never mentioned', () => {
        expect(completeNavOrder(['board', 'chat'])).toEqual([
            'board',
            'chat',
            'recent',
            'views',
            'document',
            'pull-request',
            'chart',
            'video',
            'web',
            'image',
            'note',
            'sketch',
        ]);
    });

    it('drops unknown and repeated keys', () => {
        expect(completeNavOrder(['chat', 'nope', 'chat'])[0]).toBe('chat');
        expect(completeNavOrder(['chat', 'nope', 'chat'])).toHaveLength(
            NAV_SECTIONS.length,
        );
    });

    it('falls back to the default order', () => {
        expect(completeNavOrder([])).toEqual([...NAV_SECTIONS]);
    });
});
