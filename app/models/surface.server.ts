import { createHash } from 'node:crypto';
import type { SessionUser } from '~/context';
import { MOCK_REPLY_DELAY_MS, pickMockReply } from '~/lib/mock-chat';
import {
    arrangeGroups,
    clusterLayout,
    currentLayout,
    topLeftOf,
    type ArrangeDirection,
} from '~/lib/arrange';
import {
    brandRefreshSurface,
    launchRetroSurface,
    type SeedSurface,
} from './seed-surfaces.server';
import { uiSpecProblems } from '~/lib/ui-card';
import { markChanged } from './surface-events.server';
import {
    markdownToPortableText,
    referencedItemIds,
    type DocumentBlock,
} from '~/lib/portable-text';
import {
    AGENT_ID,
    isAgentChat,
    MEMBER_ROLE,
    frameItems,
    isGifUrl,
    noteTitle,
    normalizeWebUrl,
    placeIssue,
    youtubeVideoId,
    restack,
    type Arrangement,
    type Space,
    type SurfaceItemKind,
    type SurfaceSummary,
    type Workspace,
    type BoardItem,
    type VideoItem,
    type ImageItem,
    type NoteItem,
    type SketchItem,
    type SketchStroke,
    type UiItem,
    type WebItem,
    type ChartItem,
    type ChartPoint,
    type ChatItem,
    type ChatMessage,
    type DocumentItem,
    type Issue,
    type IssueComment,
    type IssuePriority,
    type IssueStatus,
    type Person,
    type PullRequestFile,
    type PullRequestItem,
    type PullRequestStatus,
    type Relation,
    type SavedView,
    type Surface,
    type SurfaceItem,
    type WindowColor,
    TITLE_MAX,
    hangingUnder,
    parentIdOf,
    isRenamable,
    clampSize,
    isResizable,
    type CardSize,
} from '~/lib/surface';

/**
 * The mock surface: one shared, in-memory workspace that people (through the
 * app) and agents (through `/api/mcp`) both read and write. It lives for the
 * life of the server process and resets on restart. This is the seam where a
 * real store slots in later: callers only depend on these functions and the
 * `Surface` shape.
 */

/** Who agents write as, unless they name someone else. */
export { AGENT_ID };

/**
 * The seeded cast. Signed-in people join them as `members` (by their user
 * id) the first time they open a surface; replies from the mock chat
 * service only ever come from this cast, never from a real person.
 */
const PEOPLE: Person[] = [
    { id: 'jordan', name: 'Jordan Lee', initials: 'JL', role: 'Launch Lead' },
    { id: 'maya', name: 'Maya Chen', initials: 'MC', role: 'Head of Product' },
    { id: 'dev', name: 'Dev Patel', initials: 'DP', role: 'Engineering Lead' },
    {
        id: 'rosa',
        name: 'Rosa Alvarez',
        initials: 'RA',
        role: 'Customer Success',
    },
    { id: AGENT_ID, name: 'Surface Agent', initials: 'AI', role: 'Agent' },
];

/** A surface as stored: its name, and how its cards sit. */
type SurfaceRecord = {
    id: string;
    spaceId: string;
    name: string;
    description: string;
    arrangement: Arrangement;
};

type Store = {
    spaces: Space[];
    /** In order, across all spaces. */
    surfaces: SurfaceRecord[];
    /** Every card, on every surface (each says which: `surfaceId`). */
    items: SurfaceItem[];
    relations: Relation[];
    views: SavedView[];
    /** Everyone who has signed in and opened a surface, by user id. */
    members: Person[];
};

/** A card before it's put on a surface. */
type Unplaced<T> = T extends unknown ? Omit<T, 'surfaceId'> : never;

/** The seed's main surface: everything the app started with is on it. */
export const SEED_SURFACE_ID = 'atlas-launch';

/** What the agent says first in the chat every new surface starts with. */
const AGENT_GREETING =
    "Hi! I work on this surface with you. Ask me to draft a doc, chart some numbers, start an issue board, pin a note, sketch, or pull in a page, video, or image, and I'll put it on the canvas next to this chat.";

/**
 * The chat with the agent a surface starts with: whoever writes first
 * joins, so it stays an agent chat (`isAgentChat`). Deletable like any card.
 */
function agentChat(surfaceId: string, id: string, sentAt: string): ChatItem {
    return {
        kind: 'chat',
        id,
        surfaceId,
        title: 'Ask the agent',
        participantIds: [AGENT_ID],
        messages: [
            {
                id: `${id}-hello`,
                authorId: AGENT_ID,
                text: AGENT_GREETING,
                sentAt,
            },
        ],
        createdById: AGENT_ID,
    };
}

/** A space with one live agent chat on it, to try the agent from scratch. */
function playground(): {
    space: Space;
    surface: SurfaceRecord;
    chat: ChatItem;
} {
    const chat = {
        ...agentChat('agent-test-drive', 'chat-agent', '2026-10-25T09:00:00Z'),
    };
    chat.messages[0]!.id = 'msg-agent-hello';
    return {
        space: {
            id: 'playground',
            name: 'Playground',
            description: 'Try the agent on a blank canvas.',
        },
        surface: {
            id: chat.surfaceId,
            spaceId: 'playground',
            name: 'Agent test drive',
            description: 'One chat with the agent; what it makes lands here.',
            arrangement: emptyArrangement([chat.id]),
        },
        chat,
    };
}

function emptyArrangement(itemIds: string[] = []): Arrangement {
    return { stack: itemIds, colors: {}, positions: {}, locked: [] };
}

/** The workspace every fresh store starts from. */
function seed(): Store {
    const content = seedContent();
    const launch: SurfaceItem[] = content.items.map(
        (item) => ({ ...item, surfaceId: SEED_SURFACE_ID }) as SurfaceItem,
    );
    const northwindPlan: DocumentItem = {
        kind: 'document',
        id: 'doc-northwind-plan',
        surfaceId: 'northwind',
        title: 'Northwind account plan',
        authorId: 'rosa',
        createdById: 'rosa',
        updatedAt: '2026-10-21T15:00:00Z',
        blocks: markdownToPortableText(`
Northwind runs **240 seats** across three regions and renews in March.

## What they need

- SSO before they roll Atlas out past the pilot team
- A named contact for the API freeze

## Next steps

- Share the SSO fast-follow date once it's set
- Invite their admin to the private beta
`),
    };
    const retro = launchRetroSurface('launch-retro');
    const play = playground();
    const brand = brandRefreshSurface('brand-refresh');
    const arranged = (seedSurface: SeedSurface): Arrangement => ({
        ...emptyArrangement(seedSurface.items.map((item) => item.id)),
        colors: seedSurface.colors,
    });
    return {
        members: [],
        spaces: [
            {
                id: 'product',
                name: 'Product',
                description: 'Building and launching Atlas.',
            },
            {
                id: 'customers',
                name: 'Customers',
                description: 'Accounts, and what they need from us.',
            },
            {
                id: 'design',
                name: 'Design',
                description: 'How Atlas looks, sounds, and feels.',
            },
            play.space,
        ],
        surfaces: [
            {
                id: SEED_SURFACE_ID,
                spaceId: 'product',
                name: 'Atlas launch',
                description: 'Everything for the Atlas beta and launch.',
                arrangement: emptyArrangement(launch.map((item) => item.id)),
            },
            {
                id: 'launch-retro',
                spaceId: 'product',
                name: 'Launch retro',
                description:
                    'Agents at work on the launch follow-ups: their chats, pull requests, and docs, plus the retro.',
                arrangement: arranged(retro),
            },
            {
                id: 'northwind',
                spaceId: 'customers',
                name: 'Northwind',
                description: 'The Northwind account.',
                arrangement: emptyArrangement([northwindPlan.id]),
            },
            {
                id: 'brand-refresh',
                spaceId: 'design',
                name: 'Brand refresh',
                description:
                    'A warmer Atlas for launch: reviews, assets, and references.',
                arrangement: arranged(brand),
            },
            play.surface,
        ],
        items: [
            ...launch,
            northwindPlan,
            ...retro.items,
            ...brand.items,
            play.chat,
        ],
        relations: [
            ...content.relations,
            ...retro.relations,
            ...brand.relations,
        ],
        views: seedViews(launch),
    };
}

/**
 * Starter views, each framing a cluster of related windows: whichever
 * canvas opens one fits those windows where they are now.
 */
function seedViews(items: SurfaceItem[]): SavedView[] {
    const clusters: { id: string; name: string; itemIds: string[] }[] = [
        {
            id: 'view-launch',
            name: 'Atlas launch',
            itemIds: [
                'chat-launch',
                'doc-brief',
                'pr-api-freeze',
                'chart-signups',
                'chart-partners',
            ],
        },
        {
            id: 'view-northwind',
            name: 'Northwind SSO',
            itemIds: ['chat-customers', 'doc-sso-notes', 'pr-sso-flag'],
        },
        {
            id: 'view-numbers',
            name: 'Launch numbers',
            itemIds: ['chart-signups', 'chart-partners'],
        },
        { id: 'view-board', name: 'Issue board', itemIds: ['board-atlas'] },
    ];
    return clusters.map(({ id, name, itemIds }) => ({
        id,
        surfaceId: SEED_SURFACE_ID,
        name,
        ...frameItems(items, itemIds)!,
        itemIds,
    }));
}

