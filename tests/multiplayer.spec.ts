import type { BrowserContext, Page } from '@playwright/test';
import {
    test,
    expect,
    createAuthedContext,
    waitForHydration,
} from './fixtures';

/**
 * Two people on one surface at once: each sees who else is here, and what
 * one does reaches the other through the event stream (no reload, and
 * faster than the fallback poll).
 */

/** Well under the 5s fallback poll, so passing means the stream did it. */
const PUSHED_MS = 2500;

async function mcp(page: Page, name: string, args: Record<string, unknown>) {
    const response = await page.request.post('/api/mcp', {
        headers: { Accept: 'application/json, text/event-stream' },
        data: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        },
    });
    const { result } = await response.json();
    return JSON.parse(result.content[0].text);
}

function presence(page: Page) {
    return page.getByRole('group', { name: /^Here now:/ });
}

test.describe('Multiplayer', () => {
    let contexts: BrowserContext[] = [];

    test.afterEach(async () => {
        await Promise.all(contexts.map((context) => context.close()));
        contexts = [];
    });

    async function openAs(
        browser: Parameters<Parameters<typeof test>[2]>[0]['browser'],
        baseURL: string,
        tag: string,
        surfaceId: string,
    ) {
        const context = await createAuthedContext(browser, baseURL, tag);
        contexts.push(context);
        const page = await context.newPage();
        await page.goto(`/surfaces/${surfaceId}`);
        await waitForHydration(page);
        return page;
    }

    test('two people see each other, and each other’s changes, live', async ({
        browser,
    }, testInfo) => {
        const baseURL = testInfo.project.use.baseURL!;
        const run = crypto.randomUUID().slice(0, 6);
        const ann = `ann-${run}`;
        const ben = `ben-${run}`;

        const setup = await createAuthedContext(browser, baseURL, 'setup');
        contexts.push(setup);
        const surface = await mcp(await setup.newPage(), 'create_surface', {
            spaceId: 'product',
            name: `Together ${run}`,
        });

        const annPage = await openAs(browser, baseURL, ann, surface.id);
        const benPage = await openAs(browser, baseURL, ben, surface.id);

        // Each sees both, the other first.
        await expect(presence(annPage)).toHaveAccessibleName(
            `Here now: E2E User ${ben}, E2E User ${ann} (you)`,
        );
        await expect(presence(benPage)).toHaveAccessibleName(
            `Here now: E2E User ${ann}, E2E User ${ben} (you)`,
        );

        // Ann adds a chat; Ben sees it arrive.
        await annPage.getByRole('button', { name: 'Add', exact: true }).click();
        await annPage.getByRole('menuitem', { name: 'Chat' }).click();
        const benChat = benPage.getByRole('region', { name: 'Chat: New chat' });
        await expect(benChat).toBeVisible({ timeout: PUSHED_MS });

        // Ann writes in it; Ben sees the message as hers, not his own.
        const annChat = annPage.getByRole('region', { name: 'Chat: New chat' });
        const zoom = annPage.getByRole('button', { name: 'Zoom to New chat' });
        if (await zoom.count()) {
            await zoom.focus();
            await annPage.keyboard.press('Enter');
        }
        await annChat
            .getByRole('textbox', { name: 'Message New chat' })
            .fill('Morning, Ben');
        await annChat.getByRole('button', { name: 'Send' }).click();
        const message = benChat
            .getByRole('list', { name: 'Messages' })
            .getByRole('listitem')
            .filter({ hasText: 'Morning, Ben' });
        await expect(message).toBeVisible({ timeout: PUSHED_MS });
        await expect(message.locator(`[title="E2E User ${ann}"]`)).toHaveCount(
            1,
        );

        // Ben leaves; Ann is alone again.
        await benPage.close();
        await expect(presence(annPage)).toHaveAccessibleName(
            `Here now: E2E User ${ann} (you)`,
            { timeout: PUSHED_MS },
        );
    });

    test('an agent’s change shows up without a reload', async ({
        authedPage: page,
    }) => {
        const surface = await mcp(page, 'create_surface', {
            spaceId: 'product',
            name: `Agent ${crypto.randomUUID().slice(0, 6)}`,
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);
        await expect(presence(page)).toBeVisible();

        await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Pushed by the agent',
        });
        await expect(
            page.getByRole('article', {
                name: 'Sticky note: Pushed by the agent',
            }),
        ).toBeVisible({ timeout: PUSHED_MS });
    });
});
