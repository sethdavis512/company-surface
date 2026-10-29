import { defineCatalog, validateSpec, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import {
    ISSUE_STATUSES,
    type IssueStatus,
    type Person,
    type SurfaceItem,
} from './surface';

/**
 * UI cards: small interfaces an agent composes from a fixed catalog of
 * components (json-render, https://json-render.dev), drawn with the app's
 * own components. A card stores only its spec (which components, how they
 * nest, where their values come from). The numbers come from the surface:
 * specs read live surface data through `$state` paths (`uiData`), so an
 * agent picks what to show and never writes the figures itself. Buttons
 * run the catalog's actions, which are the surface's own changes (move an
 * issue, merge a pull request), made as whoever clicks.
 *
 * Client-safe: the card draws with it, and the store and agents validate
 * and describe specs with it.
 */

/** A value or a json-render expression (`{ "$state": "/path" }`, ...). */
const dynamic = <T extends z.ZodType>(type: T) =>
    z.union([type, z.record(z.string(), z.unknown())]);

const tone = z
    .enum(['default', 'info', 'success', 'warning', 'danger'])
    .nullable();

export const uiCatalog = defineCatalog(schema, {
    components: {
        Stack: {
            props: z.object({
                direction: z.enum(['vertical', 'horizontal']).nullable(),
                gap: z.enum(['sm', 'md', 'lg']).nullable(),
            }),
            slots: ['default'],
            description:
                'Children in a column (default) or a wrapping row. The usual root.',
        },
        Grid: {
            props: z.object({ columns: z.number().int().min(2).max(4) }),
            slots: ['default'],
            description:
                'Children in 2 to 4 equal columns (metrics side by side)',
        },
        Heading: {
            props: z.object({
                text: dynamic(z.string()),
                level: z.union([z.literal(2), z.literal(3)]).nullable(),
            }),
            slots: [],
            description: 'A section heading',
        },
        Text: {
            props: z.object({
                text: dynamic(z.string()),
                muted: z.boolean().nullable(),
            }),
            slots: [],
            description: 'A paragraph',
        },
        Metric: {
            props: z.object({
                label: z.string(),
                value: dynamic(z.union([z.string(), z.number()])),
                hint: dynamic(z.string()).nullable(),
            }),
            slots: [],
            description:
                'A big number with a label. Bind `value` to a /stats or /boardById path',
        },
        Badge: {
            props: z.object({ label: dynamic(z.string()), tone }),
            slots: [],
            description: 'A small status label',
        },
        Callout: {
            props: z.object({
                title: dynamic(z.string()),
                text: dynamic(z.string()).nullable(),
                tone,
            }),
            slots: [],
            description: 'A highlighted note or warning',
        },
        Progress: {
            props: z.object({
                label: dynamic(z.string()).nullable(),
                value: dynamic(z.number()),
                max: dynamic(z.number()),
            }),
            slots: [],
            description: 'A bar filled value/max (issues done of all, say)',
        },
        BarList: {
            props: z.object({
                items: dynamic(
                    z.array(z.object({ label: z.string(), value: z.number() })),
                ),
                unit: z.string().nullable(),
            }),
            slots: [],
            description:
                'Horizontal bars, one per {label, value} item. Bind `items` to /boardById/<id>/byStatus or /chartById/<id>/points',
        },
        Table: {
            props: z.object({
                columns: z.array(
                    z.object({ key: z.string(), label: z.string() }),
                ),
                rows: dynamic(z.array(z.record(z.string(), z.unknown()))),
                empty: z.string().nullable(),
            }),
            slots: [],
            description:
                'Rows of records, one column per key. Bind `rows` to an array (/boardById/<id>/issues, /pullRequests)',
        },
        ListItem: {
            props: z.object({
                title: dynamic(z.string()),
                subtitle: dynamic(z.string()).nullable(),
                badge: dynamic(z.string()).nullable(),
                cardId: dynamic(z.string()).nullable(),
            }),
            slots: ['default'],
            description:
                'One row of a list: title, subtitle, a badge, and its own buttons as children. Use inside a `repeat` with $item values. With cardId, the title opens that card',
        },
        Button: {
            props: z.object({
                label: dynamic(z.string()),
                variant: z
                    .enum(['default', 'outline', 'ghost', 'destructive'])
                    .nullable(),
            }),
            slots: [],
            description:
                'A button. Bind its `press` event to an action with `on`',
        },
        Input: {
            props: z.object({
                label: z.string().nullable(),
                value: dynamic(z.string()).nullable(),
                placeholder: z.string().nullable(),
            }),
            slots: [],
            description:
                'A one-line text field. Bind `value` two ways with { "$bindState": "/ui/<field>" }',
        },
        Select: {
            props: z.object({
                label: z.string().nullable(),
                value: dynamic(z.string()).nullable(),
                options: z.array(
                    z.object({ value: z.string(), label: z.string() }),
                ),
            }),
            slots: [],
            description:
                'A dropdown. Bind `value` two ways with { "$bindState": "/ui/<field>" }',
        },
        Separator: {
            props: z.object({}),
            slots: [],
            description: 'A thin divider',
        },
        CardLink: {
            props: z.object({
                cardId: dynamic(z.string()),
                label: dynamic(z.string()).nullable(),
            }),
            slots: [],
            description:
                'A chip that opens another card on this surface (its title unless label is set)',
        },
    },
    actions: {
        openCard: {
            params: z.object({ cardId: z.string() }),
            description: 'Open (focus) a card on this surface',
        },
        moveIssue: {
            params: z.object({
                boardId: z.string(),
                issueId: z.string(),
                status: z.enum(ISSUE_STATUSES),
            }),
            description: `Move an issue to a status: ${ISSUE_STATUSES.join(', ')}`,
        },
        createIssue: {
            params: z.object({
                boardId: z.string(),
                title: z.string(),
                status: z.enum(ISSUE_STATUSES).nullable(),
            }),
            description:
                'File a new issue on a board (backlog unless status is set)',
        },
        setPullRequestStatus: {
            params: z.object({
                pullRequestId: z.string(),
                status: z.enum(['draft', 'open', 'merged', 'closed']),
            }),
            description:
                'Move a pull request along: draft, open, merged, closed',
        },
        postMessage: {
            params: z.object({ chatId: z.string(), text: z.string() }),
            description: 'Post a message in a chat, as whoever clicked',
        },
        addNote: {
            params: z.object({ text: z.string() }),
            description: 'Pin a sticky note on the surface',
        },
    },
});

export type UiActionName = keyof typeof uiCatalog.data.actions;

const STATUS_LABELS: Record<IssueStatus, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
};

