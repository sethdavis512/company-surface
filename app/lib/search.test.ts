import { describe, expect, it } from 'vitest';
import { markdownToPortableText } from './portable-text';
import { createSurfaceSearch } from './search';
import type { BoardItem, SurfaceItem } from './surface';

const items: SurfaceItem[] = [
    {
        kind: 'chat',
        surfaceId: 's',
        id: 'chat-launch',
        title: 'Launch crew',
        participantIds: ['maya'],
        createdById: 'maya',
        messages: [
            {
                id: 'm1',
                authorId: 'maya',
                text: 'Can everyone skim the timeline before standup?',
                sentAt: '2026-10-23T09:00:00Z',
            },
            {
                id: 'm2',
                authorId: 'dev',
                text: 'The API freeze works for us.',
                sentAt: '2026-10-23T09:05:00Z',
            },
        ],
    },
    {
        kind: 'document',
        surfaceId: 's',
        id: 'doc-sso',
        title: 'Northwind SSO questions',
        authorId: 'agent',
        createdById: 'agent',
        updatedAt: '2026-10-23T00:00:00Z',
        blocks: markdownToPortableText(
            'SSO is a fast follow, not day one. It ships behind a flag.',
        ),
    },
    {
        kind: 'board',
        surfaceId: 's',
        id: 'board-atlas',
        title: 'Atlas launch',
        key: 'ATL',
        createdById: 'maya',
        updatedAt: '2026-10-23T00:00:00Z',
        issues: [
            {
                id: 'i1',
                identifier: 'ATL-3',
                title: 'Rate limit the public API',
                status: 'todo',
                priority: 'high',
                links: [],
                createdById: 'maya',
                updatedAt: '2026-10-23T00:00:00Z',
            },
        ],
    },
];

const search = createSurfaceSearch(items, {
    nameOf: (id) => (id === 'maya' ? 'Maya Chen' : undefined),
});

describe('createSurfaceSearch', () => {
    it('finds items by title first, by word prefix', () => {
        const { hits } = search.search('launc');
        expect(hits.map((hit) => hit.itemId)).toEqual([
            'chat-launch',
            'board-atlas',
        ]);
        expect(hits[0]).not.toHaveProperty('subId');
    });

    it('points inside chats and boards, with who said it or which issue', () => {
        const message = search.search('timeline').hits[0]!;
        expect(message).toMatchObject({
            itemId: 'chat-launch',
            subId: 'm1',
            subLabel: 'Maya Chen',
        });
        const issue = search.search('rate limit').hits[0]!;
        expect(issue).toMatchObject({
            itemId: 'board-atlas',
            subId: 'i1',
            subLabel: 'ATL-3',
        });
    });

    it('ranks an exact identifier above longer ones it begins', () => {
        const board = items[2] as BoardItem;
        const issue = board.issues[0]!;
        const ten: BoardItem = {
            ...board,
            id: 'board-two',
            issues: [
                { ...issue, id: 'i10', identifier: 'ATL-10' },
                { ...issue, id: 'i1', identifier: 'ATL-1' },
            ],
        };
        const hit = createSurfaceSearch([ten]).search('ATL-1').hits[0]!;
        expect(hit.subLabel).toBe('ATL-1');
    });

    it('needs every word, reads document text, and shrugs off a small typo', () => {
        expect(search.search('flag fast').hits[0]?.itemId).toBe('doc-sso');
        expect(search.search('flag timeline').hits).toEqual([]);
        expect(search.search('folow').hits[0]?.itemId).toBe('doc-sso');
    });

    it('marks the matched words in a snippet around them', () => {
        const hit = search.search('flag').hits[0]!;
        const [[start, end]] = hit.ranges as [[number, number]];
        expect(hit.snippet.slice(start, end)).toBe('flag');
    });

    it('lists every matching item, and nothing for an empty query', () => {
        expect(search.search('api').itemIds).toEqual(
            new Set(['chat-launch', 'board-atlas']),
        );
        expect(search.search('  ').hits).toEqual([]);
    });
});
