import { createTool, type Tool } from '@mastra/core/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { jsonSchema, type JSONSchema7 } from 'ai';

import {
    OLD_TOOL_NAMES,
    createSurfaceMcpServer,
} from '~/mcp/surface-mcp.server';

/**
 * Tools the chat agent never gets. It answers in the chat it was asked in, so
 * it doesn't post messages itself, and it doesn't remove what people made.
 */
export const WITHHELD_TOOLS: readonly string[] = [
    'post_message',
    'delete_card',
    'delete_view',
    'unlink_cards',
    ...Object.values(OLD_TOOL_NAMES),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SurfaceTool = Tool<any, any>;

type ToolResult = {
    content?: { type: string; text?: string }[];
    isError?: boolean;
};

/** The text an MCP tool answered with, the way an MCP client would show it. */
export function resultText(result: ToolResult): string {
    const text = (result.content ?? [])
        .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
        .join('\n');
    return result.isError ? `Error: ${text}` : text;
}

/**
 * The surface's MCP tools as Mastra tools, served in-process: the agent
 * calls the very tools external agents reach at `/api/mcp`, through an
 * in-memory transport, so there's one set of tools and no network hop or
 * API key. Build them per run (the server is cheap; `/api/mcp` makes one per
 * request too) and `close()` when the run ends.
 */
export async function openSurfaceTools(): Promise<{
    tools: Record<string, SurfaceTool>;
    close(): Promise<void>;
}> {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const server = createSurfaceMcpServer();
    const client = new Client({ name: 'surface-agent', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools: listed } = await client.listTools();
    const tools: Record<string, SurfaceTool> = {};
    for (const definition of listed) {
        if (WITHHELD_TOOLS.includes(definition.name)) continue;
        tools[definition.name] = createTool({
            id: definition.name,
            description: definition.description ?? definition.name,
            inputSchema: jsonSchema<Record<string, unknown>>(
                definition.inputSchema as JSONSchema7,
            ),
            execute: async (args) =>
                resultText(
                    (await client.callTool({
                        name: definition.name,
                        arguments: args,
                    })) as ToolResult,
                ),
        });
    }

    return {
        tools,
        close: async () => {
            await client.close().catch(() => {});
            await server.close().catch(() => {});
        },
    };
}