/**
 * What a UI card's spec can read, at these `$state` paths. Shared by every
 * viewer and rebuilt from the surface on each change, so bound values stay
 * live. A spec keeps its own state (inputs, tabs) under `/ui`.
 */
export function uiData(
    items: SurfaceItem[],
    people: Person[],
    meId: string,
): Record<string, unknown> {
    const nameOf = (id: string | undefined) =>
        (id && people.find((person) => person.id === id)?.name) || '';
    const boards = items.flatMap((item) =>
        item.kind === 'board'
            ? [
                  {
                      id: item.id,
                      title: item.title,
                      key: item.key,
                      open: item.issues.filter((i) => i.status !== 'done')
                          .length,
                      done: item.issues.filter((i) => i.status === 'done')
                          .length,
                      total: item.issues.length,
                      byStatus: ISSUE_STATUSES.map((status) => ({
                          status,
                          label: STATUS_LABELS[status],
                          value: item.issues.filter(
                              (issue) => issue.status === status,
                          ).length,
                      })),
                      issues: item.issues.map((issue) => ({
                          id: issue.id,
                          boardId: item.id,
                          identifier: issue.identifier,
                          title: issue.title,
                          status: issue.status,
                          statusLabel: STATUS_LABELS[issue.status],
                          priority: issue.priority,
                          assignee: nameOf(issue.assigneeId) || 'Unassigned',
                          assigneeId: issue.assigneeId ?? '',
                      })),
                  },
              ]
            : [],
    );
    const pullRequests = items.flatMap((item) =>
        item.kind === 'pull-request'
            ? [
                  {
                      id: item.id,
                      number: item.number,
                      title: item.title,
                      status: item.status,
                      branch: item.branch,
                      chatId: item.chatId ?? '',
                      author: nameOf(item.authorId),
                  },
              ]
            : [],
    );
    const issues = boards.flatMap((board) => board.issues);
    return {
        me: { id: meId, name: nameOf(meId) },
        people: people.map(({ id, name, initials }) => ({
            id,
            name,
            initials,
        })),
        cards: items.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            createdBy: nameOf(item.createdById),
        })),
        boards,
        boardById: Object.fromEntries(boards.map((board) => [board.id, board])),
        pullRequests,
        chats: items.flatMap((item) =>
            item.kind === 'chat'
                ? [
                      {
                          id: item.id,
                          title: item.title,
                          messages: item.messages.length,
                          last: item.messages.at(-1)?.text ?? '',
                      },
                  ]
                : [],
        ),
        documents: items.flatMap((item) =>
            item.kind === 'document'
                ? [{ id: item.id, title: item.title }]
                : [],
        ),
        charts: items.flatMap((item) =>
            item.kind === 'chart'
                ? [
                      {
                          id: item.id,
                          title: item.title,
                          unit: item.unit,
                          points: item.points,
                      },
                  ]
                : [],
        ),
        chartById: Object.fromEntries(
            items.flatMap((item) =>
                item.kind === 'chart'
                    ? [
                          [
                              item.id,
                              {
                                  id: item.id,
                                  title: item.title,
                                  unit: item.unit,
                                  points: item.points,
                              },
                          ],
                      ]
                    : [],
            ),
        ),
        notes: items.flatMap((item) =>
            item.kind === 'note'
                ? [{ id: item.id, title: item.title, text: item.text }]
                : [],
        ),
        stats: {
            cards: items.length,
            openIssues: issues.filter((issue) => issue.status !== 'done')
                .length,
            doneIssues: issues.filter((issue) => issue.status === 'done')
                .length,
            issues: issues.length,
            openPullRequests: pullRequests.filter(
                (pr) => pr.status === 'open' || pr.status === 'draft',
            ).length,
            mergedPullRequests: pullRequests.filter(
                (pr) => pr.status === 'merged',
            ).length,
        },
    };
}

