import { describe, expect, it } from 'vitest';
import type { BoardItem, Person, SurfaceItem } from './surface';
import { uiData, uiGuide, uiSpecProblems } from './ui-card';

const people: Person[] = [
    { id: 'ann', name: 'Ann', initials: 'A', role: 'Member' },
];

const board: BoardItem = {
    kind: 'board',
    id: 'board-1',
    surfaceId: 's',
    title: 'Launch',
    key: 'LCH',
    createdById: 'ann',
    updatedAt: '2026-10-29T00:00:00Z',
    issues: [
        {
            id: 'i1',
            identifier: 'LCH-1',
            title: 'Write copy',
            status: 'todo',
            priority: 'high',
            assigneeId: 'ann',
            links: [],
            createdById: 'ann',
            updatedAt: '2026-10-29T00:00:00Z',
        },
        {
            id: 'i2',
            identifier: 'LCH-2',
            title: 'Ship',
            status: 'done',
            priority: 'none',
            links: [],
            createdById: 'ann',
            updatedAt: '2026-10-29T00:00:00Z',
        },
    ],
} as BoardItem;

describe('uiData', () => {
    it('lays the surface out for $state paths, by position and by id', () => {
        const data = uiData([board as SurfaceItem], people, 'ann') as {
            stats: Record<string, number>;
            boards: {
                issues: Record<string, unknown>[];
                byStatus: unknown[];
            }[];
            boardById: Record<string, { open: number }>;
            me: { name: string };
        };
        expect(data.me.name).toBe('Ann');
        expect(data.stats).toMatchObject({
            cards: 1,
            issues: 2,
            openIssues: 1,
            doneIssues: 1,
        });
        expect(data.boardById['board-1']!.open).toBe(1);
        expect(data.boards[0]!.issues[0]).toMatchObject({
            boardId: 'board-1',
            identifier: 'LCH-1',
            statusLabel: 'Todo',
            assignee: 'Ann',
        });
        expect(data.boards[0]!.issues[1]).toMatchObject({
            assignee: 'Unassigned',
        });
        expect(data.boards[0]!.byStatus).toContainEqual({
            status: 'done',
            label: 'Done',
            value: 1,
        });
    });
});

describe('uiSpecProblems', () => {
    const metric = {
        type: 'Metric',
        props: {
            label: 'Open',
            value: { $state: '/stats/openIssues' },
            hint: null,
        },
    };

    it('accepts a spec over the catalog, expressions and all', () => {
        expect(uiSpecProblems({ root: 'm', elements: { m: metric } })).toEqual(
            [],
        );
    });

    it('names what is wrong: missing children, unknown parts and actions', () => {
        expect(uiSpecProblems({ elements: {} })).not.toEqual([]);
        const problems = uiSpecProblems({
            root: 'a',
            elements: {
                a: { type: 'Stack', props: {}, children: ['gone'] },
                b: { type: 'Marquee', props: {} },
                c: {
                    type: 'Button',
                    props: { label: 'Go', variant: null },
                    on: { press: { action: 'deleteEverything' } },
                },
            },
        });
        expect(problems.join('\n')).toMatch(/gone/);
        expect(problems.join('\n')).toMatch(/no component "Marquee"/);
        expect(problems.join('\n')).toMatch(/no action "deleteEverything"/);
    });
});

describe('uiGuide', () => {
    it('lists every component, every action, and the data paths, briefly', () => {
        const guide = uiGuide();
        for (const name of [
            'Metric',
            'Table',
            'ListItem',
            'moveIssue',
            '/stats',
            '/boardById',
        ]) {
            expect(guide).toContain(name);
        }
        expect(guide.length).toBeLessThan(8000);
    });
});
