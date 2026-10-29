import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForHydration } from './fixtures';

/** The seeded surface every card here is on. */
const SURFACE_ID = 'atlas-launch';
const SURFACE = `/surfaces/${SURFACE_ID}`;
const SURFACE_URL = new RegExp(`${SURFACE}$`);

/** The element's style once it stops changing (view animations finish). */
async function settledStyle(locator: Locator): Promise<string | null> {
    let last = await locator.getAttribute('style');
    for (let attempt = 0; attempt < 20; attempt++) {
        await locator.page().waitForTimeout(300);
        const next = await locator.getAttribute('style');
        if (next === last) return next;
        last = next;
    }
    throw new Error('The view never settled');
}

/**
 * Zoomed out, a click on a window zooms the canvas to it (its overlay)
 * rather than reaching what's inside; do that first, as a person would.
 */
async function zoomToWindow(page: Page, title: string) {
    const overlay = page.getByRole('button', { name: `Zoom to ${title}` });
    if ((await overlay.count()) === 0) return;
    // By keyboard (it's a button): on a crowded test canvas the window can
    // sit partly behind the left nav, out of the pointer's reach.
    await overlay.focus();
    await page.keyboard.press('Enter');
    await expect(overlay).toHaveCount(0);
    await settledStyle(page.locator('.trellis__viewport'));
}

/**
 * A window's buttons show while you hover it (or work in it); hover its
 * header first, as a person would, before clicking one.
 */
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

/** The filter bar folds to a pill until used: open it, as a person would. */
async function openFilters(page: Page) {
    const bar = page.getByRole('toolbar', { name: 'Filter cards' });
    await bar.getByRole('button', { name: /^Filter/ }).click();
    await expect(bar.getByRole('button', { name: 'All' })).toBeVisible();
    return bar;
}

/** Resolves once the surface action has answered a request with this intent. */
function posted(page: Page, intent: string) {
    return page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            (response.request().postData() ?? '').includes(intent),
    );
}

async function revealControls(window: Locator) {
    // Forced: zoomed out, the window's own overlay sits over the header,
    // and hovering that reveals the buttons just the same.
    await window.locator('header').first().hover({ force: true });
}