/** A seed issue on the Atlas board. */
function issue(
    number: number,
    title: string,
    status: IssueStatus,
    priority: IssuePriority,
    assigneeId: string | undefined,
    links: string[],
    createdById = 'maya',
): Issue {
    return {
        id: `issue-atl-${number}`,
        identifier: `ATL-${number}`,
        title,
        status,
        priority,
        ...(assigneeId ? { assigneeId } : {}),
        links,
        createdById,
        updatedAt: '2026-10-23T10:45:00Z',
    };
}

function seedContent(): {
    items: Unplaced<SurfaceItem>[];
    relations: Relation[];
} {
    return {
        items: [
            {
                kind: 'chat',
                id: 'chat-launch',
                title: 'Launch crew',
                createdById: 'maya',
                participantIds: ['jordan', 'maya', 'dev'],
                messages: [
                    {
                        id: 'm1',
                        authorId: 'maya',
                        text: 'Brief for the Atlas launch is up. Can everyone skim the timeline before standup?',
                        sentAt: '2026-10-23T09:02:00Z',
                    },
                    {
                        id: 'm2',
                        authorId: 'dev',
                        text: 'Read it. The beta date works if we freeze the API by the 6th.',
                        sentAt: '2026-10-23T09:10:00Z',
                    },
                    {
                        id: 'm3',
                        authorId: 'jordan',
                        text: "Let's call the 6th the freeze and note it in the brief.",
                        sentAt: '2026-10-23T09:14:00Z',
                    },
                    {
                        id: 'm4',
                        authorId: 'maya',
                        text: 'Done. Added it under Timeline.',
                        sentAt: '2026-10-23T09:16:00Z',
                    },
                ],
            },
            {
                kind: 'chat',
                id: 'chat-customers',
                title: 'Rosa Alvarez',
                createdById: 'rosa',
                participantIds: ['jordan', 'rosa'],
                messages: [
                    {
                        id: 'c1',
                        authorId: 'rosa',
                        text: 'Northwind asked if Atlas will support SSO at launch.',
                        sentAt: '2026-10-23T10:20:00Z',
                    },
                    {
                        id: 'c2',
                        authorId: 'jordan',
                        text: "It's in the brief as a fast follow, not day one.",
                        sentAt: '2026-10-23T10:24:00Z',
                    },
                    {
                        id: 'c3',
                        authorId: 'rosa',
                        text: "Got it. I'll set expectations and link them the open questions.",
                        sentAt: '2026-10-23T10:25:00Z',
                    },
                ],
            },
            {
                kind: 'document',
                id: 'doc-brief',
                title: 'Atlas launch brief',
                authorId: 'maya',
                createdById: 'maya',
                updatedAt: '2026-10-23T09:16:00Z',
                blocks: markdownToPortableText(`
Atlas gives every team **one shared view** of its accounts, so sales, success, and product stop keeping separate spreadsheets.

## Goals

- Move 40 design partners onto Atlas by launch
- Retire the shared accounts spreadsheet
- Cut time to answer "who owns this account?" to seconds

## Timeline

- Nov 6: API freeze ([#482](item:pr-api-freeze))
- Nov 13: private beta with design partners
- Dec 4: general availability

The work is tracked on the board:

![](item:board-atlas)

## Open questions

- SSO at launch or as a fast follow? See [Northwind's questions](item:doc-sso-notes).
- Which partners get early access to the API?
`),
            },
            {
                kind: 'pull-request',
                id: 'pr-api-freeze',
                title: 'Freeze the public API for the Atlas beta',
                number: 482,
                repo: 'acme/atlas',
                branch: 'atlas/api-freeze',
                base: 'main',
                status: 'open',
                authorId: AGENT_ID,
                createdById: AGENT_ID,
                chatId: 'chat-launch',
                summary:
                    'Locks the v1 endpoints for the Nov 6 freeze and marks the experimental ones as such.',
                checks: { passed: 12, failed: 0, pending: 1 },
                files: [
                    { path: 'api/v1/routes.ts', additions: 48, deletions: 12 },
                    { path: 'api/v1/schema.ts', additions: 31, deletions: 9 },
                    {
                        path: 'docs/api/changelog.md',
                        additions: 22,
                        deletions: 0,
                    },
                ],
                updatedAt: '2026-10-23T09:40:00Z',
            },
            {
                kind: 'pull-request',
                id: 'pr-sso-flag',
                title: 'Add an SSO fast-follow feature flag',
                number: 485,
                repo: 'acme/atlas',
                branch: 'atlas/sso-flag',
                base: 'main',
                status: 'draft',
                authorId: AGENT_ID,
                createdById: AGENT_ID,
                chatId: 'chat-customers',
                summary:
                    'Ships SSO behind a flag so Northwind can try it right after launch.',
                checks: { passed: 9, failed: 1, pending: 0 },
                files: [
                    { path: 'auth/sso.ts', additions: 64, deletions: 3 },
                    { path: 'flags/index.ts', additions: 6, deletions: 0 },
                ],
                updatedAt: '2026-10-23T10:40:00Z',
            },
            {
                kind: 'document',
                id: 'doc-sso-notes',
                title: 'Northwind SSO questions',
                authorId: AGENT_ID,
                createdById: AGENT_ID,
                updatedAt: '2026-10-23T10:30:00Z',
                blocks: markdownToPortableText(`
Drafted by the Surface Agent from [the chat with Rosa](item:chat-customers), so customer success has one answer to send.

## What Northwind asked

- Will Atlas support SSO at launch?
- Which identity providers are planned?

## What to tell them

SSO is a *fast follow*, not day one. It ships behind a flag ([#485](item:pr-sso-flag)) so Northwind can try it right after launch.
`),
            },
            {
                kind: 'chart',
                id: 'chart-signups',
                title: 'Beta signups this week',
                chart: 'line',
                attachedTo: 'chat-launch',
                caption:
                    'Daily design-partner signups since the brief went out.',
                unit: 'signups',
                points: [
                    { label: 'Mon', value: 4 },
                    { label: 'Tue', value: 7 },
                    { label: 'Wed', value: 6 },
                    { label: 'Thu', value: 11 },
                    { label: 'Fri', value: 14 },
                ],
                createdById: AGENT_ID,
                updatedAt: '2026-10-23T09:50:00Z',
            },
            {
                kind: 'chart',
                id: 'chart-partners',
                title: 'Design partners by stage',
                chart: 'bar',
                attachedTo: 'doc-brief',
                caption: 'Toward the goal of 40 partners on Atlas by launch.',
                unit: 'partners',
                points: [
                    { label: 'Invited', value: 52 },
                    { label: 'Signed', value: 31 },
                    { label: 'Onboarded', value: 18 },
                    { label: 'Active', value: 12 },
                ],
                createdById: 'maya',
                updatedAt: '2026-10-23T09:20:00Z',
            },
            {
                kind: 'video',
                id: 'video-launch',
                title: 'How Apple launched the iPhone',
                videoId: 'MnrJzXM7a6o',
                attachedTo: 'doc-brief',
                createdById: 'maya',
                updatedAt: '2026-10-22T16:00:00Z',
            },
            {
                kind: 'image',
                id: 'image-iphone',
                title: 'The first iPhone',
                src: 'https://upload.wikimedia.org/wikipedia/commons/4/45/IPhone_First_Generation.jpg',
                alt: 'The original iPhone from 2007, face up, showing its home screen.',
                animated: false,
                attachedTo: 'chat-launch',
                createdById: 'maya',
                updatedAt: '2026-10-22T16:10:00Z',
            },
            {
                kind: 'image',
                id: 'image-earth',
                title: 'Launch day, everywhere',
                src: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif',
                alt: 'An animated globe turning slowly.',
                animated: true,
                attachedTo: 'chat-customers',
                createdById: AGENT_ID,
                updatedAt: '2026-10-23T10:36:00Z',
            },
            {
                kind: 'web',
                id: 'web-launch-guide',
                title: 'Product launch (Wikipedia)',
                url: 'https://en.wikipedia.org/wiki/Product_launch',
                attachedTo: 'doc-sso-notes',
                createdById: AGENT_ID,
                updatedAt: '2026-10-23T10:35:00Z',
            },
            {
                kind: 'board',
                id: 'board-atlas',
                title: 'Atlas launch',
                key: 'ATL',
                createdById: 'maya',
                updatedAt: '2026-10-23T10:45:00Z',
                issues: [
                    issue(
                        11,
                        'Write the beta welcome email',
                        'backlog',
                        'low',
                        'rosa',
                        [],
                    ),
                    issue(
                        12,
                        'Pick early-access partners for the API',
                        'backlog',
                        'medium',
                        undefined,
                        ['doc-brief'],
                    ),
                    issue(
                        13,
                        'Rate limit the public API',
                        'todo',
                        'high',
                        'dev',
                        ['chat-launch'],
                    ),
                    issue(
                        15,
                        'Partner onboarding checklist',
                        'todo',
                        'medium',
                        'maya',
                        ['chart-partners'],
                    ),
                    issue(
                        16,
                        'Accounts table loads slowly past 5k rows',
                        'in_progress',
                        'urgent',
                        'dev',
                        [],
                    ),
                    issue(
                        17,
                        'SSO behind a fast-follow flag',
                        'in_progress',
                        'high',
                        'dev',
                        ['pr-sso-flag', 'doc-sso-notes'],
                        AGENT_ID,
                    ),
                    issue(
                        14,
                        'Freeze the public API for the beta',
                        'in_review',
                        'urgent',
                        'dev',
                        ['pr-api-freeze', 'chat-launch'],
                        AGENT_ID,
                    ),
                    issue(
                        10,
                        'Draft the Atlas launch brief',
                        'done',
                        'medium',
                        'maya',
                        ['doc-brief'],
                    ),
                ],
            },
        ],
        relations: [
            {
                id: 'r1',
                from: 'chat-launch',
                to: 'doc-brief',
                label: 'discusses',
            },
            {
                id: 'r2',
                from: 'chat-customers',
                to: 'doc-brief',
                label: 'references',
            },
            {
                id: 'r3',
                from: 'chat-launch',
                to: 'pr-api-freeze',
                label: 'opened',
            },
            {
                id: 'r4',
                from: 'chat-customers',
                to: 'pr-sso-flag',
                label: 'opened',
            },
            {
                id: 'r5',
                from: 'chat-customers',
                to: 'doc-sso-notes',
                label: 'summarized in',
            },
            {
                id: 'r6',
                from: 'chat-launch',
                to: 'chart-signups',
                label: 'charted',
            },
            {
                id: 'r7',
                from: 'doc-brief',
                to: 'chart-partners',
                label: 'charted',
            },
            {
                id: 'r8',
                from: 'board-atlas',
                to: 'doc-brief',
                label: 'tracks',
            },
            {
                id: 'r9',
                from: 'doc-brief',
                to: 'video-launch',
                label: 'inspired by',
            },
            {
                id: 'r11',
                from: 'chat-launch',
                to: 'image-iphone',
                label: 'image',
            },
            {
                id: 'r12',
                from: 'chat-customers',
                to: 'image-earth',
                label: 'image',
            },
            {
                id: 'r10',
                from: 'doc-sso-notes',
                to: 'web-launch-guide',
                label: 'references',
            },
        ],
    };
}

