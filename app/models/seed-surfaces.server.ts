import { markdownToPortableText } from '~/lib/portable-text';
import {
    AGENT_ID,
    noteTitle,
    type BoardItem,
    type ChatItem,
    type DocumentItem,
    type ImageItem,
    type Issue,
    type IssuePriority,
    type IssueStatus,
    type NoteItem,
    type PullRequestItem,
    type ShapeItem,
    type ShapeType,
    type SketchItem,
    type SketchStroke,
    type Relation,
    type SurfaceItem,
    type WebItem,
    type WindowColor,
} from '~/lib/surface';

/**
 * Demo content for two of the seed's surfaces, beside the Atlas launch
 * surface the store builds itself:
 *
 * - Launch retro: a developer's surface, agents at work. Each agent chat has
 *   the pull request it opened and the docs page it worked from hanging
 *   under it, plus retro sticky notes and a summary document.
 * - Brand refresh (in the Design space): a designer's surface, two issue
 *   boards, reference images, color and component pages, and notes.
 */

export type SeedSurface = {
    items: SurfaceItem[];
    relations: Relation[];
    /** Palette colors by card id (notes take theirs from here). */
    colors: Partial<Record<string, WindowColor>>;
    /** Where cards start, when the tidy row won't do (a flowchart). */
    positions?: Partial<Record<string, { x: number; y: number }>>;
};

const DAY = '2026-10-23';

function at(time: string) {
    return `${DAY}T${time}:00Z`;
}

function note(
    surfaceId: string,
    id: string,
    text: string,
    createdById = 'dev',
): NoteItem {
    return {
        kind: 'note',
        id,
        surfaceId,
        title: noteTitle(text),
        text,
        createdById,
        updatedAt: at('16:00'),
    };
}

/** Points around an ellipse, for seeded sketches. */
function ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    steps = 36,
): number[] {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const angle = (i / steps) * Math.PI * 2;
        return [
            Math.round((cx + rx * Math.cos(angle)) * 10) / 10,
            Math.round((cy + ry * Math.sin(angle)) * 10) / 10,
        ];
    }).flat();
}

function shape(
    surfaceId: string,
    id: string,
    outline: ShapeType,
    title: string,
): ShapeItem {
    return {
        kind: 'shape',
        id,
        surfaceId,
        title,
        shape: outline,
        width: outline === 'diamond' ? 200 : 180,
        height: outline === 'diamond' ? 140 : 110,
        createdById: AGENT_ID,
        updatedAt: at('16:30'),
    };
}

function issue(
    key: string,
    number: number,
    title: string,
    status: IssueStatus,
    priority: IssuePriority,
    assigneeId?: string,
): Issue {
    return {
        id: `issue-${key.toLowerCase()}-${number}`,
        identifier: `${key}-${number}`,
        title,
        status,
        priority,
        ...(assigneeId ? { assigneeId } : {}),
        links: [],
        createdById: 'maya',
        updatedAt: at('11:00'),
    };
}

/** One agent's thread: the chat, the PR it opened, the page it read. */
function agentThread({
    surfaceId,
    id,
    title,
    messages,
    pr,
    page,
}: {
    surfaceId: string;
    id: string;
    title: string;
    messages: [author: string, text: string, time: string][];
    pr: Omit<
        PullRequestItem,
        'kind' | 'surfaceId' | 'chatId' | 'authorId' | 'createdById' | 'base'
    >;
    page: { id: string; title: string; url: string };
}): { items: SurfaceItem[]; relations: Relation[] } {
    const chat: ChatItem = {
        kind: 'chat',
        id,
        surfaceId,
        title,
        participantIds: [AGENT_ID, 'dev', 'maya'],
        createdById: AGENT_ID,
        messages: messages.map(([authorId, text, time], index) => ({
            id: `${id}-m${index + 1}`,
            authorId,
            text,
            sentAt: at(time),
        })),
    };
    const pull: PullRequestItem = {
        kind: 'pull-request',
        surfaceId,
        chatId: id,
        base: 'main',
        authorId: AGENT_ID,
        createdById: AGENT_ID,
        ...pr,
    };
    const web: WebItem = {
        kind: 'web',
        id: page.id,
        surfaceId,
        title: page.title,
        url: page.url,
        attachedTo: id,
        createdById: AGENT_ID,
        updatedAt: at('10:00'),
    };
    return {
        items: [chat, pull, web],
        relations: [
            { id: `${id}-r-pr`, from: id, to: pull.id, label: 'opened' },
            { id: `${id}-r-web`, from: id, to: web.id, label: 'references' },
        ],
    };
}

