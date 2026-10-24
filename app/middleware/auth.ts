import { redirect, type MiddlewareFunction } from 'react-router';
import { userContext, type SessionUser } from '~/context';
import { env } from '~/lib/env.server';
import { getUserFromSession } from '~/models/session.server';

/**
 * Temporary, for development: while true, signed-out requests get a stand-in
 * user instead of a redirect to /login. It never applies in production or in
 * E2E runs (which set E2E_TEST_HOOKS), so the auth tests still exercise the
 * redirect. Set it to false to put sign-in back.
 */
const DEV_AUTH_BYPASS = true;

const DEV_USER = {
    id: 'dev-user',
    name: 'Dev User',
    email: 'dev@localhost',
    emailVerified: true,
    image: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    role: 'USER',
} as SessionUser;

function shouldBypassAuth() {
    return (
        DEV_AUTH_BYPASS && env.NODE_ENV !== 'production' && !env.E2E_TEST_HOOKS
    );
}

/**
 * Redirects unauthenticated requests to /login. On success, stashes the
 * resolved user in `userContext` so loaders/actions can skip a redundant
 * session lookup via `context.get(userContext)`.
 */
export const authMiddleware: MiddlewareFunction<Response> = async ({
    request,
    context,
}) => {
    const user = await getUserFromSession(request);

    if (!user) {
        if (shouldBypassAuth()) {
            context.set(userContext, DEV_USER);
            return;
        }
        throw redirect('/login');
    }

    context.set(userContext, user);
};
