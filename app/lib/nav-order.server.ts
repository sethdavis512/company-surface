import { createCookie } from 'react-router';
import { APP_SLUG } from '~/config';
import {
    NAV_SECTIONS,
    completeNavOrder,
    navCollapsedSchema,
    navOrderSchema,
    type NavSectionKey,
} from '~/lib/nav-order';

/** Each person's left-nav section order, so it renders right on first paint. */
const navOrderCookie = createCookie(`${APP_SLUG}_nav_order`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
});

export async function getNavOrder(request: Request): Promise<NavSectionKey[]> {
    const parsed = navOrderSchema.safeParse(
        await navOrderCookie.parse(request.headers.get('Cookie')),
    );
    return parsed.success ? completeNavOrder(parsed.data) : [...NAV_SECTIONS];
}

export function serializeNavOrder(order: NavSectionKey[]) {
    return navOrderCookie.serialize(order);
}

/** Each person's collapsed left-nav sections, for the same reason. */
const navCollapsedCookie = createCookie(`${APP_SLUG}_nav_collapsed`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
});

export async function getNavCollapsed(
    request: Request,
): Promise<NavSectionKey[]> {
    const parsed = navCollapsedSchema.safeParse(
        await navCollapsedCookie.parse(request.headers.get('Cookie')),
    );
    return parsed.success ? parsed.data : [];
}

export function serializeNavCollapsed(collapsed: NavSectionKey[]) {
    return navCollapsedCookie.serialize(collapsed);
}