// Kept on globalThis so dev-server reloads of this module keep the data.
const STORE_KEY = Symbol.for('company-surface.mock-store');
type WithStore = typeof globalThis & { [STORE_KEY]?: Store };

function store(): Store {
    const scope = globalThis as WithStore;
    // A store made by older code (kept across dev reloads) from before
    // spaces and surfaces: start over from the seed.
    if (!scope[STORE_KEY] || !('spaces' in scope[STORE_KEY])) {
        scope[STORE_KEY] = seed();
    }
    const current = scope[STORE_KEY];
    // Stores from before real people (kept across dev reloads).
    current.members ??= [];
    // Stores from before locking (kept across dev reloads).
    for (const surface of current.surfaces) surface.arrangement.locked ??= [];
    // Stores from before shapes were removed: their shape cards go.
    dropRemovedKinds(current);
    // Stores from before the playground space get it.
    if (!current.spaces.some((space) => space.id === 'playground')) {
        const play = playground();
        current.spaces.push(play.space);
        current.surfaces.push(play.surface);
        current.items.push(play.chat);
    }
    // Documents from before Portable Text: seeded ones take the new seed's
    // content (with its links), others are converted.
    const legacy = current.items.filter(
        (item): item is DocumentItem =>
            item.kind === 'document' && !isPortableText(item.blocks),
    );
    if (legacy.length > 0) {
        const seeded = new Map(
            seedContent().items.map((item) => [item.id, item]),
        );
        for (const doc of legacy) {
            const fresh = seeded.get(doc.id);
            doc.blocks =
                fresh?.kind === 'document'
                    ? fresh.blocks
                    : toPortableText(doc.blocks);
        }
    }
    return current;
}

/** Kinds of card the app no longer has (shapes, removed 2026-10-25). */
const REMOVED_KINDS = new Set(['shape']);

/**
 * Takes cards of removed kinds out of a store made by older code (kept
 * across dev reloads), with their links, arrangement, and view framing.
 */
function dropRemovedKinds(current: Store) {
    const gone = new Set(
        current.items
            .filter((item) => REMOVED_KINDS.has(item.kind as string))
            .map((item) => item.id),
    );
    if (gone.size === 0) return;
    current.items = current.items.filter((item) => !gone.has(item.id));
    current.relations = current.relations.filter(
        (relation) => !gone.has(relation.from) && !gone.has(relation.to),
    );
    for (const { arrangement } of current.surfaces) {
        arrangement.stack = arrangement.stack.filter((id) => !gone.has(id));
        arrangement.locked = arrangement.locked.filter((id) => !gone.has(id));
        for (const id of gone) {
            delete arrangement.colors[id];
            delete arrangement.positions[id];
        }
    }
    for (const view of current.views) {
        view.itemIds = view.itemIds?.filter((id) => !gone.has(id));
    }
}

/**
 * Now, but always later than `previous`: two edits in the same millisecond
 * must still get different versions, or a stale save would look current.
 */
function nextTimestamp(previous: string): string {
    const now = Date.now();
    const last = Date.parse(previous);
    return new Date(now > last ? now : last + 1).toISOString();
}

/** Blocks from before documents were Portable Text, converted. */
type LegacyBlock =
    | { type: 'heading'; text: string }
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] };

function isPortableText(
    blocks: (DocumentBlock | LegacyBlock)[],
): blocks is DocumentBlock[] {
    return blocks.every((block) => '_type' in block);
}

function toPortableText(blocks: (DocumentBlock | LegacyBlock)[]) {
    if (isPortableText(blocks)) return blocks;
    return blocks.flatMap((block) => {
        if ('_type' in block) return [block];
        if (block.type === 'heading') {
            return markdownToPortableText(`## ${block.text}`);
        }
        if (block.type === 'list') {
            return markdownToPortableText(
                block.items.map((entry) => `- ${entry}`).join('\n'),
            );
        }
        return markdownToPortableText(block.text);
    });
}

/** Back to the seed data. For tests. */
export function resetSurface() {
    (globalThis as WithStore)[STORE_KEY] = seed();
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? [parts[0], parts.at(-1)!] : parts;
    return letters.map((part) => part[0]!.toUpperCase()).join('') || '?';
}

function newId(prefix: string) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export class SurfaceError extends Error {}

/** A save based on a version someone else has since replaced. */
export class SurfaceConflictError extends SurfaceError {}

function requireItem(id: string): SurfaceItem {
    const item = store().items.find((candidate) => candidate.id === id);
    if (!item) throw new SurfaceError(`No item with id "${id}".`);
    return item;
}

function requireSurface(id: string): SurfaceRecord {
    const surface = store().surfaces.find((candidate) => candidate.id === id);
    if (!surface) throw new SurfaceError(`No surface with id "${id}".`);
    return surface;
}

function requireSpace(id: string): Space {
    const space = store().spaces.find((candidate) => candidate.id === id);
    if (!space) throw new SurfaceError(`No space with id "${id}".`);
    return space;
}

/** The arrangement of the surface a card is on. */
function arrangementOf(itemId: string): Arrangement {
    return requireSurface(requireItem(itemId).surfaceId).arrangement;
}

/** Puts a new card on its surface, on top of the stack. */
function addItem(item: SurfaceItem) {
    requireSurface(item.surfaceId).arrangement.stack.push(item.id);
    store().items.push(item);
}

/**
 * Where a new card goes: under its parent's surface when it hangs from
 * one, else the surface named.
 */
function surfaceFor(
    parentId: string | undefined,
    surfaceId: string | undefined,
): string {
    if (parentId) return requireItem(parentId).surfaceId;
    if (!surfaceId) {
        throw new SurfaceError(
            'Say which surface it goes on (surfaceId; see list_spaces).',
        );
    }
    return requireSurface(surfaceId).id;
}

/** Cards a document links to or embeds must be on its surface. */
function requireReferencesOn(surfaceId: string, blocks: DocumentBlock[]) {
    for (const id of referencedItemIds(blocks)) {
        if (requireItem(id).surfaceId !== surfaceId) {
            throw new SurfaceError(
                `"${id}" is on another surface; documents link to cards on their own surface.`,
            );
        }
    }
}

