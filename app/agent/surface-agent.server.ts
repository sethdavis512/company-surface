import { createAnthropic } from '@ai-sdk/anthropic';
import {
    ToolLoopAgent,
    stepCountIs,
    tool,
    type InferAgentUIMessage,
    type UIMessage,
} from 'ai';
import { z } from 'zod';
import { env } from '~/lib/env.server';
import {
    markdownToPortableText,
    portableTextToMarkdown,
} from '~/lib/portable-text';
import { createSurfaceSearch } from '~/lib/search';
import { ARRANGE_DIRECTIONS } from '~/lib/arrange';
import { sketchStrokesSchema } from '~/lib/sketch';
import {
    AGENT_ID,
    ISSUE_PRIORITIES,
    ISSUE_STATUSES,
    SKETCH_COLORS,
    SKETCH_SIZE,
    TITLE_MAX,
    WINDOW_COLOR_NAMES,
    type ChatItem,
    type SurfaceItem,
} from '~/lib/surface';
import {
    SurfaceError,
    allItems,
    appendToDocument,
    arrangeCards,
    createBoard,
    createChart,
    createDocument,
    createImage,
    createIssue,
    createNote,
    createSketch,
    createVideo,
    createWebPage,
    getItem,
    getLayout,
    linkItems,
    listPeople,
    moveCard,
    openPullRequest,
    renameItem,
    setItemColor,
    updateIssue,
} from '~/models/surface.server';
import { markChanged } from '~/models/surface-events.server';

/**
 * The live agent behind agent chats (`isAgentChat`): Claude, through the AI
 * SDK, with tools that act on the chat's own surface. Whatever it makes
 * lands on the canvas like anything an MCP agent makes, and its replies are
 * saved in the chat with their tool calls (`parts`), so the transcript
 * survives reloads and other tabs see it.
 */

export const AGENT_MODEL = 'claude-sonnet-5-5';

/** Bounds on one turn: tool-call rounds and words. */
export const AGENT_LIMITS = {
    steps: 12,
    maxOutputTokens: 4096,
    /** Earlier messages the agent reads, newest last. */
    history: 40,
} as const;

/** A card a tool made or changed, as the chat shows it. */
export type CardRef = { id: string; kind: SurfaceItem['kind']; title: string };

function ref(item: SurfaceItem): CardRef {
    return { id: item.id, kind: item.kind, title: item.title };
}

const markdownSchema = z
    .string()
    .max(20000)
    .describe(
        'Markdown: paragraphs, ## and ### headings, - and 1. lists, > quotes, **bold**, *italic*, `code`, [text](https://...) links. Point at another card with [text](item:<cardId>), or put a card for one on a line of its own with ![](item:<cardId>).',
    );

const attachedToSchema = z
    .string()
    .optional()
    .describe(
        'A chat or document on this surface to hang it under. Defaults to this chat.',
    );