export function launchRetroSurface(surfaceId: string): SeedSurface {
    const threads = [
        agentThread({
            surfaceId,
            id: 'chat-agent-checkout',
            title: 'Agent: flaky checkout test',
            messages: [
                [
                    'dev',
                    'The checkout e2e failed twice on main today.',
                    '09:02',
                ],
                [
                    AGENT_ID,
                    'It sleeps 500ms before the payment frame loads. Swapping the timer for a wait on the frame being ready.',
                    '09:04',
                ],
                [AGENT_ID, 'Opened #493. 40 reruns green.', '09:31'],
            ],
            pr: {
                id: 'pr-checkout-wait',
                number: 493,
                title: 'Wait for the payment frame instead of a timer',
                repo: 'acme/atlas',
                branch: 'agent/checkout-wait',
                status: 'open',
                summary:
                    'Replaces a fixed sleep with a wait on the frame, which removes the flake.',
                checks: { passed: 14, failed: 0, pending: 0 },
                files: [
                    {
                        path: 'tests/checkout.spec.ts',
                        additions: 12,
                        deletions: 5,
                    },
                ],
                updatedAt: at('09:31'),
            },
            page: {
                id: 'web-playwright-waiting',
                title: 'Playwright: actionability',
                url: 'https://playwright.dev/docs/actionability',
            },
        }),
        agentThread({
            surfaceId,
            id: 'chat-agent-router',
            title: 'Agent: React Router 8 upgrade',
            messages: [
                ['dev', 'Can you take the React Router 8 upgrade?', '10:10'],
                [
                    AGENT_ID,
                    'On it. Middleware is always on now, so the future flag goes, and context moves to a RouterContextProvider.',
                    '10:12',
                ],
                [
                    AGENT_ID,
                    'Draft is up as #494. Typecheck is clean; one route test still fails on the new request URL.',
                    '11:40',
                ],
            ],
            pr: {
                id: 'pr-router-8',
                number: 494,
                title: 'Upgrade to React Router 8',
                repo: 'acme/atlas',
                branch: 'agent/react-router-8',
                status: 'draft',
                summary:
                    'Removes the v8 future flags, adopts RouterContextProvider, and updates the route types.',
                checks: { passed: 9, failed: 1, pending: 2 },
                files: [
                    { path: 'package.json', additions: 4, deletions: 4 },
                    {
                        path: 'react-router.config.ts',
                        additions: 2,
                        deletions: 6,
                    },
                    { path: 'app/root.tsx', additions: 18, deletions: 11 },
                ],
                updatedAt: at('11:40'),
            },
            page: {
                id: 'web-react-router',
                title: 'React Router: installation',
                url: 'https://reactrouter.com/start/framework/installation',
            },
        }),
        agentThread({
            surfaceId,
            id: 'chat-agent-search',
            title: 'Agent: faster search',
            messages: [
                ['maya', 'Search feels slow on big workspaces.', '13:00'],
                [
                    AGENT_ID,
                    'The index rebuilds on every keystroke. Caching it per surface and rebuilding only when cards change: 38ms down to 2ms on 2,000 cards.',
                    '13:20',
                ],
                ['dev', 'Merged. Nice.', '14:05'],
            ],
            pr: {
                id: 'pr-search-cache',
                number: 495,
                title: 'Cache the search index per surface',
                repo: 'acme/atlas',
                branch: 'agent/search-cache',
                status: 'merged',
                summary:
                    'Builds the search index once per surface and reuses it until a card changes.',
                checks: { passed: 16, failed: 0, pending: 0 },
                files: [
                    { path: 'app/lib/search.ts', additions: 41, deletions: 9 },
                    {
                        path: 'app/lib/search.test.ts',
                        additions: 28,
                        deletions: 0,
                    },
                ],
                updatedAt: at('14:05'),
            },
            page: {
                id: 'web-bun-docs',
                title: 'Bun docs',
                url: 'https://bun.sh/docs',
            },
        }),
    ];

    const summary: DocumentItem = {
        kind: 'document',
        id: 'doc-retro-notes',
        surfaceId,
        title: 'Launch retro notes',
        authorId: 'dev',
        createdById: 'dev',
        updatedAt: at('15:30'),
        blocks: markdownToPortableText(`
Three agents worked the launch follow-ups today, each in its own chat with a pull request to show for it.

## Shipped

- [Search index cache](item:pr-search-cache) is merged: search is instant again on big workspaces.
- [The checkout flake](item:chat-agent-checkout) has a fix waiting for review.

## In flight

- [React Router 8](item:pr-router-8) is a draft with one failing test.

## Next time

- Agents open **draft** pull requests until a person has looked.
`),
    };

    const notes = [
        note(
            surfaceId,
            'note-retro-good',
            'Went well: agents shipped three PRs in a day',
        ),
        note(
            surfaceId,
            'note-retro-change',
            'To change: a flaky e2e test blocked two merges',
        ),
        note(
            surfaceId,
            'note-retro-try',
            'Try: agents open draft PRs by default',
            'maya',
        ),
        note(
            surfaceId,
            'note-retro-ask',
            'Ask: who reviews agent PRs on Fridays?',
            AGENT_ID,
        ),
    ];

    // How an agent's pull request ships, drawn as a flowchart.
    const flow = [
        shape(surfaceId, 'shape-flow-open', 'circle', 'Agent opens a PR'),
        shape(surfaceId, 'shape-flow-checks', 'diamond', 'Checks pass?'),
        shape(surfaceId, 'shape-flow-fix', 'hexagon', 'Agent fixes it'),
        shape(surfaceId, 'shape-flow-review', 'rounded', 'Human review'),
        shape(surfaceId, 'shape-flow-ship', 'arrow', 'Merge and ship'),
    ];
    const step = (from: string, to: string, label: string) => ({
        id: `r-${from}-${to}`,
        from,
        to,
        label,
    });

    return {
        items: [
            ...threads.flatMap((thread) => thread.items),
            summary,
            ...notes,
            ...flow,
        ],
        relations: [
            ...threads.flatMap((thread) => thread.relations),
            step('shape-flow-open', 'shape-flow-checks', 'then'),
            step('shape-flow-checks', 'shape-flow-fix', 'no'),
            step('shape-flow-fix', 'shape-flow-checks', 'retry'),
            step('shape-flow-checks', 'shape-flow-review', 'yes'),
            step('shape-flow-review', 'shape-flow-ship', 'approved'),
            {
                id: 'r-retro-search',
                from: 'doc-retro-notes',
                to: 'chat-agent-search',
                label: 'covers',
            },
        ],
        colors: {
            'note-retro-good': 'emerald',
            'note-retro-change': 'rose',
            'note-retro-try': 'sky',
            'note-retro-ask': 'amber',
            'shape-flow-open': 'violet',
            'shape-flow-checks': 'amber',
            'shape-flow-fix': 'rose',
            'shape-flow-review': 'sky',
            'shape-flow-ship': 'emerald',
        },
        // Laid out as a flowchart under the agents' columns, the fix loop
        // dropping below the check.
        positions: {
            'shape-flow-open': { x: 0, y: 1960 },
            'shape-flow-checks': { x: 300, y: 1945 },
            'shape-flow-review': { x: 640, y: 1960 },
            'shape-flow-ship': { x: 940, y: 1960 },
            'shape-flow-fix': { x: 310, y: 2220 },
        },
    };
}