function requireKnownPeople(ids: string[]) {
    const known = new Set(listPeople().map((person) => person.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
        throw new SurfaceError(`Unknown people: ${unknown.join(', ')}.`);
    }
}

export function isMember(id: string) {
    return store().members.some((member) => member.id === id);
}

/**
 * The signed-in user as a person on the surface, added to `members` the
 * first time (and renamed when their name changes).
 */
export function rememberPerson(user: SessionUser): Person {
    const name = user.name || user.email;
    const person: Person = {
        id: user.id,
        name,
        initials: initialsOf(name),
        role: MEMBER_ROLE,
    };
    const { members } = store();
    const index = members.findIndex((member) => member.id === user.id);
    if (index === -1) members.push(person);
    else members[index] = person;
    return structuredClone(person);
}

/** Everyone: signed-in members, then the seeded cast and the agent. */
export function listPeople(): Person[] {
    return structuredClone([...store().members, ...PEOPLE]);
}

/** Every space and its surfaces, in order, with what's on each. */
export function getWorkspace(): Workspace {
    const { spaces, surfaces, items } = store();
    return structuredClone({
        spaces: spaces.map((space) => ({
            ...space,
            surfaces: surfaces
                .filter((surface) => surface.spaceId === space.id)
                .map((surface) => {
                    const cards = items.filter(
                        (item) => item.surfaceId === surface.id,
                    );
                    return {
                        id: surface.id,
                        spaceId: surface.spaceId,
                        name: surface.name,
                        description: surface.description,
                        cardCount: cards.length,
                        kinds: [...new Set(cards.map((item) => item.kind))],
                    };
                }),
        })),
    });
}

/** One surface, open; null when there's no such surface. */
export async function getSurfaceForUser(
    user: SessionUser,
    surfaceId: string,
): Promise<Surface | null> {
    const record = store().surfaces.find(
        (candidate) => candidate.id === surfaceId,
    );
    if (!record) return null;
    const me = rememberPerson(user);
    const items = store().items.filter((item) => item.surfaceId === surfaceId);
    const ids = new Set(items.map((item) => item.id));

    // A copy, so nothing outside this module can change the store by hand.
    return structuredClone({
        id: record.id,
        name: record.name,
        description: record.description,
        space: requireSpace(record.spaceId),
        workspace: getWorkspace(),
        meId: me.id,
        people: [me, ...listPeople().filter((person) => person.id !== me.id)],
        items,
        relations: store().relations.filter(
            (relation) => ids.has(relation.from) && ids.has(relation.to),
        ),
        arrangement: record.arrangement,
        views: store().views.filter((view) => view.surfaceId === surfaceId),
    });
}

/**
 * A fingerprint of what's on a surface (the same for every viewer), or null
 * for no such surface. The page keeps the one it loaded and reloads when
 * the event stream sends another. Only this surface counts: new surfaces
 * elsewhere (the switcher's list) and people signing in show with the next
 * reload, rather than reloading every open surface at once.
 */
export function surfaceVersion(surfaceId: string): string | null {
    const { surfaces, items, relations, views } = store();
    const record = surfaces.find((candidate) => candidate.id === surfaceId);
    if (!record) return null;
    const cards = items.filter((item) => item.surfaceId === surfaceId);
    const ids = new Set(cards.map((item) => item.id));
    const shared = JSON.stringify([
        record,
        requireSpace(record.spaceId),
        cards,
        relations.filter(
            (relation) => ids.has(relation.from) && ids.has(relation.to),
        ),
        views.filter((view) => view.surfaceId === surfaceId),
    ]);
    return createHash('sha1').update(shared).digest('base64url').slice(0, 16);
}

/** A card on this surface, or null. */
export async function getSurfaceItem(
    _user: SessionUser,
    surfaceId: string,
    itemId: string,
): Promise<SurfaceItem | null> {
    const item = store().items.find(
        (candidate) =>
            candidate.id === itemId && candidate.surfaceId === surfaceId,
    );
    return item ? structuredClone(item) : null;
}

export function listItems(surfaceId?: string) {
    if (surfaceId) requireSurface(surfaceId);
    return store()
        .items.filter((item) => !surfaceId || item.surfaceId === surfaceId)
        .map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            surfaceId: item.surfaceId,
        }));
}

/** Starts a space, empty. */
export function createSpace({
    name,
    description = '',
}: {
    name: string;
    description?: string;
}): Space {
    const space: Space = { id: newId('space'), name, description };
    store().spaces.push(space);
    return structuredClone(space);
}

/** Starts a surface in a space, with a chat with the agent on it. */
export function createSurface({
    spaceId,
    name,
    description = '',
}: {
    spaceId: string;
    name: string;
    description?: string;
}): SurfaceSummary {
    requireSpace(spaceId);
    const record: SurfaceRecord = {
        id: newId('surface'),
        spaceId,
        name,
        description,
        arrangement: emptyArrangement(),
    };
    store().surfaces.push(record);
    addItem(agentChat(record.id, newId('chat'), new Date().toISOString()));
    return {
        id: record.id,
        spaceId,
        name,
        description,
        cardCount: 1,
        kinds: ['chat'],
    };
}

export function getItem(itemId: string): SurfaceItem {
    return structuredClone(requireItem(itemId));
}

export function createChat({
    surfaceId,
    title,
    participantIds = [AGENT_ID],
    firstMessage,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    title: string;
    participantIds?: string[];
    firstMessage?: string;
    authorId?: string;
}): ChatItem {
    const participants = [...new Set([...participantIds, authorId])];
    requireKnownPeople(participants);
    const chat: ChatItem = {
        kind: 'chat',
        id: newId('chat'),
        surfaceId: requireSurface(surfaceId).id,
        title,
        participantIds: participants,
        messages: [],
        createdById: authorId,
    };
    addItem(chat);
    if (firstMessage)
        postMessage({ chatId: chat.id, authorId, text: firstMessage });
    return structuredClone(chat);
}

/**
 * Adds a message. When a person (not an agent) writes, someone else in the
 * chat answers after a pause, from the mock reply service; `awaitingReply`
 * is true until then. Agent chats (`isAgentChat`) never get mock replies:
 * only the live agent answers them, so with it off nobody does rather than
 * the agent seeming to answer. `mockReply: false` skips it anywhere.
 */
export function postMessage({
    chatId,
    authorId,
    text,
    id = crypto.randomUUID(),
    parts,
    mockReply = true,
}: {
    chatId: string;
    authorId: string;
    text: string;
    /** The id the client already shows it under (a streamed message's). */
    id?: string;
    parts?: ChatMessage['parts'];
    mockReply?: boolean;
}): ChatMessage {
    const chat = requireItem(chatId);
    if (chat.kind !== 'chat') {
        throw new SurfaceError(`"${chatId}" is a ${chat.kind}, not a chat.`);
    }
    requireKnownPeople([authorId]);

    if (chat.messages.some((existing) => existing.id === id)) {
        throw new SurfaceError(`A message with id "${id}" is already there.`);
    }
    const message: ChatMessage = {
        id,
        authorId,
        text,
        sentAt: new Date().toISOString(),
        ...(parts && { parts }),
    };
    chat.messages.push(message);
    if (!chat.participantIds.includes(authorId)) {
        chat.participantIds.push(authorId);
    }

    // Only the seeded cast and the agent answer: a real person's words are
    // never made up for them.
    const repliers = chat.participantIds.filter((id) => !isMember(id));
    if (
        isMember(authorId) &&
        mockReply &&
        !isAgentChat(chat, isMember) &&
        repliers.length > 0
    ) {
        chat.awaitingReply = true;
        setTimeout(() => {
            chat.messages.push(
                pickMockReply(
                    { participantIds: repliers },
                    { meId: authorId, exclude: [AGENT_ID] },
                ),
            );
            chat.awaitingReply = false;
            markChanged();
        }, MOCK_REPLY_DELAY_MS);
    }
    return structuredClone(message);
}

/** Shows (or stops showing) someone typing in a chat: the live agent's turn. */
export function setAwaitingReply(chatId: string, awaiting: boolean) {
    const chat = requireItem(chatId);
    if (chat.kind !== 'chat') {
        throw new SurfaceError(`"${chatId}" is a ${chat.kind}, not a chat.`);
    }
    chat.awaitingReply = awaiting;
}

export function createDocument({
    surfaceId,
    title,
    blocks,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    title: string;
    blocks: DocumentBlock[];
    authorId?: string;
}): DocumentItem {
    requireSurface(surfaceId);
    requireKnownPeople([authorId]);
    requireReferencesOn(surfaceId, blocks);
    const doc: DocumentItem = {
        kind: 'document',
        id: newId('doc'),
        surfaceId,
        title,
        authorId,
        createdById: authorId,
        updatedAt: new Date().toISOString(),
        blocks,
    };
    addItem(doc);
    return structuredClone(doc);
}

export function appendToDocument({
    documentId,
    blocks,
    authorId = AGENT_ID,
}: {
    documentId: string;
    blocks: DocumentBlock[];
    authorId?: string;
}): DocumentItem {
    const doc = requireItem(documentId);
    if (doc.kind !== 'document') {
        throw new SurfaceError(
            `"${documentId}" is a ${doc.kind}, not a document.`,
        );
    }
    requireKnownPeople([authorId]);
    requireReferencesOn(doc.surfaceId, blocks);
    doc.blocks.push(...blocks);
    doc.authorId = authorId;
    doc.updatedAt = nextTimestamp(doc.updatedAt);
    return structuredClone(doc);
}