test.describe('Surface', () => {
    // One at a time, each starting from the tidy layout: window positions
    // are saved in the shared store, so a window one test drags would sit
    // in another's way.
    test.describe.configure({ mode: 'default' });
    test.afterEach(async ({ authedPage: page }) => {
        const response = await page.request.post(`${SURFACE}.data`, {
            form: { intent: 'reset-positions' },
        });
        expect(response.ok()).toBe(true);
    });

    test('shows two chat windows and a document on the canvas', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        const canvas = page.getByRole('application', {
            name: 'Company surface',
        });
        await expect(canvas).toBeVisible();

        // Agents can add items mid-run (the store is shared), so check the
        // seeded ones by name rather than counting.
        for (const title of ['Launch crew', 'Rosa Alvarez']) {
            await expect(
                canvas.getByRole('region', { name: `Chat: ${title}` }),
            ).toBeVisible();
        }
        await expect(
            canvas.getByRole('article', {
                name: 'Document: Atlas launch brief',
            }),
        ).toBeVisible();
    });

    test('windows keep their 9:16 and 16:9 shapes', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        const chat = page.getByRole('region', { name: 'Chat: Launch crew' });
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });

        const chatBox = (await chat.boundingBox())!;
        const docBox = (await doc.boundingBox())!;
        expect(chatBox.width / chatBox.height).toBeCloseTo(9 / 16, 2);
        expect(docBox.width / docBox.height).toBeCloseTo(16 / 9, 2);
    });

    test('left nav links each item to its own route', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const nav = page.getByRole('navigation', { name: 'Surface' });

        // Scoped: once opened, the brief is also listed under Recent.
        const brief = nav
            .getByRole('region', { name: 'Documents' })
            .getByRole('link', { name: 'Atlas launch brief' });
        for (const title of ['Launch crew', 'Rosa Alvarez']) {
            await expect(nav.getByRole('link', { name: title })).toBeVisible();
        }
        await brief.click();
        await expect(page).toHaveURL(/\/cards\/doc-brief$/);
        await expect(page).toHaveTitle(/^Atlas launch brief \|/);
        await expect(brief).toHaveAttribute('aria-current', 'page');
    });

    test('a window focus button zooms in, and Back to canvas zooms out to where it was', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const viewport = page.locator('.trellis__viewport');
        const chat = page.getByRole('region', { name: 'Chat: Launch crew' });

        const fitted = await settledStyle(viewport);
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await expect
            .poll(() => viewport.getAttribute('style'))
            .not.toBe(fitted);
        const before = await settledStyle(viewport);
        const smallWidth = (await chat.boundingBox())!.width;

        // By keyboard: zoomed in, the button can sit under the filter bar.
        await page.getByRole('link', { name: 'Focus Launch crew' }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/cards\/chat-launch$/);
        await expect
            .poll(async () => (await chat.boundingBox())!.width)
            .toBeGreaterThan(smallWidth * 1.2);

        await page.getByRole('link', { name: 'Back to canvas' }).click();
        await expect(page).toHaveURL(SURFACE_URL);
        await expect.poll(() => viewport.getAttribute('style')).toBe(before);
    });

    test('a focused window fills the canvas, inset a few pixels', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE + '/cards/doc-brief');
        const canvas = page.getByRole('application', {
            name: 'Company surface',
        });
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        await expect(
            page.getByRole('link', { name: 'Back to canvas' }),
        ).toBeVisible();

        // The top inset leaves a row for "Back to canvas"; the rest are thin.
        await expect
            .poll(async () => {
                const c = (await canvas.boundingBox())!;
                const d = (await doc.boundingBox())!;
                return [
                    d.y - c.y,
                    c.x + c.width - (d.x + d.width),
                    c.y + c.height - (d.y + d.height),
                    d.x - c.x,
                ].map(Math.round);
            })
            .toEqual([60, 12, 12, 12]);
    });

    test('leaving focus shrinks the window back to its resting size', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE + '/cards/chat-launch');
        await waitForHydration(page);
        const node = page.locator('[data-node-id="chat-launch"]');
        await expect(node).not.toHaveCSS('width', '360px');

        await page.getByRole('link', { name: 'Back to canvas' }).click();
        await expect(page).toHaveURL(SURFACE_URL);
        await expect(node).toHaveCSS('width', '360px');
        await expect(node).toHaveCSS('height', '640px');
    });

    test('Recent puts an item on top the moment you open it', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const nav = page.getByRole('navigation', { name: 'Surface' });
        const recent = nav.getByRole('region', { name: 'Recent' });
        await expect(recent).toHaveCount(0);

        for (const title of [
            'Launch crew',
            'Atlas launch brief',
            'Rosa Alvarez',
        ]) {
            await nav
                .getByRole('region', { name: /Chats|Documents/ })
                .getByRole('link', { name: title })
                .click();
            await expect(page).toHaveTitle(new RegExp(`^${title} \\|`));
            // On top while still open, not only after leaving.
            await expect(recent.getByRole('link').first()).toHaveText(title);
        }

        // Opening one again moves it up instead of listing it twice.
        await nav
            .getByRole('region', { name: 'Chats' })
            .getByRole('link', { name: 'Launch crew' })
            .click();
        await expect(recent.getByRole('link')).toHaveText([
            'Launch crew',
            'Rosa Alvarez',
            'Atlas launch brief',
        ]);
    });

    test('a chat an agent starts over MCP appears on the open canvas', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const title = `Agent chat ${crypto.randomUUID().slice(0, 6)}`;

        const response = await page.request.post('/api/mcp', {
            headers: { Accept: 'application/json, text/event-stream' },
            data: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'create_chat',
                    arguments: {
                        surfaceId: SURFACE_ID,
                        title,
                        firstMessage: 'Hello from an agent',
                    },
                },
            },
        });
        expect(response.ok()).toBe(true);

        const chat = page.getByRole('region', { name: `Chat: ${title}` });
        await expect(chat).toBeVisible();
        await expect(chat.getByText('Hello from an agent')).toBeVisible();
        await expect(
            page
                .getByRole('navigation', { name: 'Surface' })
                .getByRole('link', { name: title }),
        ).toBeVisible();
    });

    test('stacking buttons put a window above or below one it overlaps', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const launch = page.getByRole('region', { name: 'Chat: Launch crew' });
        const rosa = page.getByRole('region', { name: 'Chat: Rosa Alvarez' });
        // Up close, as a person would: on a crowded test canvas the fitted
        // view can leave Launch crew partly behind the left nav. A tall
        // window, so both 640px chats fit at 100% below the filter bar.
        await page.setViewportSize({ width: 1400, height: 1000 });
        await zoomToWindow(page, 'Launch crew');
        // A known start: Launch crew under Rosa. The order lives in the
        // shared store, which a reused local test server keeps between runs.
        await revealControls(launch);
        await page
            .getByRole('button', { name: 'Send Launch crew to back' })
            .click();

        // Drag Rosa over the lower part of Launch crew, leaving Launch
        // crew's header and buttons (near its top) in reach of the pointer.
        const from = (await rosa.boundingBox())!;
        const target = (await launch.boundingBox())!;
        const dx = target.x - from.x;
        const dy = target.y + target.height * 0.45 - from.y;
        // The middle of the header, which is what drags a window; below it
        // (messages) doesn't start a drag, and at small zooms a fixed offset
        // from the top lands there.
        const header = (await rosa.locator('header').boundingBox())!;
        const grab = {
            x: header.x + 40,
            y: header.y + header.height / 2,
        };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
        await page.mouse.up();

        // Which window is on top where they overlap?
        const topAtOverlap = async () => {
            const box = (await launch.boundingBox())!;
            // Through the window's node, which holds both the window and,
            // zoomed out, the overlay that names it.
            return page.evaluate(
                ([x, y]) =>
                    document
                        .elementFromPoint(x!, y!)
                        ?.closest('[data-node-id]')
                        ?.querySelector('[aria-label^="Chat: "]')
                        ?.getAttribute('aria-label'),
                [box.x + box.width - 20, box.y + box.height * 0.8],
            );
        };
        await expect.poll(topAtOverlap).toBe('Chat: Rosa Alvarez');

        await revealControls(launch);
        await page
            .getByRole('button', { name: 'Bring Launch crew to front' })
            .click();
        await expect.poll(topAtOverlap).toBe('Chat: Launch crew');

        await revealControls(launch);
        await page
            .getByRole('button', { name: 'Send Launch crew to back' })
            .click();
        await expect.poll(topAtOverlap).toBe('Chat: Rosa Alvarez');
    });

    test('window buttons show only while you work with the window', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        const column = page
            .getByRole('button', { name: 'Bring Atlas launch brief to front' })
            .locator('xpath=..');
        const canvas = (await page
            .getByRole('application', { name: 'Company surface' })
            .boundingBox())!;
        const awayFromWindows = async () =>
            page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);

        await expect(column).toHaveCSS('opacity', '0');
        await expect(column).toHaveCSS('pointer-events', 'none');

        await revealControls(doc);
        await expect(column).toHaveCSS('opacity', '1');
        await awayFromWindows();
        await expect(column).toHaveCSS('opacity', '0');

        // While its color menu is open, even with the pointer on the menu.
        await revealControls(doc);
        await page
            .getByRole('button', {
                name: 'Border color for Atlas launch brief',
            })
            .click();
        await page.getByRole('menuitemradio', { name: 'Default' }).hover();
        await expect(column).toHaveCSS('opacity', '1');
        await page.keyboard.press('Escape');

        // Selected (a click, or a tap on touch screens) keeps them up.
        await revealControls(doc);
        await doc.locator('header').first().click({ force: true });
        await awayFromWindows();
        await expect(column).toHaveCSS('opacity', '1');
    });

    test('a window takes a border color from the palette, and can go back to default', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        const picker = page.getByRole('button', {
            name: 'Border color for Atlas launch brief',
        });
        const defaultColor = await doc.evaluate(
            (el) => getComputedStyle(el).borderTopColor,
        );

        await revealControls(doc);
        await picker.click();
        await expect(page.getByRole('menuitemradio')).toHaveCount(7);
        await page.getByRole('menuitemradio', { name: 'Sky' }).click();
        await expect(page.getByRole('menuitemradio')).toHaveCount(0);
        await expect(doc).toHaveCSS('border-top-width', '2px');
        await expect(doc).not.toHaveCSS('border-top-color', defaultColor);

        await revealControls(doc);
        await picker.click();
        await expect(
            page.getByRole('menuitemradio', { name: 'Sky' }),
        ).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('menuitemradio', { name: 'Default' }).click();
        await expect(doc).toHaveCSS('border-top-width', '1px');
        await expect(doc).toHaveCSS('border-top-color', defaultColor);
    });

    test('a border color shows at once, and survives a reload', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const rosa = page.getByRole('region', { name: 'Chat: Rosa Alvarez' });
        const picker = page.getByRole('button', {
            name: 'Border color for Rosa Alvarez',
        });

        // Hold the save so the change can only come from the pending request.
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route(`**${SURFACE}.data`, async (route) => {
            if (route.request().method() === 'POST') await held;
            await route.continue();
        });

        await revealControls(rosa);
        await picker.click();
        await page.getByRole('menuitemradio', { name: 'Violet' }).click();
        await expect(rosa).toHaveCSS('border-top-width', '2px');

        release();
        await page.unrouteAll({ behavior: 'wait' });
        await page.waitForLoadState('networkidle');

        await page.reload();
        await expect(rosa).toHaveCSS('border-top-width', '2px');

        // Put it back for the other tests: the store is shared.
        await waitForHydration(page);
        await revealControls(rosa);
        await picker.click();
        await page.getByRole('menuitemradio', { name: 'Default' }).click();
        await expect(rosa).toHaveCSS('border-top-width', '1px');
        await page.reload();
        await expect(rosa).toHaveCSS('border-top-width', '1px');
    });

    test('a saved view jumps back to the same spot, even from a fresh load', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const viewport = page.locator('.trellis__viewport');
        const views = page.getByRole('region', { name: 'Views' });
        const name = `Spot ${crypto.randomUUID().slice(0, 6)}`;

        const fitted = await settledStyle(viewport);
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await expect
            .poll(() => viewport.getAttribute('style'))
            .not.toBe(fitted);
        const spot = await settledStyle(viewport);

        await views.getByRole('button', { name: 'Save current view' }).click();
        await views.getByRole('textbox', { name: 'View name' }).fill(name);
        await views.getByRole('button', { name: 'Save', exact: true }).click();
        const link = views.getByRole('link', { name: new RegExp(name) });
        await expect(link).toBeVisible();

        await page.getByRole('button', { name: 'Fit to view' }).click();
        await expect.poll(() => viewport.getAttribute('style')).not.toBe(spot);

        await link.click();
        await expect(page).toHaveURL(/\/views\/view-/);
        await expect(page).toHaveTitle(new RegExp(`^${name} \\|`));
        await expect.poll(() => viewport.getAttribute('style')).toBe(spot);

        // A fresh load of the view's URL lands on the same spot.
        await page.reload();
        await expect.poll(() => viewport.getAttribute('style')).toBe(spot);

        // Clean up: the store is shared. Deleting the open view leaves it.
        await waitForHydration(page);
        await views
            .getByRole('button', { name: `Delete view ${name}` })
            .click();
        await expect(page).toHaveURL(SURFACE_URL);
        await expect(link).toHaveCount(0);
    });

    test('the filter bar dims windows that do not match', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const bar = await openFilters(page);
        const doc = page.locator('[data-node-id="doc-brief"]');
        const pr = page.locator('[data-node-id="pr-api-freeze"]');
        const chat = page.locator('[data-node-id="chat-launch"]');

        await bar.getByRole('button', { name: 'Pull requests' }).click();
        await expect(doc).toHaveCSS('opacity', '0.25');
        await expect(chat).toHaveCSS('opacity', '0.25');
        await expect(pr).toHaveCSS('opacity', '1');

        await bar.getByRole('button', { name: 'Chats' }).click();
        await expect(chat).toHaveCSS('opacity', '1');
        await expect(pr).toHaveCSS('opacity', '0.25');

        await bar.getByRole('button', { name: 'All' }).click();
        await expect(doc).toHaveCSS('opacity', '1');
        await expect(pr).toHaveCSS('opacity', '1');
    });

    test('a pull request an agent opens hangs under its chat, linked both ways', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const title = `Agent change ${crypto.randomUUID().slice(0, 6)}`;

        const response = await page.request.post('/api/mcp', {
            headers: { Accept: 'application/json, text/event-stream' },
            data: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'open_pull_request',
                    arguments: {
                        chatId: 'chat-customers',
                        title,
                        branch: 'atlas/e2e',
                    },
                },
            },
        });
        const { result } = await response.json();
        const created = JSON.parse(result.content[0].text);

        const window = page.getByRole('article', {
            name: `Pull request: #${created.number} ${title}`,
        });
        await expect(window).toBeVisible();

        // Under the chat, in its column.
        const chat = page.getByRole('region', { name: 'Chat: Rosa Alvarez' });
        const chatBox = (await chat.boundingBox())!;
        const prBox = (await window.boundingBox())!;
        expect(Math.abs(prBox.x - chatBox.x)).toBeLessThan(2);
        expect(prBox.y).toBeGreaterThan(chatBox.y + chatBox.height);

        // Chat → pull request, through the chip; pull request → chat back.
        await zoomToWindow(page, 'Rosa Alvarez');
        await chat
            .getByRole('navigation', { name: 'Pull requests from this chat' })
            .getByRole('link', { name: `#${created.number}` })
            .click();
        await expect(page).toHaveURL(new RegExp(`/cards/${created.id}$`));
        await window.getByRole('link', { name: /From chat/ }).click();
        await expect(page).toHaveURL(/\/cards\/chat-customers$/);

        // Merge it from its window.
        await page.goto(`${SURFACE}/cards/${created.id}`);
        await waitForHydration(page);
        await expect(window.getByText('Open', { exact: true })).toBeVisible();
        await window.getByRole('button', { name: 'Merge' }).click();
        await expect(window.getByText('Merged', { exact: true })).toBeVisible();
        await expect(window.getByRole('button', { name: 'Merge' })).toHaveCount(
            0,
        );
    });

    test('Arrange tidies windows that were dragged on top of each other', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        const launch = page.getByRole('region', { name: 'Chat: Launch crew' });
        const overlaps = async () => {
            const a = (await doc.boundingBox())!;
            const b = (await launch.boundingBox())!;
            return (
                a.x < b.x + b.width &&
                b.x < a.x + a.width &&
                a.y < b.y + b.height &&
                b.y < a.y + a.height
            );
        };

        // Drag the document by its header onto Launch crew.
        const from = (await doc.locator('header').boundingBox())!;
        const to = (await launch.boundingBox())!;
        await page.mouse.move(from.x + 60, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + 40, to.y + 40, { steps: 8 });
        const saved = posted(page, 'move-windows');
        await page.mouse.up();
        await expect.poll(overlaps).toBe(true);

        // Where it was dropped is saved: a reload keeps it there.
        await saved;
        await page.reload();
        await waitForHydration(page);
        await expect.poll(overlaps).toBe(true);

        const arranged = posted(page, 'arrange');
        await page.getByRole('button', { name: 'Arrange' }).click();
        await expect.poll(overlaps).toBe(false);
        // Arrange saves where it put everything, so a reload keeps it tidy.
        await arranged;
        await page.reload();
        await waitForHydration(page);
        await expect.poll(overlaps).toBe(false);
    });

    test('nav sections drag into a new order that survives a reload', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const nav = page.getByRole('navigation', { name: 'Surface' });
        const order = () =>
            nav
                .locator('[data-nav-section]')
                .evaluateAll((sections) =>
                    sections.map((s) => s.getAttribute('data-nav-section')),
                );
        await expect
            .poll(order)
            .toEqual([
                'views',
                'chat',
                'document',
                'pull-request',
                'chart',
                'board',
                'video',
                'web',
                'image',
            ]);

        // Documents above Chats, by its grip.
        const documents = nav.locator('[data-nav-section="document"]');
        await documents.hover();
        const grip = (await documents
            .getByRole('button', { name: 'Move Documents section' })
            .boundingBox())!;
        const chats = (await nav
            .locator('[data-nav-section="chat"]')
            .boundingBox())!;
        const saved = posted(page, 'set-nav-order');
        await page.mouse.move(
            grip.x + grip.width / 2,
            grip.y + grip.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2, chats.y + 4, {
            steps: 10,
        });
        await page.mouse.up();
        const moved = [
            'views',
            'document',
            'chat',
            'pull-request',
            'chart',
            'board',
            'video',
            'web',
            'image',
        ];
        await expect.poll(order).toEqual(moved);

        // The keyboard moves them too: Boards up one, past Charts.
        await nav.getByRole('button', { name: 'Move Boards section' }).focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(100);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        await page.keyboard.press('Space');
        const final = [
            'views',
            'document',
            'chat',
            'pull-request',
            'board',
            'chart',
            'video',
            'web',
            'image',
        ];
        await expect.poll(order).toEqual(final);

        await saved;
        await page.reload();
        await waitForHydration(page);
        await expect.poll(order).toEqual(final);
    });

    test('nav sections collapse from their heading, and stay that way after a reload', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const nav = page.getByRole('navigation', { name: 'Surface' });
        const chats = nav.getByRole('region', { name: 'Chats' });
        const toggle = chats.getByRole('button', {
            name: 'Chats',
            exact: true,
        });
        const launch = chats.getByRole('link', { name: 'Launch crew' });

        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(launch).toBeVisible();
        const saved = posted(page, 'set-nav-collapsed');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(launch).toBeHidden();

        await saved;
        await page.reload();
        await waitForHydration(page);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(launch).toBeHidden();
        // Other sections stay open.
        await expect(
            nav.getByRole('region', { name: 'Documents' }).getByRole('link', {
                name: 'Atlas launch brief',
            }),
        ).toBeVisible();

        // Saving a view opens a collapsed Views section.
        const views = nav.getByRole('region', { name: 'Views' });
        await views.getByRole('button', { name: 'Views', exact: true }).click();
        await views.getByRole('button', { name: 'Save current view' }).click();
        await expect(
            views.getByRole('textbox', { name: 'View name' }),
        ).toBeVisible();
    });

    test('the nav and filter bar scroll without showing scrollbars', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        for (const element of [
            page.getByRole('navigation', { name: 'Surface' }),
            page.getByRole('toolbar', { name: 'Filter cards' }),
        ]) {
            await expect(element).toHaveCSS('scrollbar-width', 'none');
        }
    });

    test('agent-made windows say so, in the window and the nav', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const agentDoc = page.getByRole('article', {
            name: 'Document: Northwind SSO questions',
        });
        const humanDoc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        await expect(agentDoc.getByTitle('Made by an agent')).toBeVisible();
        await expect(humanDoc.getByTitle('Made by an agent')).toHaveCount(0);

        const nav = page.getByRole('navigation', { name: 'Surface' });
        await expect(
            nav
                .getByRole('link', { name: /Northwind SSO questions/ })
                .getByRole('img', { name: 'Made by an agent' }),
        ).toBeVisible();
        await expect(
            nav
                .getByRole('link', { name: /Atlas launch brief/ })
                .getByRole('img', { name: 'Made by an agent' }),
        ).toHaveCount(0);

        // And the filter can show only what agents made.
        await (
            await openFilters(page)
        )
            .getByRole('button', { name: 'By agent' })
            .click();
        await expect(page.locator('[data-node-id="doc-brief"]')).toHaveCSS(
            'opacity',
            '0.25',
        );
        await expect(page.locator('[data-node-id="doc-sso-notes"]')).toHaveCSS(
            'opacity',
            '1',
        );
    });

    test('charts draw under the chat and document they explain', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);

        for (const [chartTitle, parent] of [
            ['Beta signups this week', 'Chat: Launch crew'],
            ['Design partners by stage', 'Document: Atlas launch brief'],
        ] as const) {
            const chart = page.getByRole('article', {
                name: `Chart: ${chartTitle}`,
            });
            await expect(chart.locator('svg').last()).toBeVisible();
            const parentBox = (await page
                .getByLabel(parent, { exact: true })
                .boundingBox())!;
            const chartBox = (await chart.boundingBox())!;
            expect(Math.abs(chartBox.x - parentBox.x)).toBeLessThan(2);
            expect(chartBox.y).toBeGreaterThan(parentBox.y + parentBox.height);
        }
    });

    test('zoomed out, hovering a window names it, and clicking brings it to 100% just under the filter bar without focusing it', async ({
        authedPage: page,
    }) => {
        // A 1024px canvas: the 960px brief fits across, the 1120px board
        // doesn't.
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(SURFACE);
        await waitForHydration(page);
        const viewport = page.locator('.trellis__viewport');
        const scale = () =>
            viewport.evaluate(
                (el) => new DOMMatrix(getComputedStyle(el).transform).a,
            );
        // Out past reading size.
        async function zoomOut() {
            while ((await scale()) >= 0.55) {
                await page.getByRole('button', { name: 'Zoom out' }).click();
                await settledStyle(viewport);
            }
        }
        const canvas = (await page
            .getByRole('application', { name: 'Company surface' })
            .boundingBox())!;
        /** Where a window sits in the canvas: left, top, and width. */
        async function placement(article: Locator) {
            const b = (await article.boundingBox())!;
            return [
                Math.round(b.x - canvas.x),
                Math.round(b.y - canvas.y),
                Math.round(b.width),
            ];
        }

        await zoomOut();
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        const overlay = page.getByRole('button', {
            name: 'Zoom to Atlas launch brief',
        });
        await expect(overlay).toHaveCSS('opacity', '0');
        const box = (await doc.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(overlay).toHaveCSS('opacity', '1');
        await expect(overlay).toContainText('Atlas launch brief');

        await overlay.click();
        await expect.poll(scale).toBe(1);
        // Top 12px under the filter bar (which ends 50px down), centered
        // across.
        await expect
            .poll(() => placement(doc))
            .toEqual([Math.round((canvas.width - 960) / 2), 62, 960]);
        // Not focused: same URL, no Back to canvas, and at 100% the overlay
        // is gone.
        await expect(page).toHaveURL(SURFACE_URL);
        await expect(
            page.getByRole('link', { name: 'Back to canvas' }),
        ).toHaveCount(0);
        await expect(overlay).toHaveCount(0);

        // Wider than the canvas: the same 12px from the nav instead of cut
        // off behind it.
        await page.getByRole('button', { name: 'Fit to view' }).click();
        await settledStyle(viewport);
        await zoomOut();
        await page
            .getByRole('button', { name: 'Zoom to Atlas launch', exact: true })
            .click();
        await expect.poll(scale).toBe(1);
        await expect
            .poll(() =>
                placement(
                    page.getByRole('article', { name: 'Board: Atlas launch' }),
                ),
            )
            .toEqual([12, 62, 1120]);
    });

    test('documents link to other items inline and embed them as cards', async ({
        authedPage: page,
    }) => {
        // On the canvas, documents are read-only: chips and cards are links.
        await page.goto(SURFACE);
        await waitForHydration(page);
        await zoomToWindow(page, 'Atlas launch brief');
        const doc = page.getByRole('article', {
            name: 'Document: Atlas launch brief',
        });
        await expect(doc.locator('strong').first()).toHaveText(
            'one shared view',
        );
        const card = doc.getByRole('link', { name: 'Board: Atlas launch' });
        await expect(card).toContainText(/\d+ issues/);
        await expect(card).toHaveAttribute(
            'href',
            `${SURFACE}/cards/board-atlas`,
        );

        await doc.getByRole('link', { name: "Northwind's questions" }).click();
        await expect(page).toHaveURL(/\/cards\/doc-sso-notes$/);
        // Focused, it's the editor: chips stay chips, but are text to edit.
        await expect(
            page
                .getByRole('textbox', { name: 'Edit Northwind SSO questions' })
                .locator('[data-item-ref="pr-sso-flag"]'),
        ).toHaveText('#485');
    });

    test('a focused document is editable: Markdown typing, @ links, / embeds, autosave, and conflicts', async ({
        authedPage: page,
    }) => {
        // One editor document, reused across runs so the canvas doesn't
        // grow a window per run (the store outlives a reused server).
        const title = 'Editor test';
        const items: { id: string; title: string }[] = await mcp(
            page,
            'list_cards',
            {},
        );
        const docId =
            items.find((item) => item.title === title)?.id ??
            (
                await mcp(page, 'create_document', {
                    surfaceId: SURFACE_ID,
                    title,
                })
            ).id;
        const markdown = async () =>
            (await mcp(page, 'get_card', { itemId: docId })).markdown;

        await page.goto(`${SURFACE}/cards/${docId}`);
        await waitForHydration(page);
        const editor = page.getByRole('textbox', { name: `Edit ${title}` });
        await editor.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');

        await page.keyboard.type('## Plan');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Ask **Rosa** and @lau');
        const picker = page.getByRole('listbox', { name: 'Link an item' });
        await expect(
            picker.getByRole('option', { name: /Launch crew/ }),
        ).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(picker).toHaveCount(0);
        await page.keyboard.type('today');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/rosa');
        await page
            .getByRole('listbox', { name: 'Insert' })
            .getByRole('option', { name: /Rosa Alvarez/ })
            .click();
        await expect(
            editor.getByLabel('Chat: Rosa Alvarez', { exact: true }),
        ).toBeVisible();

        // Saved a moment later, as agents read it.
        await expect
            .poll(markdown, { timeout: 10_000 })
            .toBe(
                '## Plan\n\nAsk **Rosa** and [Launch crew](item:chat-launch) today\n\n![](item:chat-customers)',
            );
        await expect(page.getByRole('status').getByText('Saved')).toBeVisible();

        // An agent writes while the document is open: say so, and load it.
        await mcp(page, 'append_to_document', {
            documentId: docId,
            markdown: 'Agent line',
        });
        const alert = page.getByRole('alert').filter({
            hasText: 'Someone else changed this document',
        });
        await expect(alert).toBeVisible();
        await alert.getByRole('button', { name: 'Load their version' }).click();
        await expect(editor.getByText('Agent line')).toBeVisible();
        await expect(alert).toHaveCount(0);
    });

    test('videos play YouTube, and web pages browse with an address bar that saves', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE + '/cards/video-launch');
        await waitForHydration(page);
        await expect(
            page
                .getByRole('article', {
                    name: 'Video: How Apple launched the iPhone',
                })
                .locator('iframe'),
        ).toHaveAttribute(
            'src',
            'https://www.youtube-nocookie.com/embed/MnrJzXM7a6o?rel=0',
        );

        await page.goto(SURFACE + '/cards/web-launch-guide');
        await waitForHydration(page);
        const web = page.getByRole('article', {
            name: 'Web page: Product launch (Wikipedia)',
        });
        const original = 'https://en.wikipedia.org/wiki/Product_launch';
        await expect(web.locator('iframe')).toHaveAttribute('src', original);
        // Focused, the page takes clicks (on the canvas it waits for one).
        await expect(web.locator('iframe')).not.toHaveCSS(
            'pointer-events',
            'none',
        );

        const address = web.getByRole('textbox', { name: 'Web address' });
        await address.fill('http://example.com');
        await expect(address).toHaveAttribute('aria-invalid', 'true');
        await address.fill('example.com');
        const saved = posted(page, 'navigate-web');
        await address.press('Enter');
        await expect(web.locator('iframe')).toHaveAttribute(
            'src',
            'https://example.com/',
        );
        await saved;
        expect(
            (await mcp(page, 'get_card', { itemId: 'web-launch-guide' })).url,
        ).toBe('https://example.com/');

        // Put it back: the store is shared.
        await mcp(page, 'navigate_web_page', {
            webId: 'web-launch-guide',
            url: original,
        });
    });

    test('image windows show pictures, with animated GIFs labeled', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const photo = page.getByRole('article', {
            name: 'Image: The first iPhone',
        });
        const gif = page.getByRole('article', {
            name: 'GIF: Launch day, everywhere',
        });
        await expect(photo.locator('img')).toHaveAttribute(
            'alt',
            /original iPhone/,
        );
        await expect(gif.getByText('GIF', { exact: true })).toBeVisible();
        await expect(photo.getByText('GIF', { exact: true })).toHaveCount(0);
        await expect(
            page
                .getByRole('navigation', { name: 'Surface' })
                .getByRole('region', { name: 'Images' })
                .getByRole('link'),
        ).toHaveCount(2);
    });

    test('Duplicate copies a window next to the original; pull requests have no Duplicate', async ({
        authedPage: page,
    }) => {
        // A chart of its own to copy, so other tests' windows stay as seeded.
        const chart = await mcp(page, 'create_chart', {
            attachedTo: 'doc-brief',
            title: `Copy me ${Date.now()}`,
            chart: 'bar',
            unit: 'things',
            points: [
                { label: 'A', value: 1 },
                { label: 'B', value: 2 },
            ],
        });
        await page.goto(SURFACE);
        await waitForHydration(page);
        // With the whole canvas in view, every window's buttons are in the
        // page (hidden until hover): a pull request has no Duplicate.
        await expect(
            page.getByRole('button', { name: 'Bring #482 to front' }),
        ).toHaveCount(1);
        await expect(
            page.getByRole('button', { name: 'Duplicate #482' }),
        ).toHaveCount(0);
        await zoomToWindow(page, chart.title);
        const original = page.getByRole('article', {
            name: `Chart: ${chart.title}`,
            exact: true,
        });
        await revealControls(original);
        await page
            .getByRole('button', { name: `Duplicate ${chart.title}` })
            .click();

        const copy = page.getByRole('article', {
            name: `Chart: ${chart.title} (copy)`,
        });
        await expect(copy).toBeVisible();
        // Down and right of the original, by the same amount both ways
        // (measured once the copy has faded in at full size).
        await expect
            .poll(async () => {
                const a = (await original.boundingBox())!;
                const b = (await copy.boundingBox())!;
                return b.x > a.x && Math.abs(b.x - a.x - (b.y - a.y)) < 2;
            })
            .toBe(true);
    });

    test('⌘K search finds a message, zooms to its chat, and ⌘Enter focuses instead', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', {
            name: 'Search the surface',
        });
        const input = palette.getByRole('combobox', { name: 'Search' });
        await expect(input).toBeFocused();
        await input.pressSequentially('call the 6th', { delay: 20 });
        await expect(input).toBeFocused();
        const hit = palette.getByRole('option', { name: /Launch crew/ });
        await expect(hit).toContainText('freeze');
        await page.keyboard.press('Enter');

        // Zoomed to 100%, not focused, with the message in view.
        await expect(palette).toHaveCount(0);
        await expect(page).toHaveURL(SURFACE_URL);
        const viewport = page.locator('.trellis__viewport');
        await expect
            .poll(() =>
                viewport.evaluate(
                    (el) => new DOMMatrix(getComputedStyle(el).transform).a,
                ),
            )
            .toBe(1);
        await expect(
            page
                .getByRole('region', { name: 'Chat: Launch crew' })
                .getByText("Let's call the 6th the freeze"),
        ).toBeInViewport();

        // ⌘Enter focuses the item.
        await page.getByRole('button', { name: 'Search' }).first().click();
        await palette.getByRole('combobox', { name: 'Search' }).fill('ATL-13');
        await expect(
            palette.getByRole('option', { name: /Atlas launch/ }),
        ).toContainText('ATL-13');
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(page).toHaveURL(/\/cards\/board-atlas$/);
    });

    test('searching from the filter bar dims what it does not find, in the URL', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        await openFilters(page);
        const search = page.getByRole('searchbox', { name: 'Search cards' });
        // Key by key, as a person types: each keystroke updates the URL, and
        // the field must keep focus through all of them.
        await search.click();
        await search.pressSequentially('northwind', { delay: 30 });
        await expect(search).toBeFocused();
        await expect(search).toHaveValue('northwind');
        await expect(page).toHaveURL(/\?q=northwind$/);
        const opacity = (id: string) =>
            page
                .locator(`[data-node-id="${id}"]`)
                .evaluate((el) => getComputedStyle(el).opacity);
        await expect.poll(() => opacity('doc-sso-notes')).toBe('1');
        await expect.poll(() => opacity('chart-signups')).not.toBe('1');

        // Kept on reload (the folded bar says a filter is on); All clears it.
        await page.reload();
        await waitForHydration(page);
        await expect(
            page
                .getByRole('toolbar', { name: 'Filter cards' })
                .getByRole('button', { name: /^Filter 1 on/ }),
        ).toBeVisible();
        await expect.poll(() => opacity('chart-signups')).not.toBe('1');
        const bar = await openFilters(page);
        await expect(search).toHaveValue('northwind');
        await bar.getByRole('button', { name: 'All' }).click();
        await expect(page).toHaveURL(SURFACE_URL);
        await expect(search).toHaveValue('');
        await expect.poll(() => opacity('chart-signups')).toBe('1');
    });

    test('an unknown item answers 404 and offers a way back', async ({
        authedPage: page,
    }) => {
        const response = await page.goto(SURFACE + '/cards/not-a-thing');
        expect(response?.status()).toBe(404);
        await expect(
            page
                .getByRole('alert')
                .getByText('That card is not on this surface.'),
        ).toBeVisible();
        await expect(
            page.getByRole('application', { name: 'Company surface' }),
        ).toBeVisible();
    });

    test('a sent message gets a mock reply', async ({ authedPage: page }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const chat = page.getByRole('region', { name: 'Chat: Launch crew' });
        const messages = chat.getByRole('list', { name: 'Messages' });
        const before = await messages.getByRole('listitem').count();
        await zoomToWindow(page, 'Launch crew');

        await chat
            .getByRole('textbox', { name: 'Message Launch crew' })
            .fill('Can we move the beta up a week?');
        await chat.getByRole('button', { name: 'Send' }).click();

        await expect(
            messages.getByText('Can we move the beta up a week?'),
        ).toBeVisible();
        await expect(messages.getByRole('listitem')).toHaveCount(before + 2);
    });
});