/** Tools scoped to one chat and the surface it's on. */
export function surfaceTools({
    surfaceId,
    chatId,
}: {
    surfaceId: string;
    chatId: string;
}) {
    /** A card on this surface; the agent never reaches into others. */
    function onSurface(itemId: string): SurfaceItem {
        const item = getItem(itemId);
        if (item.surfaceId !== surfaceId) {
            throw new SurfaceError(
                `"${itemId}" is on another surface; you can only work on this one.`,
            );
        }
        return item;
    }

    /** Placed cards get a "made" link from this chat, so you can see where they came from. */
    function madeHere<T extends SurfaceItem>(item: T): CardRef {
        linkItems({ from: chatId, to: item.id, label: 'made' });
        return ref(item);
    }

    function boardOf(boardId: string) {
        const board = onSurface(boardId);
        if (board.kind !== 'board') {
            throw new SurfaceError(
                `"${boardId}" is a ${board.kind}, not a board.`,
            );
        }
        return board;
    }

    return {
        list_cards: tool({
            description:
                'Every card on this surface: id, kind, and title. Call it before referring to cards you have not seen this turn.',
            inputSchema: z.object({}),
            execute: () => ({
                cards: allItems()
                    .filter((item) => item.surfaceId === surfaceId)
                    .map(ref),
            }),
        }),
        read_card: tool({
            description:
                "One card in full: a document's Markdown, a chat's recent messages, a board's issues, a chart's numbers, and so on.",
            inputSchema: z.object({ cardId: z.string() }),
            execute: ({ cardId }) => readable(onSurface(cardId)),
        }),
        search: tool({
            description:
                "Finds cards on this surface by what's in them (titles, messages, document text, issues, captions). Every word must match; prefixes and small typos are fine.",
            inputSchema: z.object({
                query: z.string().min(1).max(200),
            }),
            execute: ({ query }) => {
                const people = new Map(
                    listPeople().map((person) => [person.id, person.name]),
                );
                const items = allItems().filter(
                    (item) => item.surfaceId === surfaceId,
                );
                const { hits } = createSurfaceSearch(items, {
                    nameOf: (id) => people.get(id),
                }).search(query, 10);
                return {
                    hits: hits.map(({ itemId, kind, title, snippet }) => ({
                        id: itemId,
                        kind,
                        title,
                        snippet,
                    })),
                };
            },
        }),
        create_document: tool({
            description:
                'Writes a new document card on the surface. Use it for anything longer than a couple of paragraphs: briefs, plans, notes, specs, summaries.',
            inputSchema: z.object({
                title: z.string().min(1).max(160),
                markdown: markdownSchema,
            }),
            execute: ({ title, markdown }) =>
                madeHere(
                    createDocument({
                        surfaceId,
                        title,
                        blocks: markdownToPortableText(markdown),
                    }),
                ),
        }),
        append_to_document: tool({
            description: 'Adds Markdown to the end of a document.',
            inputSchema: z.object({
                documentId: z.string(),
                markdown: markdownSchema.min(1),
            }),
            execute: ({ documentId, markdown }) => {
                onSurface(documentId);
                return ref(
                    appendToDocument({
                        documentId,
                        blocks: markdownToPortableText(markdown),
                    }),
                );
            },
        }),
        create_chart: tool({
            description:
                'A small line or bar chart, hanging under this chat (or the document it explains). Labels run along the x axis; values go up the y axis.',
            inputSchema: z.object({
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
                attachedTo: attachedToSchema,
            }),
            execute: ({ attachedTo = chatId, ...input }) => {
                onSurface(attachedTo);
                return ref(createChart({ ...input, attachedTo }));
            },
        }),
        create_board: tool({
            description:
                'Starts an issue board (like a Linear project) with status columns. Add issues with create_issue.',
            inputSchema: z.object({
                title: z.string().min(1).max(80),
                key: z
                    .string()
                    .regex(/^[A-Z]{2,5}$/)
                    .describe(
                        'Issue prefix, 2 to 5 capital letters, e.g. "WEB".',
                    ),
            }),
            execute: ({ title, key }) =>
                madeHere(createBoard({ surfaceId, title, key })),
        }),
        create_issue: tool({
            description: 'Files an issue on a board.',
            inputSchema: z.object({
                boardId: z.string(),
                title: z.string().min(1).max(160),
                description: z.string().max(4000).optional(),
                status: z.enum(ISSUE_STATUSES).optional(),
                priority: z.enum(ISSUE_PRIORITIES).optional(),
                assigneeId: z
                    .string()
                    .optional()
                    .describe('A person id: me, maya, dev, rosa, or agent.'),
            }),
            execute: ({ boardId, description, ...input }) => {
                boardOf(boardId);
                const issue = createIssue({ boardId, ...input });
                if (description) {
                    updateIssue({ boardId, issueId: issue.id, description });
                }
                return {
                    ...ref(getItem(boardId)),
                    issue: { identifier: issue.identifier, title: issue.title },
                };
            },
        }),
        update_issue: tool({
            description:
                'Changes an issue: move it to another status, reprioritize, retitle, describe, or (re)assign it (null unassigns).',
            inputSchema: z.object({
                boardId: z.string(),
                issue: z
                    .string()
                    .describe('The issue id or identifier, e.g. "WEB-3".'),
                status: z.enum(ISSUE_STATUSES).optional(),
                priority: z.enum(ISSUE_PRIORITIES).optional(),
                title: z.string().min(1).max(160).optional(),
                description: z.string().max(4000).optional(),
                assigneeId: z.string().nullable().optional(),
            }),
            execute: ({ boardId, issue, ...changes }) => {
                const board = boardOf(boardId);
                const found = board.issues.find(
                    (candidate) =>
                        candidate.id === issue ||
                        candidate.identifier === issue,
                );
                if (!found) {
                    throw new SurfaceError(
                        `No issue "${issue}" on that board.`,
                    );
                }
                updateIssue({ boardId, issueId: found.id, ...changes });
                return {
                    ...ref(getItem(boardId)),
                    issue: { identifier: found.identifier, title: found.title },
                };
            },
        }),
        add_note: tool({
            description:
                'Pins a sticky note: a short thought, reminder, or idea. Its first line is its title.',
            inputSchema: z.object({
                text: z.string().min(1).max(500),
                color: z.enum(WINDOW_COLOR_NAMES).optional(),
            }),
            execute: (input) => madeHere(createNote({ surfaceId, ...input })),
        }),
        add_sketch: tool({
            description: `Draws a sketch, MS Paint style, on a ${SKETCH_SIZE.width}x${SKETCH_SIZE.height} white paper (origin top left). Each stroke is a color (${SKETCH_COLORS.join(', ')}), a brush size (2 to 24), and points as a flat [x1, y1, x2, y2, ...] list. Keep drawings simple: a few dozen strokes at most.`,
            inputSchema: z.object({
                title: z.string().min(1).max(TITLE_MAX),
                strokes: sketchStrokesSchema.max(80),
            }),
            execute: (input) => madeHere(createSketch({ surfaceId, ...input })),
        }),
        add_web_page: tool({
            description:
                'Opens a web page (https) in a card, hanging under this chat. Many sites refuse to be framed; prefer docs, wikis, and blogs.',
            inputSchema: z.object({
                url: z.string().url(),
                title: z.string().min(1).max(120),
                attachedTo: attachedToSchema,
            }),
            execute: ({ attachedTo = chatId, ...input }) => {
                onSurface(attachedTo);
                return ref(createWebPage({ ...input, attachedTo }));
            },
        }),
        add_video: tool({
            description:
                'Adds a YouTube video (any YouTube link or a video id) that plays in its own card, hanging under this chat. Only use videos you are confident exist.',
            inputSchema: z.object({
                url: z.string().min(1).max(500),
                title: z.string().min(1).max(120),
                attachedTo: attachedToSchema,
            }),
            execute: ({ attachedTo = chatId, ...input }) => {
                onSurface(attachedTo);
                return ref(createVideo({ ...input, attachedTo }));
            },
        }),
        add_image: tool({
            description:
                'Adds an image or GIF from an https address, hanging under this chat. Only use addresses you are confident exist (Wikimedia Commons upload.wikimedia.org files are a good source).',
            inputSchema: z.object({
                url: z.string().url(),
                title: z.string().min(1).max(120),
                alt: z.string().max(300).describe('What the picture shows.'),
                attachedTo: attachedToSchema,
            }),
            execute: ({ attachedTo = chatId, ...input }) => {
                onSurface(attachedTo);
                return ref(createImage({ ...input, attachedTo }));
            },
        }),
        open_pull_request: tool({
            description:
                'Opens a (mock) pull request for a code change worked out in this chat. It hangs under the chat.',
            inputSchema: z.object({
                title: z.string().min(1).max(160),
                branch: z.string().min(1).max(120),
                summary: z.string().max(1000).optional(),
                files: z
                    .array(
                        z.object({
                            path: z.string().min(1),
                            additions: z.number().int().min(0),
                            deletions: z.number().int().min(0),
                        }),
                    )
                    .max(30)
                    .optional(),
                draft: z.boolean().optional(),
            }),
            execute: (input) => ref(openPullRequest({ chatId, ...input })),
        }),
        get_layout: tool({
            description:
                "Where every card sits on the surface: x, y (top-left, in canvas pixels), width, height, what it hangs under, and whether it's locked. Read it before arranging or moving cards.",
            inputSchema: z.object({}),
            execute: () => ({ cards: getLayout(surfaceId) }),
        }),
        arrange_cards: tool({
            description:
                'Lays cards out in groups so the surface reads at a glance: each group a column of cards (groups side by side, left to right) or a row (groups top to bottom). Group what belongs together (a chat with what it produced, a plan with its board, references with each other) and order groups the way the work flows. To title a group, add a sticky note and put it first. Cards hanging under another (charts, pull requests, pages, videos, images) travel with it; locked cards stay put. Cards no group names go in a last group unless rest is "leave". Everyone\'s canvas slides to the new layout.',
            inputSchema: z.object({
                groups: z
                    .array(z.array(z.string()).min(1))
                    .min(1)
                    .max(20)
                    .describe('Card ids, one list per group, in order.'),
                direction: z.enum(ARRANGE_DIRECTIONS),
                rest: z.enum(['append', 'leave']).optional(),
            }),
            execute: (input) => arrangeCards({ surfaceId, ...input }),
        }),
        move_card: tool({
            description:
                'Moves one card so its top-left corner is at x, y (canvas pixels; see get_layout for sizes), taking what hangs under it along.',
            inputSchema: z.object({
                cardId: z.string(),
                x: z.number().finite(),
                y: z.number().finite(),
            }),
            execute: ({ cardId, x, y }) => {
                onSurface(cardId);
                return moveCard({ itemId: cardId, x, y });
            },
        }),
        link_cards: tool({
            description:
                'Draws a labeled link from one card on this surface to another, e.g. "references" or "next".',
            inputSchema: z.object({
                from: z.string(),
                to: z.string(),
                label: z.string().min(1).max(40),
            }),
            execute: ({ from, to, label }) => {
                onSurface(from);
                onSurface(to);
                linkItems({ from, to, label });
                return {
                    from: ref(getItem(from)),
                    to: ref(getItem(to)),
                    label,
                };
            },
        }),
        rename_card: tool({
            description: 'Gives a card (not a sticky note) a new title.',
            inputSchema: z.object({
                cardId: z.string(),
                title: z.string().min(1).max(TITLE_MAX),
            }),
            execute: ({ cardId, title }) => {
                onSurface(cardId);
                renameItem({ itemId: cardId, title });
                return ref(getItem(cardId));
            },
        }),
        set_card_color: tool({
            description:
                "Sets a card's border color (a sticky note's fill), or clears it with null.",
            inputSchema: z.object({
                cardId: z.string(),
                color: z.enum(WINDOW_COLOR_NAMES).nullable(),
            }),
            execute: ({ cardId, color }) => {
                onSurface(cardId);
                setItemColor(cardId, color);
                return ref(getItem(cardId));
            },
        }),
    };
}

