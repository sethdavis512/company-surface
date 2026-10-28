import {
    type RouteConfig,
    index,
    layout,
    prefix,
    route,
} from '@react-router/dev/routes';

export default [
    layout('routes/layouts/auth.tsx', [
        route('/login', 'routes/login.tsx'),
        route('/forgot-password', 'routes/forgot-password.tsx'),
        route('/reset-password', 'routes/reset-password.tsx'),
    ]),
    route('/logout', 'routes/logout.tsx'),
    route('/stop-impersonating', 'routes/stop-impersonating.tsx'),
    layout('routes/layouts/app.tsx', [
        index('routes/home.tsx'),
        route('surfaces/:surfaceId', 'routes/surface.tsx', [
            index('routes/surface-index.tsx'),
            route('cards/:itemId', 'routes/surface-item.tsx'),
            route('views/:viewId', 'routes/surface-view.tsx'),
        ]),
    ]),
    route('/healthcheck', 'routes/healthcheck.ts'),
    ...prefix('/api', [
        route('/auth/*', 'routes/api-auth.ts'),
        route('/mcp', 'routes/api-mcp.ts'),
        route('/agent-chat', 'routes/api-agent-chat.ts'),
        route('/theme', 'routes/api-theme.ts'),
        route('/test-mailbox', 'routes/api-test-mailbox.ts'),
        route('/test-role', 'routes/api-test-role.ts'),
    ]),
] satisfies RouteConfig;
