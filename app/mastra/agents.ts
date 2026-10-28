import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';

import { env } from '~/lib/env.server';
import { onShutdown } from '~/lib/shutdown.server';

import { contextChat } from './context';
import { createLazyResource } from './lazy-resource';
import { openMemoryStorage, type MemoryStorage } from './memory-storage';

/** Cap tool-call iterations and per-call output to bound cost and abuse. */
export const CHAT_LIMITS = { maxSteps: 12, maxOutputTokens: 2048 } as const;

/** The model the surface agent runs on. */
export const SURFACE_AGENT_MODEL = 'anthropic/claude-sonnet-5-5';

/**
 * Every chat's working memory belongs to this one resource, so what the agent
 * learns in one space it knows in all of them. The mock store has a single
 * workspace; a real one would key this by workspace id.
 */
export const WORKSPACE_RESOURCE_ID = 'workspace';

/** Name → what to know about it. Records merge key by key on update. */
const notes = (what: string) =>
    z.record(z.string(), z.string()).optional().describe(what);

/**
 * The workspace's memory: durable facts about the company, shared by every
 * chat in every space. Schema-based working memory merges updates (objects
 * deep-merge, arrays are replaced), so the agent only sends what changed.
 */
export const workspaceMemorySchema = z.object({
    company: z
        .object({
            name: z.string().optional(),
            about: z.string().optional(),
        })
        .optional(),
    people: notes(
        'Person name → role, what they own, how they like to work. People on the surface are listed by list_people; note what that list does not say.',
    ),
    customers: notes('Customer name → status, contacts, needs, risks.'),
    projects: notes(
        'Project or launch name → goal, owner, dates, current state, and which space or surface holds it.',
    ),
    decisions: z
        .array(z.string())
        .optional()
        .describe(
            'Decisions made, newest last, each with when and who decided. Send the whole list when you add one.',
        ),
    glossary: notes('Company term or acronym → what it means.'),
});

export const SURFACE_AGENT_INSTRUCTIONS = `
You are Surface Agent, a teammate inside Company Surface, where a company keeps its information as cards (chats, documents, boards of issues, pull requests, charts, notes, web pages, images, sketches, shapes) on canvases called surfaces, grouped into spaces. You are talking in one chat card; people see your reply there.

Each message from a person is wrapped in a <turn> tag with their id, name, and role. Address people by name, never echo the tags.

Tools: you have the surface's own tools. Use them to look things up (list_spaces, list_cards, search, get_card, list_people) before answering questions about the company's work, and to do what people ask (create documents, boards and issues, charts, notes, links, saved views, and so on). Anything you make shows on the canvas as agent work. Ask before large or sweeping changes. You cannot delete cards or post into other chats.

Workspace memory: your working memory is shared by every chat in every space of this workspace. When you learn a durable fact about the company (who someone is or what they own, a customer's situation, a project's goal or date, a decision, what a term means), save it there, briefly. Don't save chit-chat, things that only matter in this chat, or anything secret (passwords, keys, personal data beyond names and roles). Use what you remember, and say where it came from when it matters.

Replies are plain text in a chat bubble: no Markdown, no headings, no tables. Keep them short, a few sentences or a short list with "-". Name cards by their titles.
`.trim();

function createChat(storage: MemoryStorage) {
    const memory = new Memory({
        storage: storage.store,
        options: {
            // The chat's own messages arrive as input each turn (only the
            // new ones; see surface-agent.ts); this keeps earlier turns,
            // including tool calls, in context up to a token budget.
            messageHistory: { maxTokens: 60_000 },
            workingMemory: {
                enabled: true,
                scope: 'resource',
                schema: workspaceMemorySchema,
            },
        },
    });

    const agent = new Agent({
        id: 'surface-agent',
        name: 'Surface Agent',
        instructions: ({ requestContext }) => {
            const chat = contextChat({ requestContext });
            if (!chat) return SURFACE_AGENT_INSTRUCTIONS;
            return `${SURFACE_AGENT_INSTRUCTIONS}\n\nYou are in the chat "${chat.title}" (id ${chat.chatId}) on the surface "${chat.surfaceName}" (id ${chat.surfaceId}) in the ${chat.spaceName} space. "Here" and "this surface" mean that surface. Today is ${new Date().toDateString()}.`;
        },
        model: SURFACE_AGENT_MODEL,
        memory,
        defaultOptions: {
            maxSteps: CHAT_LIMITS.maxSteps,
            modelSettings: { maxOutputTokens: CHAT_LIMITS.maxOutputTokens },
        },
    });

    return { storage, memory, agent };
}

/**
 * The agent and its memory are built on first use, not at import: a Mastra
 * database that is down or slow at boot then costs the agent alone instead
 * of crashing the process. A failed open is retried on demand with backoff
 * (1s doubling to 30s); until one succeeds, getChat() rejects with
 * ResourceUnavailableError.
 */
const chat = createLazyResource({
    name: 'mastra_memory',
    open: async () =>
        createChat(await openMemoryStorage(env.MASTRA_DATABASE_URL)),
    close: ({ storage }) => storage.close(),
});
onShutdown(() => chat.close());

export function getChat() {
    return chat.get();
}