/** A card as the agent reads it: documents in Markdown, chats trimmed. */
function readable(item: SurfaceItem) {
    switch (item.kind) {
        case 'document': {
            const { blocks, ...rest } = item;
            return { ...rest, markdown: portableTextToMarkdown(blocks) };
        }
        case 'chat':
            return {
                ...item,
                messages: item.messages
                    .slice(-AGENT_LIMITS.history)
                    .map(({ authorId, text }) => ({ authorId, text })),
            };
        case 'sketch':
            return { ...item, strokes: `${item.strokes.length} strokes` };
        default:
            return item;
    }
}

function instructions(chat: ChatItem): string {
    const cards = allItems()
        .filter((item) => item.surfaceId === chat.surfaceId)
        .slice(0, 80)
        .map((item) => `- ${item.id} (${item.kind}): ${item.title}`)
        .join('\n');
    return `You are Surface Agent, working with a teammate in the chat "${chat.title}" (id ${chat.id}) on a shared canvas of cards. Cards are chats, documents, charts, issue boards, sticky notes, sketches, web pages, videos, images, and pull requests.

Make things, don't just describe them: when the teammate asks for a plan, a summary, notes, numbers, tasks, a diagram, or references, call the tools so the work lands on the canvas as cards, then reply briefly with what you made. Long writing belongs in a document, not the chat. Several cards in one turn are fine when the request calls for them (a board and its issues, a doc and its chart). When the canvas gets busy, or when asked to tidy or organize it, read get_layout and arrange_cards into groups that make sense together.

Replies are short chat messages in Markdown. Mention a card you made or used as [its title](item:<cardId>) so it shows as a chip. Ask a quick question when a request is truly ambiguous; otherwise make reasonable choices and say what you chose.

Today is ${new Date().toDateString()}. People: me (your teammate, signed in), maya (Head of Product), dev (Engineering Lead), rosa (Customer Success), agent (you).

Cards on this surface now:
${cards || '(none yet besides this chat)'}`;
}

