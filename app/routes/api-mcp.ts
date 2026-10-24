import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env } from '~/lib/env.server';
import { createSurfaceMcpServer } from '~/mcp/surface-mcp.server';
import type { Route } from './+types/api-mcp';

/**
 * The surface's MCP endpoint (Streamable HTTP, stateless: each request gets a
 * fresh server and answers in plain JSON). Point an agent at
 * `<base URL>/api/mcp`.
 */

function sameSecret(given: string, expected: string) {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** A response refusing the request, or null when it may proceed. */
function refuse(request: Request): Response | null {
    const key = env.MCP_API_KEY;
    if (!key) {
        return env.NODE_ENV === 'production'
            ? new Response('MCP is off: set MCP_API_KEY to turn it on.', {
                  status: 503,
              })
            : null;
    }

    const header = request.headers.get('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (token && token !== header && sameSecret(token, key)) return null;

    return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
    });
}

async function handle(request: Request): Promise<Response> {
    const refusal = refuse(request);
    if (refusal) return refusal;

    const server = createSurfaceMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
}

export async function loader({ request }: Route.LoaderArgs) {
    return handle(request);
}

export async function action({ request }: Route.ActionArgs) {
    return handle(request);
}