/** How agents hand a spec over (each element is checked by `uiSpecProblems`). */
export const uiSpecInputSchema = z.object({
    root: z.string().min(1),
    elements: z.record(z.string(), z.unknown()),
    state: z.record(z.string(), z.unknown()).optional(),
});

/** A spec as stored on a card. */
export type UiSpec = Spec;

/**
 * Whether a spec can be drawn: its structure holds together and it only
 * uses the catalog's components and actions. Props aren't checked strictly
 * here (they may be expressions resolved at render time); the components
 * draw whatever they get safely. Returns the problems, or none.
 */
export function uiSpecProblems(spec: unknown): string[] {
    const shape = z
        .object({
            root: z.string().min(1),
            elements: z.record(
                z.string(),
                z
                    .object({
                        type: z.string(),
                        props: z.record(z.string(), z.unknown()).default({}),
                        children: z.array(z.string()).optional(),
                    })
                    .passthrough(),
            ),
            state: z.record(z.string(), z.unknown()).optional(),
        })
        .safeParse(spec);
    if (!shape.success) {
        return shape.error.issues.map(
            (issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`,
        );
    }
    const problems = validateSpec(shape.data as Spec)
        .issues.filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message);
    const components = new Set(uiCatalog.componentNames);
    const actions = new Set([
        ...uiCatalog.actionNames,
        'setState',
        'pushState',
        'removeState',
        'validateForm',
    ]);
    for (const [key, element] of Object.entries(shape.data.elements)) {
        if (!components.has(element.type)) {
            problems.push(
                `${key}: no component "${element.type}" (use ${[...components].join(', ')})`,
            );
        }
        const on = (element as { on?: Record<string, unknown> }).on ?? {};
        for (const binding of Object.values(on).flat()) {
            const action = (binding as { action?: unknown })?.action;
            if (typeof action === 'string' && !actions.has(action)) {
                problems.push(`${key}: no action "${action}"`);
            }
        }
    }
    if (Object.keys(shape.data.elements).length > 200) {
        problems.push('Too many elements (200 at most).');
    }
    return problems;
}

/** A prop's shape in a word or two, for the guide. */
function describeProp(type: z.ZodType): string {
    const optional = type.safeParse(null).success;
    const def = (type as { def?: { type?: string; values?: unknown[] } }).def;
    let shape = def?.type ?? 'value';
    if (shape === 'nullable') {
        const inner = (type as unknown as { unwrap(): z.ZodType }).unwrap();
        return `${describeProp(inner)}?`;
    }
    if (shape === 'enum') {
        shape = Object.values(
            (type as unknown as { enum: Record<string, string> }).enum,
        ).join('|');
    }
    if (shape === 'union') {
        const options = (type as unknown as { options: z.ZodType[] }).options;
        const literals = options.flatMap((option) => {
            const inner = (
                option as { def?: { type?: string; values?: unknown[] } }
            ).def;
            return inner?.type === 'literal' ? (inner.values ?? []) : [];
        });
        const isRecord = (option: z.ZodType) =>
            (option as { def?: { type?: string } }).def?.type === 'record';
        shape =
            literals.length === options.length
                ? literals.join('|')
                : options.some(isRecord)
                  ? `${options
                        .filter((option) => !isRecord(option))
                        .map(describeProp)
                        .join('|')} or binding`
                  : options.map(describeProp).join('|');
    }
    return optional ? `${shape}?` : shape;
}

/**
 * What agents read before they write a spec: each component and action
 * with its props, the data they can bind, and the rules. Short, and about
 * one JSON spec (not json-render's streaming format).
 */
export function uiGuide(): string {
    const components = Object.entries(uiCatalog.data.components).map(
        ([name, { props, description, slots }]) => {
            const shape = (props as z.ZodObject).shape;
            const fields = Object.entries(shape)
                .map(
                    ([key, type]) =>
                        `${key}: ${describeProp(type as z.ZodType)}`,
                )
                .join(', ');
            const nests = (slots as readonly string[]).includes('default')
                ? ' Takes children.'
                : '';
            return `- ${name} { ${fields} }: ${description.replace(/\.$/, '')}.${nests}`;
        },
    );
    const actions = Object.entries(uiCatalog.data.actions).map(
        ([name, { params, description }]) =>
            `- ${name}(${Object.keys((params as z.ZodObject).shape).join(', ')}): ${description}`,
    );
    return [
        'A UI card is one JSON spec: { "root": "<key>", "elements": { "<key>": { "type": "<Component>", "props": { ... }, "children": ["<key>", ...] } }, "state": { "ui": { ... } } }. Element keys are short ids you choose; every child key must exist in elements. Give every prop listed (use null for ones ending in ?).',
        '',
        'COMPONENTS:',
        ...components,
        '',
        'ACTIONS (on an element: "on": { "press": { "action": "<name>", "params": { ... } } }; several run in order when you pass an array):',
        ...actions,
        "- setState(statePath, value): set the card's own state, e.g. a selected tab under /ui",
        '',
        'DATA (read-only and live; bind it, never type its numbers or titles into props):',
        '- /stats: { cards, issues, openIssues, doneIssues, openPullRequests, mergedPullRequests }',
        '- /boards: [{ id, title, key, open, done, total, byStatus: [{ status, label, value }], issues: [{ id, boardId, identifier, title, status, statusLabel, priority, assignee, assigneeId }] }], also by id at /boardById/<boardId>',
        '- /pullRequests: [{ id, number, title, status, branch, chatId, author }]',
        '- /chats: [{ id, title, messages, last }]  /documents: [{ id, title }]  /notes: [{ id, title, text }]',
        '- /charts: [{ id, title, unit, points: [{ label, value }] }], also at /chartById/<chartId>',
        '- /cards: [{ id, kind, title, createdBy }]  /people: [{ id, name, initials }]  /me: { id, name }',
        '',
        'BINDING:',
        '- Read a value: { "$state": "/stats/openIssues" }. Prefer /boardById/<id>/... over array positions.',
        '- Edit the card\'s own state two ways: { "$bindState": "/ui/draft" }, with its start in spec.state.ui. Keep all your own state under /ui.',
        '- Lists: give an element "repeat": { "statePath": "/boardById/<id>/issues", "key": "id" } and its children read each item with { "$item": "title" }. Filter with "visible": { "$item": "status", "neq": "done" }.',
        '- Show or hide: "visible": { "$state": "/stats/openIssues", "gt": 0 } (also eq, neq, gte, lt, lte, not).',
        '- Pass values to actions the same way: { "action": "moveIssue", "params": { "boardId": { "$item": "boardId" }, "issueId": { "$item": "id" }, "status": "done" } }, or { "text": { "$state": "/ui/draft" } }.',
    ].join('\n');
}