/**
 * Replaces a document's content, as long as nobody else has changed it
 * since `baseUpdatedAt` (the version the editor started from); otherwise a
 * `SurfaceConflictError`, so an agent's edit is never silently lost.
 */
export function updateDocument({
    documentId,
    blocks,
    baseUpdatedAt,
    authorId = AGENT_ID,
}: {
    documentId: string;
    blocks: DocumentBlock[];
    baseUpdatedAt: string;
    authorId?: string;
}): DocumentItem {
    const doc = requireItem(documentId);
    if (doc.kind !== 'document') {
        throw new SurfaceError(
            `"${documentId}" is a ${doc.kind}, not a document.`,
        );
    }
    if (doc.updatedAt !== baseUpdatedAt) {
        throw new SurfaceConflictError(
            'This document changed since you started editing.',
        );
    }
    requireKnownPeople([authorId]);
    requireReferencesOn(doc.surfaceId, blocks);
    doc.blocks = blocks;
    doc.authorId = authorId;
    doc.updatedAt = nextTimestamp(doc.updatedAt);
    return structuredClone(doc);
}

export function linkItems({
    from,
    to,
    label,
}: {
    from: string;
    to: string;
    label: string;
}): Relation {
    if (requireItem(from).surfaceId !== requireItem(to).surfaceId) {
        throw new SurfaceError(
            'Cards on different surfaces can not be linked.',
        );
    }
    const relation: Relation = { id: newId('rel'), from, to, label };
    store().relations.push(relation);
    return structuredClone(relation);
}

/** Removes a relation between two cards (the line between them). */
export function unlinkItems(relationId: string) {
    const relations = store().relations;
    const index = relations.findIndex((relation) => relation.id === relationId);
    if (index === -1) {
        throw new SurfaceError(`No link with id "${relationId}".`);
    }
    relations.splice(index, 1);
}

/** Removes every link between two cards, either way round; how many went. */
/** The links between cards on a surface, each with both cards' titles. */
export function listLinks(surfaceId: string) {
    requireSurface(surfaceId);
    const titles = new Map(
        store()
            .items.filter((item) => item.surfaceId === surfaceId)
            .map((item) => [item.id, item.title]),
    );
    return store()
        .relations.filter(
            (relation) => titles.has(relation.from) && titles.has(relation.to),
        )
        .map((relation) => ({
            ...relation,
            fromTitle: titles.get(relation.from)!,
            toTitle: titles.get(relation.to)!,
        }));
}

export function unlinkCards({ from, to }: { from: string; to: string }) {
    requireItem(from);
    requireItem(to);
    const relations = store().relations;
    const before = relations.length;
    store().relations = relations.filter(
        (relation) =>
            !(
                (relation.from === from && relation.to === to) ||
                (relation.from === to && relation.to === from)
            ),
    );
    return before - store().relations.length;
}

/** Brings a window to the front of the canvas, or sends it to the back. */
export function restackItem(itemId: string, to: 'front' | 'back'): string[] {
    const arrangement = arrangementOf(itemId);
    arrangement.stack = restack(arrangement.stack, itemId, to);
    return [...arrangement.stack];
}

/** Sets a window's border color; `null` goes back to the default border. */
export function setItemColor(itemId: string, color: WindowColor | null) {
    const { colors } = arrangementOf(itemId);
    if (color) colors[itemId] = color;
    else delete colors[itemId];
}

export function getSavedView(viewId: string): SavedView | null {
    const view = store().views.find((candidate) => candidate.id === viewId);
    return view ? structuredClone(view) : null;
}

/** Saves a place on the canvas to jump back to. */
export function saveView({
    surfaceId,
    name,
    center,
    zoom,
    itemIds,
}: Omit<SavedView, 'id'>): SavedView {
    requireSurface(surfaceId);
    for (const id of itemIds ?? []) {
        if (requireItem(id).surfaceId !== surfaceId) {
            throw new SurfaceError(`"${id}" is not on this surface.`);
        }
    }
    const view: SavedView = {
        id: newId('view'),
        surfaceId,
        name,
        center,
        zoom,
        ...(itemIds ? { itemIds } : {}),
    };
    store().views.push(view);
    return structuredClone(view);
}

export function deleteView(viewId: string) {
    const views = store().views;
    const index = views.findIndex((view) => view.id === viewId);
    if (index === -1) throw new SurfaceError(`No view with id "${viewId}".`);
    views.splice(index, 1);
}

export function listViews(surfaceId?: string): SavedView[] {
    return structuredClone(
        store().views.filter(
            (view) => !surfaceId || view.surfaceId === surfaceId,
        ),
    );
}

/** All items, for laying out views (see `frameItems`). */
export function allItems(): SurfaceItem[] {
    return structuredClone(store().items);
}

/**
 * Opens a (mock) pull request from a chat: the change a conversation
 * produced. It hangs under the chat on the canvas, linked as "opened", and
 * the chat gets a message saying so.
 */
export function openPullRequest({
    chatId,
    title,
    branch,
    base = 'main',
    summary = '',
    files = [],
    draft = false,
    authorId = AGENT_ID,
}: {
    chatId: string;
    title: string;
    branch: string;
    base?: string;
    summary?: string;
    files?: PullRequestFile[];
    draft?: boolean;
    authorId?: string;
}): PullRequestItem {
    const chat = requireItem(chatId);
    if (chat.kind !== 'chat') {
        throw new SurfaceError(`"${chatId}" is a ${chat.kind}, not a chat.`);
    }
    requireKnownPeople([authorId]);

    const numbers = store()
        .items.filter((item) => item.kind === 'pull-request')
        .map((item) => (item as PullRequestItem).number);
    const pr: PullRequestItem = {
        kind: 'pull-request',
        id: newId('pr'),
        surfaceId: chat.surfaceId,
        title,
        number: Math.max(480, ...numbers) + 1,
        repo: 'acme/atlas',
        branch,
        base,
        status: draft ? 'draft' : 'open',
        authorId,
        createdById: authorId,
        chatId,
        summary,
        // Mock CI: everything queued until someone (or an agent) moves it on.
        checks: { passed: 0, failed: 0, pending: 8 },
        files,
        updatedAt: new Date().toISOString(),
    };
    addItem(pr);
    linkItems({ from: chatId, to: pr.id, label: 'opened' });
    postMessage({
        chatId,
        authorId,
        text: `Opened #${pr.number}: ${title} (${branch} → ${base}).`,
    });
    return structuredClone(pr);
}

/** Moves a pull request along: draft, open, merged, or closed. */
export function setPullRequestStatus(
    pullRequestId: string,
    status: PullRequestStatus,
): PullRequestItem {
    const pr = requireItem(pullRequestId);
    if (pr.kind !== 'pull-request') {
        throw new SurfaceError(
            `"${pullRequestId}" is a ${pr.kind}, not a pull request.`,
        );
    }
    pr.status = status;
    if (status === 'merged') {
        pr.checks = {
            passed: pr.checks.passed + pr.checks.pending,
            failed: pr.checks.failed,
            pending: 0,
        };
    }
    pr.updatedAt = new Date().toISOString();
    // Merging finishes the issues it was in review for.
    if (status === 'merged') {
        for (const board of boards()) {
            for (const tracked of board.issues) {
                if (
                    tracked.links.includes(pr.id) &&
                    tracked.status === 'in_review'
                ) {
                    tracked.status = 'done';
                    tracked.updatedAt = pr.updatedAt;
                }
            }
        }
    }
    return structuredClone(pr);
}

/**
 * Adds a (mock) chart hanging under the chat or document it explains,
 * linked as "charted".
 */
