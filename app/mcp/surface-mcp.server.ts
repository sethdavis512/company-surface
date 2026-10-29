import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { APP_NAME } from '~/config';
import { env } from '~/lib/env.server';
import { createSurfaceSearch } from '~/lib/search';
import {
    markdownToPortableText,
    portableTextToMarkdown,
} from '~/lib/portable-text';
import {
    ISSUE_PRIORITIES,
    ISSUE_STATUSES,
    SKETCH_COLORS,
    SKETCH_SIZE,
    RESIZE_LIMITS,
    TITLE_MAX,
    WINDOW_COLOR_NAMES,
    frameItems,
    itemPath,
    sizeOf,
    surfacePath,
    viewPath,
    type SurfaceItem,
} from '~/lib/surface';
import { sketchStrokesSchema } from '~/lib/sketch';
import { ARRANGE_DIRECTIONS } from '~/lib/arrange';
import {
    AGENT_ID,
    SurfaceError,
    allItems,
    createBoard,
    createChart,
    createVideo,
    createSpace,
    createSurface,
    getWorkspace,
    createImage,
    createNote,
    createSketch,
    updateNote,
    setItemLocked,
    unlinkCards,
    commentOnIssue,
    duplicateItem,
    renameItem,
    resizeItem,
    deleteItem,
    createWebPage,
    navigateWebPage,
    createIssue,
    updateIssue,
    appendToDocument,
    arrangeCards,
    getLayout,
    moveCard,
    createChat,
    createDocument,
    getItem,
    linkItems,
    listItems,
    listLinks,
    listPeople,
    listViews,
    openPullRequest,
    deleteView,
    postMessage,
    restackItem,
    saveView,
    setItemColor,
    setPullRequestStatus,
} from '~/models/surface.server';

/**
 * The surface's agent tools. Agents act on the same store the app shows, so
 * whatever they create or post appears on open canvases within a couple of
 * seconds (the surface route polls).
 */

const markdownSchema = z
    .string()
    .max(20000)
    .describe(
        'Document content as Markdown: paragraphs, ## and ### headings, - and 1. lists, > quotes, | pipe | tables | (a `| --- |` line under the header row), **bold**, *italic*, `code`, and [text](https://...) links. Point at other items with [text](item:<itemId>), or put a card for one on a line of its own with ![](item:<itemId>). Item ids come from list_items.',
    );

/** A document as agents read it: Markdown instead of Portable Text blocks. */
function readable(item: SurfaceItem) {
    if (item.kind !== 'document') return item;
    const { blocks, ...rest } = item;
    return { ...rest, markdown: portableTextToMarkdown(blocks) };
}

const authorSchema = z
    .string()
    .optional()
    .describe(
        `Who it is from, by person id (see list_people). Defaults to "${AGENT_ID}".`,
    );

const surfaceIdSchema = z
    .string()
    .describe('The surface it goes on (see list_spaces).');

/** A card's URL in the app (on its own surface). */
function link(itemId: string) {
    return `${env.BETTER_AUTH_BASE_URL}${itemPath(getItem(itemId).surfaceId, itemId)}`;
}

function viewLink(view: { id: string; surfaceId: string }) {
    return `${env.BETTER_AUTH_BASE_URL}${viewPath(view.surfaceId, view.id)}`;
}

function result(value: unknown) {
    return {
        content: [
            { type: 'text' as const, text: JSON.stringify(value, null, 2) },
        ],
    };
}

/** Runs a tool body, turning the store's expected errors into tool errors. */
function run(body: () => unknown) {
    try {
        return result(body());
    } catch (error) {
        if (error instanceof SurfaceError) {
            return {
                content: [{ type: 'text' as const, text: error.message }],
                isError: true,
            };
        }
        throw error;
    }
}

/**
 * Tools renamed to say "card" (the app's word for what sits on a surface),
 * by new name: the old names still work, so agents set up before keep going.
 */
