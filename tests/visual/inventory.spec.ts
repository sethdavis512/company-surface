import { test, expect } from '../fixtures';
import {
    MOBILE_VIEWPORT,
    createVisualContext,
    setTheme,
    settle,
    snap,
} from './helpers';

/**
 * Visual inventory: one screenshot per major surface/state, written to
 * test-results/visual-inventory/ and attached to the HTML report (which
 * doubles as a browsable gallery). Runs only via `bun run test:visual`; the
 * default e2e projects ignore tests/visual/.
 *
 * These are captures, not assertions: a shot fails only if the page cannot
 * reach the state, never on pixel drift. To promote a shot to visual
 * regression later, swap snap() for expect(page).toHaveScreenshot().
 */

function projectBaseURL(testInfo: { project: { use: { baseURL?: string } } }) {
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) throw new Error('baseURL is not configured');
    return baseURL;
}

test.describe('logged out', () => {
    test('login', async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            baseURL: projectBaseURL(testInfo),
        });
        await setTheme(context, 'light');
        const page = await context.newPage();
        await page.goto('/login');
        await settle(page);
        await snap(page, testInfo, 'login');
        await context.close();
    });

    test('login, dark', async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            baseURL: projectBaseURL(testInfo),
        });
        await setTheme(context, 'dark');
        const page = await context.newPage();
        await page.goto('/login');
        await settle(page);
        await snap(page, testInfo, 'login-dark');
        await context.close();
    });

    test('login, mobile', async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            baseURL: projectBaseURL(testInfo),
            viewport: MOBILE_VIEWPORT,
        });
        await setTheme(context, 'light');
        const page = await context.newPage();
        await page.goto('/login');
        await settle(page);
        await snap(page, testInfo, 'login-mobile');
        await context.close();
    });
});

test.describe('surface', () => {
    for (const theme of ['light', 'dark'] as const) {
        test(`canvas, ${theme}`, async ({ browser }, testInfo) => {
            const context = await createVisualContext(
                browser,
                projectBaseURL(testInfo),
                testInfo.workerIndex,
            );
            await setTheme(context, theme);
            const page = await context.newPage();
            await page.goto('/surfaces/atlas-launch');
            await settle(page);
            await expect(
                page.getByRole('application', { name: 'Company surface' }),
            ).toBeVisible();
            await snap(page, testInfo, `surface-${theme}`);
            await context.close();
        });
    }

    test('canvas, mobile', async ({ browser }, testInfo) => {
        const context = await createVisualContext(
            browser,
            projectBaseURL(testInfo),
            testInfo.workerIndex,
        );
        await setTheme(context, 'light');
        const page = await context.newPage();
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto('/surfaces/atlas-launch');
        await settle(page);
        await snap(page, testInfo, 'surface-mobile');
        await context.close();
    });
});
