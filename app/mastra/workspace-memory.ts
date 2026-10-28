import { Memory } from '@mastra/memory';
import { z } from 'zod';

import { env } from '~/lib/env.server';
import { onShutdown } from '~/lib/shutdown.server';

import { createLazyResource, ResourceUnavailableError } from './lazy-resource';
import { openMemoryStorage } from './memory-storage';

/**
 * Every agent chat's working memory belongs to this one resource, so what
 * the agent learns in one space it knows in all of them. The mock store has a
 * single workspace; a real one would key this by workspace id.
 */
export const WORKSPACE_RESOURCE_ID = 'workspace';

/** Name → what to know about it. Records merge key by key on update. */
const notes = (what: string) =>
    z.record(z.string(), z.string()).optional().describe(what);

/**
 * The workspace's memory: durable facts about the company, shared by every
 * agent chat in every space. Schema-based working memory merges updates
 * (objects deep-merge, arrays are replaced), so the agent only sends what
 * changed.
 */
export const workspaceMemorySchema = z.object({
    company: z
        .object({
            name: z.string().optional(),
            about: z.string().optional(),
        })
        .optional(),
    people: notes(
        'Person name → role, what they own, how they like to work: what the people list does not already say.',
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

/**
 * Only working memory: each turn's history comes from the chat card itself
 * (`chatHistory`), so Mastra neither loads nor saves messages.
 */
function createMemory(storage: Awaited<ReturnType<typeof openMemoryStorage>>) {
    const memory = new Memory({
        storage: storage.store,
        options: {
            lastMessages: false,
            workingMemory: {
                enabled: true,
                scope: 'resource',
                schema: workspaceMemorySchema,
            },
        },
    });
    return { storage, memory };
}

/**
 * Opened on first use, not at import: a Mastra database that is down or slow
 * at boot then costs the agent its memory alone. A failed open is retried on
 * demand with backoff (1s doubling to 30s).
 */
const workspaceMemory = createLazyResource({
    name: 'mastra_memory',
    open: async () =>
        createMemory(await openMemoryStorage(env.MASTRA_DATABASE_URL)),
    close: ({ storage }) => storage.close(),
});
onShutdown(() => workspaceMemory.close());

/**
 * The workspace memory, or null while its database is unreachable: agent
 * chats keep working then, just without memory (the failed open is logged
 * by the lazy resource).
 */
export async function getWorkspaceMemory(): Promise<Memory | null> {
    try {
        return (await workspaceMemory.get()).memory;
    } catch (error) {
        if (error instanceof ResourceUnavailableError) return null;
        throw error;
    }
}