const OLD_TOOL_NAMES: Record<string, string> = {
    list_cards: 'list_items',
    get_card: 'get_item',
    link_cards: 'link_items',
    duplicate_card: 'duplicate_item',
    set_card_color: 'set_window_color',
    restack_card: 'restack_window',
};

export function createSurfaceMcpServer(): McpServer {
    const server = new McpServer({
        name: APP_NAME,
        version: '0.1.0',
    });

    /** `server.registerTool`, plus the tool's old name when it has one. */
    const register = ((
        name: string,
        config: { title?: string; description?: string },
        callback: unknown,
    ) => {
        const tool = server.registerTool(
            name,
            config as never,
            callback as never,
        );
        const oldName = OLD_TOOL_NAMES[name];
        if (oldName) {
            server.registerTool(
                oldName,
                {
                    ...config,
                    title: `${config.title} (old name)`,
                    description: `The old name for ${name}, kept so existing agents keep working; use ${name}. ${config.description ?? ''}`,
                } as never,
                callback as never,
            );
        }
        return tool;
    }) as typeof server.registerTool;

    server.registerTool(
        'list_spaces',
        {
            title: 'List spaces and surfaces',
            description:
                "The workspace: every space (a group, like a team or project) with its surfaces (canvases of cards), in order, with how many cards each surface holds and of which kinds, and each surface's URL. Cards always live on one surface; most tools that add cards take its surfaceId.",
            inputSchema: {},
            annotations: { readOnlyHint: true },
        },
        () =>
            run(() =>
                getWorkspace().spaces.map((space) => ({
                    ...space,
                    surfaces: space.surfaces.map((surface) => ({
                        ...surface,
                        url: `${env.BETTER_AUTH_BASE_URL}${surfacePath(surface.id)}`,
                    })),
                })),
            ),
    );

    server.registerTool(
        'create_space',
        {
            title: 'Start a space',
            description: 'Starts an empty space to hold surfaces.',
            inputSchema: {
                name: z.string().trim().min(1).max(60),
                description: z.string().max(200).optional(),
            },
        },
        (input) => run(() => createSpace(input)),
    );

    server.registerTool(
        'create_surface',
        {
            title: 'Start a surface',
            description:
                'Starts an empty surface (a canvas for cards) in a space. Returns it with its URL.',
            inputSchema: {
                spaceId: z.string().describe('See list_spaces.'),
                name: z.string().trim().min(1).max(60),
                description: z.string().max(200).optional(),
            },
        },
        (input) =>
            run(() => {
                const surface = createSurface(input);
                return {
                    ...surface,
                    url: `${env.BETTER_AUTH_BASE_URL}${surfacePath(surface.id)}`,
                };
            }),
    );

    register(
        'list_cards',
        {
            title: 'List cards',
            description:
                "Cards (chats, documents, pull requests, charts, boards, videos, web pages, images, sticky notes, sketches) with their id, kind, title, and surface; every card in the workspace, or only one surface's with surfaceId. To find cards by what they say, use search.",
            inputSchema: {
                surfaceId: z
                    .string()
                    .optional()
                    .describe('Only this surface (see list_spaces).'),
            },
            annotations: { readOnlyHint: true },
        },
        ({ surfaceId }) => run(() => listItems(surfaceId)),
    );

    server.registerTool(
        'search',
        {
            title: 'Search the surface',
            description:
                "Finds cards by what's in them: titles, chat messages, document text, issues (by title or identifier like ATL-3), pull request summaries and branches, chart captions, web addresses, and image descriptions. Matches word prefixes and small typos; every word must match. Returns the best hit per card, best first, with a snippet; a hit inside a chat or board names the message (subId, subLabel = who sent it) or issue (subId, subLabel = its identifier).",
            inputSchema: {
                query: z.string().min(1).max(200),
                limit: z.number().int().min(1).max(50).optional(),
                surfaceId: z
                    .string()
                    .optional()
                    .describe(
                        'Only this surface; the whole workspace without it.',
                    ),
            },
            annotations: { readOnlyHint: true },
        },
        ({ query, limit, surfaceId }) =>
            run(() => {
                const people = new Map(
                    listPeople().map((person) => [person.id, person.name]),
                );
                const items = allItems().filter(
                    (item) => !surfaceId || item.surfaceId === surfaceId,
                );
                return createSurfaceSearch(items, {
                    nameOf: (id) => people.get(id),
                })
                    .search(query, limit)
                    .hits.map(({ ranges: _ranges, score: _score, ...hit }) => ({
                        ...hit,
                        url: link(hit.itemId),
                    }));
            }),
    );

    register(
        'get_card',
        {
            title: 'Get a card',
            description:
                "One card in full: a chat's participants and messages, a document's content as Markdown (links to other cards read [text](item:<id>)), and so on.",
            inputSchema: { itemId: z.string() },
            annotations: { readOnlyHint: true },
        },
        ({ itemId }) => run(() => readable(getItem(itemId))),
    );

    server.registerTool(
        'list_people',
        {
            title: 'List people',
            description:
                'Everyone who can be in a chat or author a document, by id: the people who have signed in to the app (role "Member"), then the rest of the team and the agent.',
            inputSchema: {},
            annotations: { readOnlyHint: true },
        },
        () => run(() => listPeople()),
    );

    server.registerTool(
        'create_chat',
        {
            title: 'Start a chat',
            description:
                'Starts a new chat on a surface, optionally with an opening message. Returns the chat and its URL.',
            inputSchema: {
                surfaceId: surfaceIdSchema,
                title: z.string().min(1).max(120),
                participantIds: z
                    .array(z.string())
                    .optional()
                    .describe(
                        `Person ids (see list_people). The author and "${AGENT_ID}" are always in it.`,
                    ),
                firstMessage: z.string().min(1).max(4000).optional(),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const chat = createChat(input);
                return { ...chat, url: link(chat.id) };
            }),
    );

    server.registerTool(
        'post_message',
        {
            title: 'Post a message',
            description: 'Adds a message to an existing chat.',
            inputSchema: {
                chatId: z.string(),
                text: z.string().min(1).max(4000),
                authorId: authorSchema,
            },
        },
        ({ chatId, text, authorId = AGENT_ID }) =>
            run(() => postMessage({ chatId, text, authorId })),
    );

    server.registerTool(
        'create_document',
        {
            title: 'Start a document',
            description:
                'Creates a new document on a surface. Returns the document and its URL. Item links in it must point at cards on the same surface.',
            inputSchema: {
                surfaceId: surfaceIdSchema,
                title: z.string().min(1).max(160),
                markdown: markdownSchema.optional(),
                authorId: authorSchema,
            },
        },
        ({ surfaceId, title, markdown = '', authorId }) =>
            run(() => {
                const doc = createDocument({
                    surfaceId,
                    title,
                    blocks: markdownToPortableText(markdown),
                    authorId,
                });
                return { ...readable(doc), url: link(doc.id) };
            }),
    );

    server.registerTool(
        'append_to_document',
        {
            title: 'Add to a document',
            description: 'Adds Markdown to the end of an existing document.',
            inputSchema: {
                documentId: z.string(),
                markdown: markdownSchema.min(1),
                authorId: authorSchema,
            },
        },
        ({ documentId, markdown, authorId }) =>
            run(() =>
                readable(
                    appendToDocument({
                        documentId,
                        blocks: markdownToPortableText(markdown),
                        authorId,
                    }),
                ),
            ),
    );

    register(
        'link_cards',
        {
            title: 'Relate two cards',
            description:
                'Draws a labeled relation between two cards on the surface, from one to the other (for example "discusses" or "references"). See the links already there with list_links; remove one with unlink_cards.',
            inputSchema: {
                from: z.string(),
                to: z.string(),
                label: z.string().min(1).max(40),
            },
        },
        (input) => run(() => linkItems(input)),
    );

    server.registerTool(
        'list_views',
        {
            title: 'List saved views',
            description:
                "Saved spots on a surface (a center point and zoom) that people jump between, with their URLs; every surface's, or one with surfaceId.",
            inputSchema: {
                surfaceId: z.string().optional().describe('Only this surface.'),
            },
            annotations: { readOnlyHint: true },
        },
        ({ surfaceId }) =>
            run(() =>
                listViews(surfaceId).map((view) => ({
                    ...view,
                    url: viewLink(view),
                })),
            ),
    );

    server.registerTool(
        'save_view',
        {
            title: 'Save a view',
            description:
                "Saves a spot on the canvas that shows up under Views in the app. Either frame some items (itemIds: each person's canvas fits those cards wherever they are, at its own size), or give an exact center (canvas coordinates) and zoom.",
            inputSchema: {
                surfaceId: surfaceIdSchema,
                name: z.string().trim().min(1).max(60),
                itemIds: z
                    .array(z.string())
                    .min(1)
                    .optional()
                    .describe('Items to fit in the view.'),
                center: z
                    .object({ x: z.number(), y: z.number() })
                    .optional()
                    .describe('The canvas point at the middle of the view.'),
                zoom: z
                    .number()
                    .min(0.2)
                    .max(1.5)
                    .optional()
                    .describe('1 is actual size. Used with center.'),
            },
        },
        ({ surfaceId, name, itemIds, center, zoom }) =>
            run(() => {
                let spot: {
                    center: { x: number; y: number };
                    zoom: number;
                    itemIds?: string[];
                };
                if (itemIds) {
                    // Canvases fit these windows themselves, where they are
                    // and at their own size; the frame is a fallback.
                    const framed = frameItems(
                        allItems().filter(
                            (item) => item.surfaceId === surfaceId,
                        ),
                        itemIds,
                    );
                    if (!framed) {
                        throw new SurfaceError(
                            'None of those itemIds are on that surface.',
                        );
                    }
                    spot = { ...framed, itemIds };
                } else if (center) {
                    spot = { center, zoom: zoom ?? 1 };
                } else {
                    throw new SurfaceError(
                        'Give itemIds to frame, or a center (and zoom).',
                    );
                }
                const view = saveView({ surfaceId, name, ...spot });
                return { ...view, url: viewLink(view) };
            }),
    );

    server.registerTool(
        'delete_view',
        {
            title: 'Delete a view',
            description: 'Removes a saved view.',
            inputSchema: { viewId: z.string() },
            annotations: { destructiveHint: true },
        },
        ({ viewId }) =>
            run(() => {
                deleteView(viewId);
                return { deleted: viewId };
            }),
    );

    register(
        'set_card_color',
        {
            title: 'Color a card',
            description:
                "Sets a card's border color on the surface, or clears it with null.",
            inputSchema: {
                itemId: z.string(),
                color: z
                    .enum(WINDOW_COLOR_NAMES)
                    .nullable()
                    .describe('null goes back to the default border.'),
            },
            annotations: { idempotentHint: true },
        },
        ({ itemId, color }) =>
            run(() => {
                setItemColor(itemId, color);
                return { itemId, color };
            }),
    );

    register(
        'restack_card',
        {
            title: 'Bring a card forward or back',
            description:
                'Brings a card to the front of the surface, or sends it to the back. Returns the order, bottom to top.',
            inputSchema: {
                itemId: z.string(),
                to: z.enum(['front', 'back']),
            },
            annotations: { idempotentHint: true },
        },
        ({ itemId, to }) => run(() => ({ stack: restackItem(itemId, to) })),
    );

    server.registerTool(
        'get_layout',
        {
            title: 'Read the layout',
            description:
                "Where every card sits on the surface: x, y (top-left, in canvas pixels), width, height, what it hangs under, and whether it's locked. Read it before arranging or moving cards.",
            inputSchema: { surfaceId: surfaceIdSchema },
            annotations: { readOnlyHint: true },
        },
        ({ surfaceId }) => run(() => getLayout(surfaceId)),
    );

    server.registerTool(
        'arrange_cards',
        {
            title: 'Arrange cards',
            description:
                'Lays cards out in groups so the surface reads at a glance: each group a column of cards (groups side by side, left to right) or a row (groups top to bottom). Group what belongs together (a chat with what it produced, a plan with its board, references with each other) and order groups the way the work flows. To title a group, add a sticky note and put it first. Cards hanging under another (charts, pull requests, pages, videos, images) travel with it; locked cards stay put. Cards no group names go in a last group unless rest is "leave". Everyone\'s canvas slides to the new layout.',
            inputSchema: {
                surfaceId: surfaceIdSchema,
                groups: z
                    .array(z.array(z.string()).min(1))
                    .min(1)
                    .max(20)
                    .describe('Card ids, one list per group, in order.'),
                direction: z.enum(ARRANGE_DIRECTIONS),
                origin: z
                    .object({ x: z.number(), y: z.number() })
                    .optional()
                    .describe(
                        'Top-left of the layout; defaults to where the cards it moves start.',
                    ),
                gap: z
                    .number()
                    .min(0)
                    .max(400)
                    .optional()
                    .describe(
                        'Pixels between cards in a group (48 by default).',
                    ),
                rest: z.enum(['append', 'leave']).optional(),
            },
        },
        (input) => run(() => arrangeCards(input)),
    );

    server.registerTool(
        'move_card',
        {
            title: 'Move a card',
            description:
                'Moves one card so its top-left corner is at x, y (canvas pixels; see get_layout for sizes), taking what hangs under it along.',
            inputSchema: {
                itemId: z.string(),
                x: z.number().finite(),
                y: z.number().finite(),
            },
        },
        (input) => run(() => moveCard(input)),
    );

    server.registerTool(
        'open_pull_request',
        {
            title: 'Open a pull request from a chat',
            description:
                'Opens a (mock) pull request for a code change a chat produced. It hangs under the chat on the canvas, linked as "opened", and the chat gets a message about it. Checks start pending.',
            inputSchema: {
                chatId: z.string().describe('The chat the change came from.'),
                title: z.string().min(1).max(160),
                branch: z
                    .string()
                    .min(1)
                    .max(120)
                    .describe('The branch with the change, e.g. "atlas/sso".'),
                base: z.string().min(1).max(120).optional(),
                summary: z.string().max(1000).optional(),
                files: z
                    .array(
                        z.object({
                            path: z.string().min(1),
                            additions: z.number().int().min(0),
                            deletions: z.number().int().min(0),
                        }),
                    )
                    .optional()
                    .describe('Files the change touches, with line counts.'),
                draft: z.boolean().optional(),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const pr = openPullRequest(input);
                return { ...pr, url: link(pr.id) };
            }),
    );

    server.registerTool(
        'set_pull_request_status',
        {
            title: 'Move a pull request along',
            description:
                'Sets a pull request to draft, open (ready for review), merged, or closed. Merging passes any pending checks.',
            inputSchema: {
                pullRequestId: z.string(),
                status: z.enum(['draft', 'open', 'merged', 'closed']),
            },
            annotations: { idempotentHint: true },
        },
        ({ pullRequestId, status }) =>
            run(() => setPullRequestStatus(pullRequestId, status)),
    );

    server.registerTool(
        'create_chart',
        {
            title: 'Chart something',
            description:
                'Adds a small line or bar chart that hangs under the chat or document it explains, linked as "charted". Labels run along the x axis; values go up the y axis.',
            inputSchema: {
                attachedTo: z
                    .string()
                    .describe('The chat or document the chart explains.'),
                title: z.string().min(1).max(80),
                chart: z.enum(['line', 'bar']),
                unit: z
                    .string()
                    .min(1)
                    .max(30)
                    .describe('What the values count, e.g. "signups".'),
                caption: z.string().max(200).optional(),
                points: z
                    .array(
                        z.object({
                            label: z.string().min(1).max(20),
                            value: z.number().finite(),
                        }),
                    )
                    .min(2)
                    .max(24),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const chart = createChart(input);
                return { ...chart, url: link(chart.id) };
            }),
    );

    server.registerTool(
        'add_video',
        {
            title: 'Add a YouTube video',
            description:
                'Adds a YouTube video that plays in its own card. Takes any YouTube link (watch, youtu.be, shorts, embed) or a video id. With attachedTo, it hangs under that chat or document, linked as "video"; otherwise it joins the main row.',
            inputSchema: {
                url: z.string().min(1).max(500),
                title: z.string().min(1).max(120),
                surfaceId: z
                    .string()
                    .optional()
                    .describe(
                        "The surface it goes on (see list_spaces); not needed with attachedTo, which puts it on its parent's surface.",
                    ),
                attachedTo: z
                    .string()
                    .optional()
                    .describe('A chat or document the video belongs to.'),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const video = createVideo(input);
                return { ...video, url: link(video.id) };
            }),
    );

    register(
        'duplicate_card',
        {
            title: 'Duplicate a card',
            description:
                'Copies a chat, document, chart, board, video, web page, or image: "(copy)" after the title, its border color, and the same relations (a copy of a hanging card hangs under the same parent). Pull requests can not be duplicated.',
            inputSchema: { itemId: z.string(), authorId: authorSchema },
        },
        ({ itemId, authorId = AGENT_ID }) =>
            run(() => {
                const copy = duplicateItem({ itemId, authorId });
                return {
                    id: copy.id,
                    kind: copy.kind,
                    title: copy.title,
                    link: link(copy.id),
                };
            }),
    );

    server.registerTool(
        'delete_card',
        {
            title: 'Delete a card',
            description:
                "Deletes a card for everyone, with the cards hanging under it (a chat's pull requests and charts, attached media), and their links. It can not be undone, so only delete what you were asked to, or what you made by mistake. Documents that mention a deleted card keep the mention, struck through.",
            inputSchema: { itemId: z.string() },
            annotations: { destructiveHint: true },
        },
        ({ itemId }) => run(() => ({ deleted: deleteItem(itemId) })),
    );

    server.registerTool(
        'rename_card',
        {
            title: 'Rename a card',
            description:
                'Gives a card a new title. Sticky notes are named by their first line, so rewrite one with update_note instead.',
            inputSchema: {
                itemId: z.string(),
                title: z.string().min(1).max(TITLE_MAX),
            },
        },
        (input) =>
            run(() => {
                const item = renameItem(input);
                return { id: item.id, kind: item.kind, title: item.title };
            }),
    );

    server.registerTool(
        'resize_card',
        {
            title: 'Resize a card',
            description: `Sets a card's size in px; it rests at that size (Arrange and get_layout use it). Only chats resize, from ${RESIZE_LIMITS.chat.min.width}x${RESIZE_LIMITS.chat.min.height} (their usual size) to ${RESIZE_LIMITS.chat.max.width}x${RESIZE_LIMITS.chat.max.height}; sizes outside that are clamped. Its top left corner stays put.`,
            inputSchema: {
                itemId: z.string(),
                width: z.number().positive(),
                height: z.number().positive(),
            },
        },
        ({ itemId, width, height }) =>
            run(() => {
                const item = resizeItem({ itemId, size: { width, height } });
                return { id: item.id, kind: item.kind, ...sizeOf(item) };
            }),
    );

    server.registerTool(
        'comment_on_issue',
        {
            title: 'Comment on an issue',
            description:
                "Adds a comment to an issue's activity (shown in its detail view on the board).",
            inputSchema: {
                boardId: z.string(),
                issueId: z
                    .string()
                    .describe('Its id or identifier, like DSN-1.'),
                text: z.string().min(1).max(4000),
                authorId: authorSchema,
            },
        },
        (input) => run(() => commentOnIssue(input)),
    );

    server.registerTool(
        'list_links',
        {
            title: 'List links',
            description:
                'Every link (line on the canvas) between cards on a surface: its id, the cards it runs from and to (with their titles), and its label. Remove links with unlink_cards.',
            inputSchema: { surfaceId: surfaceIdSchema },
            annotations: { readOnlyHint: true },
        },
        ({ surfaceId }) => run(() => listLinks(surfaceId)),
    );

    server.registerTool(
        'unlink_cards',
        {
            title: 'Unrelate two cards',
            description:
                'Removes the links (lines on the canvas) between two cards, either way round. To remove several, find them with list_links and call this once per pair. People can also drag links between cards and remove them by right-clicking.',
            inputSchema: { from: z.string(), to: z.string() },
        },
        (input) => run(() => ({ removed: unlinkCards(input) })),
    );

    server.registerTool(
        'lock_card',
        {
            title: 'Lock a card in place',
            description:
                "Locks a card where it is on its surface (people can't drag it, and Arrange leaves it), or unlocks it.",
            inputSchema: { itemId: z.string(), locked: z.boolean() },
        },
        ({ itemId, locked }) =>
            run(() => {
                setItemLocked(itemId, locked);
                return { itemId, locked };
            }),
    );

    server.registerTool(
        'add_note',
        {
            title: 'Stick a note',
            description:
                'Sticks a short note on a surface (a colored square, like a sticky note): an idea, a reminder, a retro point. Its first line names it.',
            inputSchema: {
                surfaceId: surfaceIdSchema,
                text: z.string().min(1).max(4000),
                color: z
                    .enum(WINDOW_COLOR_NAMES)
                    .optional()
                    .describe('Defaults to amber.'),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const note = createNote(input);
                return { ...note, url: link(note.id) };
            }),
    );

    server.registerTool(
        'add_sketch',
        {
            title: 'Start a sketch',
            description: `Adds a sketch card (an MS Paint style drawing people draw on with a pencil, eraser and Paint's sixteen colors). Optionally draw strokes: each is a color from ${SKETCH_COLORS.join(', ')}, a brush width (3 to 14 reads well; the ink swells and tapers around it like a pen; white is the eraser), and points as a flat [x, y, x, y, ...] list on a ${SKETCH_SIZE.width}x${SKETCH_SIZE.height} paper, origin top left. get_card returns a sketch's strokes.`,
            inputSchema: {
                surfaceId: surfaceIdSchema,
                title: z.string().min(1).max(120).optional(),
                strokes: sketchStrokesSchema.optional(),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const sketch = createSketch(input);
                return {
                    id: sketch.id,
                    title: sketch.title,
                    strokes: sketch.strokes.length,
                    url: link(sketch.id),
                };
            }),
    );

    server.registerTool(
        'update_note',
        {
            title: 'Rewrite a note',
            description: "Replaces a sticky note's text.",
            inputSchema: {
                noteId: z.string(),
                text: z.string().max(4000),
            },
        },
        (input) => run(() => updateNote(input)),
    );

    server.registerTool(
        'add_image',
        {
            title: 'Add an image or GIF',
            description:
                'Shows a picture (photo, diagram, screenshot, or animated GIF) from an https address in its own card. A .gif address is marked animated unless you say otherwise. With attachedTo, it hangs under that chat or document, linked as "image"; otherwise it joins the main row.',
            inputSchema: {
                url: z.string().min(1).max(2000),
                title: z.string().min(1).max(120),
                alt: z
                    .string()
                    .max(300)
                    .optional()
                    .describe('What the picture shows, for screen readers.'),
                animated: z.boolean().optional(),
                surfaceId: z
                    .string()
                    .optional()
                    .describe(
                        "The surface it goes on (see list_spaces); not needed with attachedTo, which puts it on its parent's surface.",
                    ),
                attachedTo: z
                    .string()
                    .optional()
                    .describe('A chat or document the image belongs to.'),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const image = createImage(input);
                return { ...image, url: link(image.id) };
            }),
    );

    server.registerTool(
        'add_web_page',
        {
            title: 'Add a web page',
            description:
                'Opens an https web page in a browser-like card on the surface. Some sites refuse to be embedded and show blank; people can still open them in a new tab. With attachedTo, it hangs under that chat or document, linked as "references"; otherwise it joins the main row.',
            inputSchema: {
                url: z
                    .string()
                    .min(1)
                    .max(2000)
                    .describe(
                        'An https address; "example.com" gets https:// added.',
                    ),
                title: z.string().min(1).max(120),
                surfaceId: z
                    .string()
                    .optional()
                    .describe(
                        "The surface it goes on (see list_spaces); not needed with attachedTo, which puts it on its parent's surface.",
                    ),
                attachedTo: z
                    .string()
                    .optional()
                    .describe('A chat or document the page belongs to.'),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const page = createWebPage(input);
                return { ...page, link: link(page.id) };
            }),
    );

    server.registerTool(
        'navigate_web_page',
        {
            title: 'Point a web page somewhere else',
            description:
                'Changes the address a web page card shows (everyone sees the new page). https only.',
            inputSchema: {
                webId: z.string(),
                url: z.string().min(1).max(2000),
            },
        },
        (input) => run(() => navigateWebPage(input)),
    );

    server.registerTool(
        'create_board',
        {
            title: 'Start an issue board',
            description:
                'Starts an issue board on the canvas, like a Linear project: issues in Backlog, Todo, In Progress, In Review, and Done columns. The key prefixes issue identifiers ("ATL" makes "ATL-1").',
            inputSchema: {
                surfaceId: surfaceIdSchema,
                title: z.string().min(1).max(80),
                key: z
                    .string()
                    .regex(/^[A-Za-z]{2,5}$/)
                    .describe('2 to 5 letters, e.g. "ATL".'),
                authorId: authorSchema,
            },
        },
        (input) =>
            run(() => {
                const board = createBoard(input);
                return { ...board, url: link(board.id) };
            }),
    );

    server.registerTool(
        'create_issue',
        {
            title: 'File an issue',
            description:
                'Files an issue on a board. Link it to the chats, documents, or pull requests it is about so people can jump between them.',
            inputSchema: {
                boardId: z.string(),
                title: z.string().min(1).max(200),
                status: z.enum(ISSUE_STATUSES).optional(),
                priority: z.enum(ISSUE_PRIORITIES).optional(),
                assigneeId: z
                    .string()
                    .optional()
                    .describe('A person id (see list_people).'),
                links: z
                    .array(z.string())
                    .optional()
                    .describe('Item ids this issue is about.'),
                authorId: authorSchema,
            },
        },
        (input) => run(() => createIssue(input)),
    );

    server.registerTool(
        'update_issue',
        {
            title: 'Move or reprioritize an issue',
            description:
                'Moves an issue to another status column and/or position in its column, and/or changes its priority. Takes the issue id or its identifier ("ATL-14").',
            inputSchema: {
                boardId: z.string(),
                issueId: z.string(),
                status: z.enum(ISSUE_STATUSES).optional(),
                priority: z.enum(ISSUE_PRIORITIES).optional(),
                title: z.string().min(1).max(200).optional(),
                description: z
                    .string()
                    .max(10000)
                    .optional()
                    .describe('Replaces the description (plain text).'),
                assigneeId: z
                    .string()
                    .nullable()
                    .optional()
                    .describe('A person id (see list_people); null unassigns.'),
                index: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe(
                        'Position in its column, top = 0. Left out when moving columns, it goes to the bottom.',
                    ),
            },
            annotations: { idempotentHint: true },
        },
        (input) => run(() => updateIssue(input)),
    );

    return server;
}
