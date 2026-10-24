import {
    test as base,
    expect,
    type Browser,
    type BrowserContext,
    type Page,
} from '@playwright/test';
import { DEMO_EMAIL_DOMAIN } from '~/config';

export const TEST_USER = {
    name: 'Alice',
    email: `alice@${DEMO_EMAIL_DOMAIN}`,
    password: 'password123',
};

/** Second seeded user, used for cross-user authorization tests. */
export const TEST_USER_BOB = {
    name: 'Bob',
    email: `bob@${DEMO_EMAIL_DOMAIN}`,
    password: 'password123',
};

/** Where the auth form sends users on success. */
export const REDIRECT_PATH = '/';

/**
 * Wait for React hydration (html[data-hydrated], set by root.tsx). Required
 * before interacting with controls whose behavior is attached by React
 * (fetcher-submitting selects, dialog-opening buttons): before hydration
 * they accept DOM events but do nothing.
 */
export async function waitForHydration(page: Page) {
    await page.waitForSelector('html[data-hydrated]', { state: 'attached' });
}

/** Sign in through the login form and wait for the post-login redirect. */
export async function loginViaUI(
    page: Page,
    user: { email: string; password: string } = TEST_USER,
) {
    await page.goto('/login');
    await waitForHydration(page);
    await page.getByPlaceholder('name@example.com').fill(user.email);
    await page.getByPlaceholder('Your password').fill(user.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(new RegExp(REDIRECT_PATH));
}

/**
 * Sign up a brand-new account via the Better Auth API in the given context and
 * return its credentials. Sign-up auto-signs-in, so the context is left
 * authenticated (its cookie jar holds the session). The email carries a random
 * UUID so concurrent Playwright runs sharing one database (where worker
 * indexes and timestamps repeat) never mint the same address.
 */
export async function createFreshUser(
    context: BrowserContext,
    baseURL: string,
    tag: string | number = 'x',
) {
    const email = `e2e-${tag}-${crypto.randomUUID()}@iridium.test`;
    const password = 'password123';

    const res = await context.request.post('/api/auth/sign-up/email', {
        // Better Auth checks the request Origin against its trusted origins.
        headers: { Origin: baseURL },
        data: { name: `E2E User ${tag}`, email, password },
    });

    if (!res.ok()) {
        throw new Error(
            `Fresh-user sign-up failed (${res.status()}): ${await res.text()}`,
        );
    }

    return { email, password };
}

/**
 * Create a fresh browser context already authenticated as a brand-new user.
 * Caller is responsible for closing the returned context.
 */
export async function createAuthedContext(
    browser: Browser,
    baseURL: string,
    tag: string | number = 'x',
): Promise<BrowserContext> {
    const context = await browser.newContext({ baseURL });
    await createFreshUser(context, baseURL, tag);
    return context;
}

/**
 * Extend the base test with an `authedPage` fixture backed by a brand-new user
 * created per test. Each test therefore starts from a clean slate (zero
 * threads, zero notes), which keeps parallel runs free of shared-state races.
 */
export const test = base.extend<{ authedPage: Page }>({
    authedPage: async ({ browser }, use, testInfo) => {
        const baseURL = testInfo.project.use.baseURL;
        if (!baseURL) throw new Error('baseURL is not configured');

        const context = await browser.newContext({ baseURL });
        await createFreshUser(context, baseURL, testInfo.workerIndex);

        const page = await context.newPage();
        await use(page);
        await context.close();
    },
});

export { expect };