export function brandRefreshSurface(surfaceId: string): SeedSurface {
    const reviews: BoardItem = {
        kind: 'board',
        id: 'board-design-reviews',
        surfaceId,
        title: 'Design reviews',
        key: 'DSN',
        createdById: 'maya',
        updatedAt: at('11:00'),
        issues: [
            {
                ...issue(
                    'DSN',
                    1,
                    'Pick the new accent color',
                    'in_review',
                    'high',
                    'maya',
                ),
                description:
                    'Narrowed to two warm oranges. Both need to pass 4.5:1 on white and on the dark card, and still read as Atlas next to the old blue.',
                links: ['image-color-wheel'],
                comments: [
                    {
                        id: 'comment-dsn-1-1',
                        authorId: AGENT_ID,
                        text: 'Checked both against the dark card: the deeper orange passes at 4.8:1, the lighter one fails at 3.9:1.',
                        at: at('12:10'),
                    },
                    {
                        id: 'comment-dsn-1-2',
                        authorId: 'maya',
                        text: 'Going with the deeper one. Rosa, can you mock it on the pricing page?',
                        at: at('12:40'),
                    },
                ],
            },
            issue(
                'DSN',
                2,
                'Type scale for headings',
                'in_progress',
                'medium',
                'maya',
            ),
            issue('DSN', 3, 'Icon set audit', 'todo', 'low'),
            issue('DSN', 4, 'Dark mode contrast pass', 'backlog', 'high'),
            issue('DSN', 5, 'Logo lockups', 'done', 'medium', 'maya'),
        ],
    };
    const assets: BoardItem = {
        kind: 'board',
        id: 'board-launch-assets',
        surfaceId,
        title: 'Launch assets',
        key: 'AST',
        createdById: 'maya',
        updatedAt: at('11:30'),
        issues: [
            issue(
                'AST',
                1,
                'Hero illustration',
                'in_progress',
                'urgent',
                'maya',
            ),
            issue('AST', 2, 'Social cards (6 sizes)', 'todo', 'medium'),
            issue(
                'AST',
                3,
                'Product screenshots, light and dark',
                'todo',
                'high',
            ),
            issue('AST', 4, 'Email header', 'backlog', 'low'),
            issue('AST', 5, 'Favicon set', 'done', 'low', 'rosa'),
        ],
    };
    const brief: DocumentItem = {
        kind: 'document',
        id: 'doc-brand-brief',
        surfaceId,
        title: 'Brand refresh brief',
        authorId: 'maya',
        createdById: 'maya',
        updatedAt: at('09:30'),
        blocks: markdownToPortableText(`
A warmer, calmer Atlas for launch: the same shapes, a new accent, and type that reads well at every size.

## Principles

- **Contrast first**: every pairing passes 4.5:1, light and dark.
- One accent, used sparingly.
- Shapes from the Bauhaus [moodboard](item:image-bauhaus): simple, geometric, honest.

## Where things are

- Reviews run on [Design reviews](item:board-design-reviews).
- Assets for launch week live on [Launch assets](item:board-launch-assets).
`),
    };
    const image = (
        id: string,
        title: string,
        src: string,
        alt: string,
    ): ImageItem => ({
        kind: 'image',
        id,
        surfaceId,
        title,
        src,
        alt,
        animated: false,
        attachedTo: 'doc-brand-brief',
        createdById: 'maya',
        updatedAt: at('10:00'),
    });
    const images = [
        image(
            'image-bauhaus',
            'Moodboard: Bauhaus Dessau',
            'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Bauhaus_Dessau.jpg/960px-Bauhaus_Dessau.jpg',
            'The Bauhaus building in Dessau: white walls, glass, and strong horizontal lines.',
        ),
        image(
            'image-color-wheel',
            'Accent exploration',
            'https://upload.wikimedia.org/wikipedia/commons/3/38/BYR_color_wheel.svg',
            'A color wheel running through red, yellow, and blue.',
        ),
        image(
            'image-type-anatomy',
            'Type anatomy',
            'https://upload.wikimedia.org/wikipedia/commons/3/39/Typography_Line_Terms.svg',
            'A line of type with its baseline, x-height, cap height, ascender, and descender marked.',
        ),
    ];
    const page = (id: string, title: string, url: string): WebItem => ({
        kind: 'web',
        id,
        surfaceId,
        title,
        url,
        createdById: AGENT_ID,
        updatedAt: at('12:00'),
    });
    const pages = [
        page(
            'web-radix-colors',
            'Color scales',
            'https://www.radix-ui.com/colors',
        ),
        page('web-coss-ui', 'Component library', 'https://coss.com/ui'),
    ];
    const notes = [
        note(
            surfaceId,
            'note-design-contrast',
            'Keep contrast at 4.5:1 or better, everywhere',
            'maya',
        ),
        note(
            surfaceId,
            'note-design-accent',
            'Accent: warmer than last year',
            'maya',
        ),
        note(
            surfaceId,
            'note-design-dark',
            'Ask: design dark mode first?',
            AGENT_ID,
        ),
    ];

    const logoStrokes: SketchStroke[] = [
        // The mark: two overlapping circles.
        { color: '#000080', size: 6, points: ellipse(170, 190, 90, 90) },
        { color: '#ff0000', size: 6, points: ellipse(250, 190, 90, 90) },
        // A wordmark scribble and its underline.
        {
            color: '#000000',
            size: 6,
            points: [
                380, 200, 395, 160, 410, 200, 425, 160, 440, 200, 455, 170,
            ],
        },
        { color: '#000000', size: 6, points: [470, 200, 470, 160, 500, 180] },
        { color: '#808080', size: 3, points: [380, 230, 560, 228] },
        // "Warmer!" arrow toward the red circle.
        {
            color: '#ff00ff',
            size: 3,
            points: [330, 330, 300, 290, 290, 270],
        },
        { color: '#ff00ff', size: 3, points: [280, 285, 290, 270, 305, 280] },
    ];
    const logoSketch: SketchItem = {
        kind: 'sketch',
        id: 'sketch-logo-doodle',
        surfaceId,
        title: 'Logo doodle',
        strokes: logoStrokes,
        createdById: 'maya',
        updatedAt: at('15:00'),
    };

    return {
        items: [
            brief,
            reviews,
            assets,
            ...images,
            ...pages,
            ...notes,
            logoSketch,
        ],
        relations: [
            ...images.map((item) => ({
                id: `r-${item.id}`,
                from: 'doc-brand-brief',
                to: item.id,
                label: 'image',
            })),
            {
                id: 'r-brief-reviews',
                from: 'doc-brand-brief',
                to: 'board-design-reviews',
                label: 'tracked on',
            },
        ],
        colors: {
            'note-design-contrast': 'violet',
            'note-design-accent': 'amber',
            'note-design-dark': 'sky',
            'board-design-reviews': 'violet',
        },
    };
}