export function createSurfaceAgent(chat: ChatItem) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return new ToolLoopAgent({
        model: anthropic(AGENT_MODEL),
        instructions: instructions(chat),
        tools: surfaceTools({ surfaceId: chat.surfaceId, chatId: chat.id }),
        stopWhen: stepCountIs(AGENT_LIMITS.steps),
        maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
        // Cards its tools made or moved reach every open canvas as it goes.
        onStepFinish: () => markChanged(),
    });
}

export type SurfaceAgentUIMessage = InferAgentUIMessage<
    ReturnType<typeof createSurfaceAgent>
>;

/**
 * The chat so far as the agent reads it: its own replies (with their tool
 * calls) as the assistant, everyone else as the user, each line named,
 * since several people can share one agent chat.
 */
export function chatHistory(chat: ChatItem): UIMessage[] {
    const names = new Map(
        listPeople().map((person) => [person.id, person.name]),
    );
    return chat.messages.slice(-AGENT_LIMITS.history).map((message) =>
        message.authorId === AGENT_ID
            ? {
                  id: message.id,
                  role: 'assistant',
                  parts: message.parts ?? [
                      { type: 'text', text: message.text },
                  ],
              }
            : {
                  id: message.id,
                  role: 'user',
                  parts: [
                      {
                          type: 'text',
                          text: `${names.get(message.authorId) ?? message.authorId}: ${message.text}`,
                      },
                  ],
              },
    );
}

/** The words of a reply, for search and anything that shows text alone. */
export function replyText(message: UIMessage): string {
    return message.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n\n')
        .trim();
}