export function createChart({
    attachedTo,
    title,
    chart,
    caption = '',
    unit,
    points,
    authorId = AGENT_ID,
}: {
    attachedTo: string;
    title: string;
    chart: ChartItem['chart'];
    caption?: string;
    unit: string;
    points: ChartPoint[];
    authorId?: string;
}): ChartItem {
    const parent = requireItem(attachedTo);
    if (parent.kind !== 'chat' && parent.kind !== 'document') {
        throw new SurfaceError(
            `Charts attach to chats and documents, and "${attachedTo}" is a ${parent.kind}.`,
        );
    }
    requireKnownPeople([authorId]);
    const item: ChartItem = {
        kind: 'chart',
        id: newId('chart'),
        surfaceId: parent.surfaceId,
        title,
        chart,
        attachedTo,
        caption,
        unit,
        points,
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(item);
    linkItems({ from: attachedTo, to: item.id, label: 'charted' });
    return structuredClone(item);
}

function boards(): BoardItem[] {
    return store().items.filter(
        (item): item is BoardItem => item.kind === 'board',
    );
}

function requireBoard(boardId: string): BoardItem {
    const board = requireItem(boardId);
    if (board.kind !== 'board') {
        throw new SurfaceError(`"${boardId}" is a ${board.kind}, not a board.`);
    }
    return board;
}

/** Starts an issue board. `key` prefixes its issue identifiers ("ATL-1"). */
/** Checks a parent for videos and web pages: a chat or a document. */
function requireAttachable(attachedTo: string | undefined, what: string) {
    if (attachedTo === undefined) return;
    const parent = requireItem(attachedTo);
    if (parent.kind !== 'chat' && parent.kind !== 'document') {
        throw new SurfaceError(
            `${what} attach to chats and documents, and "${attachedTo}" is a ${parent.kind}.`,
        );
    }
}

/**
 * Adds a YouTube video from a link (any YouTube URL form) or an id. With
 * `attachedTo`, it hangs under that chat or document, linked as "video";
 * otherwise it joins the main row.
 */
export function createVideo({
    url,
    title,
    attachedTo,
    authorId = AGENT_ID,
    surfaceId,
}: {
    url: string;
    title: string;
    attachedTo?: string;
    authorId?: string;
    surfaceId?: string;
}): VideoItem {
    const videoId = youtubeVideoId(url);
    if (!videoId) throw new SurfaceError(`"${url}" is not a YouTube video.`);
    requireAttachable(attachedTo, 'Videos');
    requireKnownPeople([authorId]);
    const item: VideoItem = {
        kind: 'video',
        id: newId('video'),
        surfaceId: surfaceFor(attachedTo, surfaceId),
        title,
        videoId,
        ...(attachedTo ? { attachedTo } : {}),
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(item);
    if (attachedTo)
        linkItems({ from: attachedTo, to: item.id, label: 'video' });
    return structuredClone(item);
}

/**
 * Adds a web page (https only) in a browser window, hanging under
 * `attachedTo` (linked as "references") or on the main row.
 */
export function createWebPage({
    url,
    title,
    attachedTo,
    authorId = AGENT_ID,
    surfaceId,
}: {
    url: string;
    title: string;
    attachedTo?: string;
    authorId?: string;
    surfaceId?: string;
}): WebItem {
    const normalized = normalizeWebUrl(url);
    if (!normalized) {
        throw new SurfaceError(`"${url}" is not an https web address.`);
    }
    requireAttachable(attachedTo, 'Web pages');
    requireKnownPeople([authorId]);
    const item: WebItem = {
        kind: 'web',
        id: newId('web'),
        surfaceId: surfaceFor(attachedTo, surfaceId),
        title,
        url: normalized,
        ...(attachedTo ? { attachedTo } : {}),
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(item);
    if (attachedTo) {
        linkItems({ from: attachedTo, to: item.id, label: 'references' });
    }
    return structuredClone(item);
}

/**
 * Adds a picture from an https address; a .gif is marked animated unless
 * `animated` says otherwise. Hangs under `attachedTo` (linked as "image")
 * or joins the main row.
 */
export function createImage({
    url,
    title,
    alt = '',
    animated,
    attachedTo,
    authorId = AGENT_ID,
    surfaceId,
}: {
    url: string;
    title: string;
    alt?: string;
    animated?: boolean;
    attachedTo?: string;
    authorId?: string;
    surfaceId?: string;
}): ImageItem {
    const src = normalizeWebUrl(url);
    if (!src) throw new SurfaceError(`"${url}" is not an https image address.`);
    requireAttachable(attachedTo, 'Images');
    requireKnownPeople([authorId]);
    const item: ImageItem = {
        kind: 'image',
        id: newId('image'),
        surfaceId: surfaceFor(attachedTo, surfaceId),
        title,
        src,
        alt,
        animated: animated ?? isGifUrl(src),
        ...(attachedTo ? { attachedTo } : {}),
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(item);
    if (attachedTo)
        linkItems({ from: attachedTo, to: item.id, label: 'image' });
    return structuredClone(item);
}

/**
 * Copies an item: a new id, "(copy)" after the title, made by `authorId`
 * now, with its own message and issue ids, the original's border color,
 * and the same relations (so a hanging copy hangs under the same parent).
 * Pull requests can't be copied: each stands for one real code change.
 * With `position`, the copy opens there (beside the original) instead of
 * where the tidy layout would put it.
 */
export function duplicateItem({
    itemId,
    authorId = AGENT_ID,
    position,
}: {
    itemId: string;
    authorId?: string;
    position?: { x: number; y: number };
}): SurfaceItem {
    const original = requireItem(itemId);
    if (original.kind === 'pull-request') {
        throw new SurfaceError('Pull requests can not be duplicated.');
    }
    requireKnownPeople([authorId]);
    const copy = structuredClone(original);
    copy.id = newId(original.kind);
    copy.title = `${original.title} (copy)`;
    copy.createdById = authorId;
    if ('updatedAt' in copy) copy.updatedAt = new Date().toISOString();
    if (copy.kind === 'chat') {
        copy.messages = copy.messages.map((message) => ({
            ...message,
            id: newId('msg'),
        }));
        copy.awaitingReply = false;
    } else if (copy.kind === 'board') {
        copy.issues = copy.issues.map((issue) => ({
            ...issue,
            id: newId('issue'),
        }));
    } else if (copy.kind === 'document') {
        copy.authorId = authorId;
    }

    const { items, relations } = store();
    const arrangement = arrangementOf(original.id);
    items.push(copy);
    arrangement.stack.push(copy.id);
    const color = arrangement.colors[original.id];
    if (color) arrangement.colors[copy.id] = color;
    if (position) arrangement.positions[copy.id] = { ...position };
    for (const relation of relations.filter(
        (candidate) =>
            candidate.from === original.id || candidate.to === original.id,
    )) {
        relations.push({
            ...relation,
            id: newId('rel'),
            from: relation.from === original.id ? copy.id : relation.from,
            to: relation.to === original.id ? copy.id : relation.to,
        });
    }
    return structuredClone(copy);
}

/**
 * Adds a card the way a person does in the app: a kind, maybe a title and
 * an address, and either a spot on the surface (`position`, where they
 * were looking) or a parent card to hang from (`attachedTo`). Blank ones
 * get a starting title; a chart starts with sample numbers and a pull
 * request starts as a draft, so there's something to see.
 */
export function addCard({
    surfaceId,
    kind,
    title,
    url,
    attachedTo,
    position,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    kind: SurfaceItemKind;
    title?: string;
    url?: string;
    attachedTo?: string;
    position?: { x: number; y: number };
    authorId?: string;
}): SurfaceItem {
    requireSurface(surfaceId);
    if (attachedTo && requireItem(attachedTo).surfaceId !== surfaceId) {
        throw new SurfaceError(`"${attachedTo}" is not on this surface.`);
    }
    const named = title?.trim() || undefined;
    const needUrl = () => {
        if (!url?.trim()) throw new SurfaceError('Give it an address.');
        return url.trim();
    };
    const parent = () => {
        if (!attachedTo) {
            throw new SurfaceError(
                'Add it from the chat or document it belongs to.',
            );
        }
        return attachedTo;
    };
    let item: SurfaceItem;
    switch (kind) {
        case 'chat':
            item = createChat({
                surfaceId,
                title: named ?? 'New chat',
                authorId,
            });
            break;
        case 'note':
            item = createNote({ surfaceId, text: named ?? '', authorId });
            break;
        case 'sketch':
            item = createSketch({ surfaceId, title: named, authorId });
            break;
        case 'document':
            item = createDocument({
                surfaceId,
                title: named ?? 'Untitled document',
                blocks: [],
                authorId,
            });
            break;
        case 'board':
            item = createBoard({
                surfaceId,
                title: named ?? 'New board',
                key: boardKey(named),
                authorId,
            });
            break;
        case 'video':
            item = createVideo({
                surfaceId,
                attachedTo,
                url: needUrl(),
                title: named ?? 'Video',
                authorId,
            });
            break;
        case 'web': {
            const address = needUrl();
            item = createWebPage({
                surfaceId,
                attachedTo,
                url: address,
                title:
                    named ??
                    new URL(normalizeWebUrl(address) ?? 'https://web.page')
                        .hostname,
                authorId,
            });
            break;
        }
        case 'image':
            item = createImage({
                surfaceId,
                attachedTo,
                url: needUrl(),
                title: named ?? 'Image',
                authorId,
            });
            break;
        case 'chart':
            item = createChart({
                attachedTo: parent(),
                title: named ?? 'New chart',
                chart: 'bar',
                unit: 'count',
                caption: 'Sample numbers: ask an agent to chart real ones.',
                points: [
                    { label: 'A', value: 3 },
                    { label: 'B', value: 5 },
                    { label: 'C', value: 4 },
                ],
                authorId,
            });
            break;
        case 'pull-request':
            item = openPullRequest({
                chatId: parent(),
                title: named ?? 'New change',
                branch: `change-${crypto.randomUUID().slice(0, 6)}`,
                draft: true,
                authorId,
            });
            break;
        case 'ui':
            item = createUi({
                surfaceId,
                title: named ?? 'Surface at a glance',
                spec: STARTER_UI,
                authorId,
            });
            break;
    }
    if (position && !attachedTo) {
        requireSurface(surfaceId).arrangement.positions[item.id] = {
            ...position,
        };
    }
    return item;
}

/** A board's issue prefix from its name: its first letters, or "NEW". */
function boardKey(title: string | undefined): string {
    const letters = (title ?? '')
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z]/gi, '')[0] ?? '')
        .join('')
        .toUpperCase();
    return letters.length >= 2 ? letters.slice(0, 5) : 'NEW';
}

/** Sticks a note on a surface; `color` is from the window palette. */
export function createNote({
    surfaceId,
    text = '',
    color,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    text?: string;
    color?: WindowColor;
    authorId?: string;
}): NoteItem {
    requireSurface(surfaceId);
    requireKnownPeople([authorId]);
    const note: NoteItem = {
        kind: 'note',
        id: newId('note'),
        surfaceId,
        title: noteTitle(text),
        text,
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(note);
    if (color) requireSurface(surfaceId).arrangement.colors[note.id] = color;
    return structuredClone(note);
}

/**
 * Deletes a card for everyone, with the cards hanging under it (a chat's
 * pull requests and charts, a document's media: they hang from nothing
 * without it), and everything that points at them: links, their place in
 * the arrangement, saved views' framing, and issues' links. Documents that
 * mention a deleted card keep the mention, shown struck through. Returns
 * the ids that went, the card's first.
 */
export function deleteItem(itemId: string): string[] {
    const item = requireItem(itemId);
    const data = store();
    const gone = [item.id, ...hangingUnder(item.id, data.items)];
    const isGone = (id: string) => gone.includes(id);

    data.items = data.items.filter((candidate) => !isGone(candidate.id));
    data.relations = data.relations.filter(
        (relation) => !isGone(relation.from) && !isGone(relation.to),
    );
    const arrangement = requireSurface(item.surfaceId).arrangement;
    arrangement.stack = arrangement.stack.filter((id) => !isGone(id));
    arrangement.locked = arrangement.locked.filter((id) => !isGone(id));
    for (const id of gone) {
        delete arrangement.colors[id];
        delete arrangement.positions[id];
    }
    for (const view of data.views) {
        if (view.itemIds)
            view.itemIds = view.itemIds.filter((id) => !isGone(id));
    }
    for (const board of data.items) {
        if (board.kind !== 'board') continue;
        for (const issue of board.issues) {
            issue.links = issue.links.filter((id) => !isGone(id));
        }
    }
    return gone;
}

/**
 * Gives a card a new title (not a sticky note: its first line names it).
 * Leaves `updatedAt` alone, since that's a document's version and a new
 * title shouldn't read as someone rewriting it.
 */
export function renameItem({
    itemId,
    title,
}: {
    itemId: string;
    title: string;
}): SurfaceItem {
    const item = requireItem(itemId);
    if (!isRenamable(item)) {
        throw new SurfaceError(
            'A sticky note is named by its first line; rewrite its text instead.',
        );
    }
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > TITLE_MAX) {
        throw new SurfaceError(`A title needs 1 to ${TITLE_MAX} characters.`);
    }
    item.title = trimmed;
    return structuredClone(item);
}

/**
 * Resizes a card (chats, so far: `RESIZE_LIMITS`), clamped to its kind's
 * limits; that size becomes where it rests. `position` is its top left
 * corner afterwards, saved when given, since dragging a left or top edge
 * moves the card. Leaves `updatedAt` alone, as renaming does.
 */
export function resizeItem({
    itemId,
    size,
    position,
}: {
    itemId: string;
    size: CardSize;
    position?: { x: number; y: number };
}): SurfaceItem {
    const item = requireItem(itemId);
    if (!isResizable(item.kind) || item.kind !== 'chat') {
        throw new SurfaceError(`A ${item.kind} card can't be resized.`);
    }
    item.size = clampSize(item.kind, size);
    if (position) {
        arrangementOf(itemId).positions[itemId] = {
            x: Math.round(position.x),
            y: Math.round(position.y),
        };
    }
    return structuredClone(item);
}

/** Rewrites a note (the last writer wins: notes are quick, not documents). */
export function updateNote({
    noteId,
    text,
}: {
    noteId: string;
    text: string;
}): NoteItem {
    const note = requireItem(noteId);
    if (note.kind !== 'note') {
        throw new SurfaceError(`"${noteId}" is a ${note.kind}, not a note.`);
    }
    note.text = text;
    note.title = noteTitle(text);
    note.updatedAt = nextTimestamp(note.updatedAt);
    return structuredClone(note);
}

/** Starts a blank sketch. */
export function createSketch({
    surfaceId,
    title = 'Untitled sketch',
    strokes = [],
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    title?: string;
    strokes?: SketchStroke[];
    authorId?: string;
}): SketchItem {
    requireSurface(surfaceId);
    requireKnownPeople([authorId]);
    const sketch: SketchItem = {
        kind: 'sketch',
        id: newId('sketch'),
        surfaceId,
        title,
        strokes,
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(sketch);
    return structuredClone(sketch);
}

/**
 * A UI card a person adds by hand: this surface's numbers at a glance,
 * bound live, for an agent (or anyone) to build on.
 */
const STARTER_UI: UiItem['spec'] = {
    root: 'main',
    elements: {
        main: {
            type: 'Stack',
            props: { direction: null, gap: 'md' },
            children: ['heading', 'metrics', 'hint'],
        },
        heading: {
            type: 'Heading',
            props: { text: 'This surface', level: null },
        },
        metrics: {
            type: 'Grid',
            props: { columns: 3 },
            children: ['cards', 'issues', 'prs'],
        },
        cards: {
            type: 'Metric',
            props: {
                label: 'Cards',
                value: { $state: '/stats/cards' },
                hint: null,
            },
        },
        issues: {
            type: 'Metric',
            props: {
                label: 'Open issues',
                value: { $state: '/stats/openIssues' },
                hint: null,
            },
        },
        prs: {
            type: 'Metric',
            props: {
                label: 'Open pull requests',
                value: { $state: '/stats/openPullRequests' },
                hint: null,
            },
        },
        hint: {
            type: 'Text',
            props: {
                text: 'Ask the agent to turn this into the view you need: a triage list, a review queue, a launch tracker.',
                muted: true,
            },
        },
    },
};

function requireUiSpec(spec: unknown): UiItem['spec'] {
    const problems = uiSpecProblems(spec);
    if (problems.length > 0) {
        throw new SurfaceError(
            `That UI spec doesn't work: ${problems.slice(0, 5).join('; ')}`,
        );
    }
    return structuredClone(spec as UiItem['spec']);
}

/** Puts a UI card (a json-render spec over the UI catalog) on a surface. */
export function createUi({
    surfaceId,
    title,
    spec,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    title: string;
    spec: unknown;
    authorId?: string;
}): UiItem {
    requireSurface(surfaceId);
    requireKnownPeople([authorId]);
    const ui: UiItem = {
        kind: 'ui',
        id: newId('ui'),
        surfaceId,
        title: title.slice(0, TITLE_MAX),
        spec: requireUiSpec(spec),
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(ui);
    return structuredClone(ui);
}

/** Replaces a UI card's spec (last writer wins, like a sketch). */
export function updateUi({
    uiId,
    spec,
    title,
}: {
    uiId: string;
    spec: unknown;
    title?: string;
}): UiItem {
    const ui = requireItem(uiId);
    if (ui.kind !== 'ui') {
        throw new SurfaceError(`"${uiId}" is a ${ui.kind}, not a UI card.`);
    }
    ui.spec = requireUiSpec(spec);
    if (title) ui.title = title.slice(0, TITLE_MAX);
    ui.updatedAt = nextTimestamp(ui.updatedAt);
    return structuredClone(ui);
}

/** Replaces a sketch's strokes (the whole drawing, as the canvas holds it). */
export function updateSketch({
    sketchId,
    strokes,
}: {
    sketchId: string;
    strokes: SketchStroke[];
}): SketchItem {
    const sketch = requireItem(sketchId);
    if (sketch.kind !== 'sketch') {
        throw new SurfaceError(
            `"${sketchId}" is a ${sketch.kind}, not a sketch.`,
        );
    }
    sketch.strokes = strokes;
    sketch.updatedAt = nextTimestamp(sketch.updatedAt);
    return structuredClone(sketch);
}

/** Points a browser window somewhere else (its address bar). */
export function navigateWebPage({
    webId,
    url,
}: {
    webId: string;
    url: string;
}): WebItem {
    const item = requireItem(webId);
    if (item.kind !== 'web') {
        throw new SurfaceError(`"${webId}" is a ${item.kind}, not a web page.`);
    }
    const normalized = normalizeWebUrl(url);
    if (!normalized) {
        throw new SurfaceError(`"${url}" is not an https web address.`);
    }
    item.url = normalized;
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
}

export function createBoard({
    surfaceId,
    title,
    key,
    authorId = AGENT_ID,
}: {
    surfaceId: string;
    title: string;
    key: string;
    authorId?: string;
}): BoardItem {
    requireKnownPeople([authorId]);
    const board: BoardItem = {
        kind: 'board',
        id: newId('board'),
        surfaceId: requireSurface(surfaceId).id,
        title,
        key: key.toUpperCase(),
        issues: [],
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    addItem(board);
    return structuredClone(board);
}

/** Files an issue on a board, numbered after its highest issue. */
export function createIssue({
    boardId,
    title,
    status = 'todo',
    priority = 'none',
    assigneeId,
    links = [],
    authorId = AGENT_ID,
}: {
    boardId: string;
    title: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    assigneeId?: string;
    links?: string[];
    authorId?: string;
}): Issue {
    const board = requireBoard(boardId);
    requireKnownPeople([authorId, ...(assigneeId ? [assigneeId] : [])]);
    links.forEach(requireItem);
    const numbers = board.issues.map((existing) =>
        Number(existing.identifier.split('-').at(-1)),
    );
    const number = Math.max(0, ...numbers) + 1;
    const created: Issue = {
        id: newId('issue'),
        identifier: `${board.key}-${number}`,
        title,
        status,
        priority,
        ...(assigneeId ? { assigneeId } : {}),
        links,
        createdById: authorId,
        updatedAt: new Date().toISOString(),
    };
    board.issues.push(created);
    board.updatedAt = created.updatedAt;
    return structuredClone(created);
}

/**
 * Moves an issue (to another column and/or a position in its column), or
 * changes its priority. `index` is its place in the column, top = 0.
 */
export function updateIssue({
    boardId,
    issueId,
    status,
    priority,
    index,
    title,
    description,
    assigneeId,
}: {
    boardId: string;
    issueId: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    index?: number;
    title?: string;
    description?: string;
    /** `null` unassigns. */
    assigneeId?: string | null;
}): Issue {
    const board = requireBoard(boardId);
    const found = board.issues.find(
        (candidate) =>
            candidate.id === issueId || candidate.identifier === issueId,
    );
    if (!found) {
        throw new SurfaceError(`No issue "${issueId}" on "${board.title}".`);
    }
    if (priority) found.priority = priority;
    if (title?.trim()) found.title = title.trim();
    if (description !== undefined) found.description = description;
    if (assigneeId === null) delete found.assigneeId;
    else if (assigneeId !== undefined) {
        requireKnownPeople([assigneeId]);
        found.assigneeId = assigneeId;
    }
    found.updatedAt = new Date().toISOString();
    if (status !== undefined || index !== undefined) {
        board.issues = placeIssue(
            board.issues,
            found.id,
            status ?? found.status,
            index,
        );
    }
    board.updatedAt = found.updatedAt;
    return structuredClone(
        board.issues.find((candidate) => candidate.id === found.id)!,
    );
}

/** Adds a comment to an issue's activity. */
export function commentOnIssue({
    boardId,
    issueId,
    text,
    authorId = AGENT_ID,
}: {
    boardId: string;
    issueId: string;
    text: string;
    authorId?: string;
}): IssueComment {
    const board = requireBoard(boardId);
    const found = board.issues.find(
        (candidate) =>
            candidate.id === issueId || candidate.identifier === issueId,
    );
    if (!found) {
        throw new SurfaceError(`No issue "${issueId}" on "${board.title}".`);
    }
    requireKnownPeople([authorId]);
    const comment: IssueComment = {
        id: newId('comment'),
        authorId,
        text,
        at: new Date().toISOString(),
    };
    found.comments = [...(found.comments ?? []), comment];
    found.updatedAt = comment.at;
    board.updatedAt = comment.at;
    return structuredClone(comment);
}

/** Saves where windows were moved to (ids not on the surface are skipped). */
export function moveWindows(
    positions: Record<string, { x: number; y: number }>,
) {
    const ids = new Set(store().items.map((item) => item.id));
    for (const [id, position] of Object.entries(positions)) {
        if (ids.has(id)) {
            arrangementOf(id).positions[id] = { x: position.x, y: position.y };
        }
    }
}

/** A surface's cards as a fresh load lays them out, with what's locked. */
export function getLayout(surfaceId: string) {
    const { arrangement } = requireSurface(surfaceId);
    const items = store().items.filter((item) => item.surfaceId === surfaceId);
    const byId = new Map(items.map((item) => [item.id, item]));
    return currentLayout(items, arrangement.positions).map((spot) => {
        const item = byId.get(spot.id)!;
        const parentId = parentIdOf(item);
        return {
            id: spot.id,
            kind: spot.kind,
            title: item.title,
            x: Math.round(spot.x),
            y: Math.round(spot.y),
            width: spot.width,
            height: spot.height,
            ...(parentId && byId.has(parentId) && { hangsUnder: parentId }),
            ...(arrangement.locked.includes(spot.id) && { locked: true }),
        };
    });
}

/**
 * Lays out groups of cards on a surface (`arrangeGroups`) and saves where
 * they land, starting at `origin` (else where the cards it moves begin).
 * Open canvases slide to it (`layoutVersion`).
 */
export function arrangeCards({
    surfaceId,
    groups,
    direction,
    origin,
    gap,
    rest,
}: {
    surfaceId: string;
    groups: string[][];
    direction: ArrangeDirection;
    origin?: { x: number; y: number };
    gap?: number;
    rest?: 'append' | 'leave';
}) {
    const surface = requireSurface(surfaceId);
    const items = store().items.filter((item) => item.surfaceId === surfaceId);
    const ids = new Set(items.map((item) => item.id));
    const unknown = groups.flat().filter((id) => !ids.has(id));
    if (unknown.length > 0) {
        throw new SurfaceError(
            `Not on this surface: ${unknown.join(', ')}. See list_cards.`,
        );
    }
    const { arrangement } = surface;
    const laid = arrangeGroups(items, groups, {
        direction,
        origin: { x: 0, y: 0 },
        gap,
        locked: new Set(arrangement.locked),
        rest,
    });
    // Start where the cards it moves are now, unless told otherwise.
    const start =
        origin ??
        topLeftOf(
            currentLayout(items, arrangement.positions).filter(
                (spot) => spot.id in laid.positions,
            ),
        );
    const shift = (spot: { x: number; y: number }) => ({
        x: Math.round(spot.x + start.x),
        y: Math.round(spot.y + start.y),
    });
    for (const [id, spot] of Object.entries(laid.positions)) {
        arrangement.positions[id] = shift(spot);
    }
    arrangement.layoutVersion = (arrangement.layoutVersion ?? 0) + 1;
    return {
        moved: Object.keys(laid.positions).length,
        skipped: laid.skipped,
        groups: laid.groups.map((box) => ({ ...box, ...shift(box) })),
    };
}

/**
 * Moves one card to a spot (its top-left corner), taking whatever hangs
 * under it along. Open canvases slide to it.
 */
export function moveCard({
    itemId,
    x,
    y,
}: {
    itemId: string;
    x: number;
    y: number;
}) {
    const item = requireItem(itemId);
    const surface = requireSurface(item.surfaceId);
    const { arrangement } = surface;
    if (arrangement.locked.includes(itemId)) {
        throw new SurfaceError(`"${item.title}" is locked in place.`);
    }
    const items = store().items.filter(
        (candidate) => candidate.surfaceId === surface.id,
    );
    const now = new Map(
        currentLayout(items, arrangement.positions).map((spot) => [
            spot.id,
            spot,
        ]),
    );
    const from = now.get(itemId)!;
    const dx = x - from.x;
    const dy = y - from.y;
    for (const id of [itemId, ...hangingUnder(itemId, items)]) {
        const spot = now.get(id)!;
        arrangement.positions[id] = { x: spot.x + dx, y: spot.y + dy };
    }
    arrangement.layoutVersion = (arrangement.layoutVersion ?? 0) + 1;
    return { id: item.id, kind: item.kind, title: item.title, x, y };
}

/**
 * Arrange: lays the surface out by links (`clusterLayout`: each cluster of
 * linked cards a block around its hub, blocks packed in rows) and saves
 * every new spot, so the layout is shared and survives reloads. Open
 * canvases slide to it (`layoutVersion`). Locked cards stay put.
 */
export function arrangeByLinks(surfaceId: string) {
    const { arrangement } = requireSurface(surfaceId);
    const items = store().items.filter((item) => item.surfaceId === surfaceId);
    const ids = new Set(items.map((item) => item.id));
    const positions = clusterLayout(
        items,
        store().relations.filter(
            (relation) => ids.has(relation.from) && ids.has(relation.to),
        ),
        { locked: new Set(arrangement.locked) },
    );
    arrangement.positions = { ...arrangement.positions, ...positions };
    arrangement.layoutVersion = (arrangement.layoutVersion ?? 0) + 1;
    return positions;
}

/** Forgets moved windows, except locked ones, which stay put. */
export function resetWindowPositions(surfaceId: string) {
    const arrangement = requireSurface(surfaceId).arrangement;
    arrangement.positions = Object.fromEntries(
        Object.entries(arrangement.positions).filter(([id]) =>
            arrangement.locked.includes(id),
        ),
    );
}

/**
 * Locks a card where it is (it can't be dragged, and Arrange leaves it), or
 * unlocks it. `position` is where it is now on the canvas, saved so it
 * stays there through Arrange and reloads.
 */
export function setItemLocked(
    itemId: string,
    locked: boolean,
    position?: { x: number; y: number },
) {
    const arrangement = arrangementOf(itemId);
    arrangement.locked = arrangement.locked.filter((id) => id !== itemId);
    if (locked) {
        arrangement.locked.push(itemId);
        if (position) arrangement.positions[itemId] = { ...position };
    }
}
