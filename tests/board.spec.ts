import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForHydration, createFreshUser } from './fixtures';

/** The seeded surface every card here is on. */
const SURFACE_ID = 'atlas-launch';
const SURFACE = `/surfaces/${SURFACE_ID}`;

/**
 * Issue boards. The tests share one board they make over MCP (one extra
 * board per run: every board widens the shared canvas, and a crowded canvas
 * opens zoomed too far out for the other specs to click). They run in
 * order, and each tags its own issues and only looks at those.
 */
test.describe.configure({ mode: 'serial' });

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

let shared: { id: string; title: string } | null = null;

/**
 * The shared board, with these issues added to Todo (top to bottom), each
 * titled "<tag> <title>" so a test can pick out its own.
 */
async function boardWith(page: Page, titles: string[]) {
    if (!shared) {
        const board = await mcp(page, 'create_board', {
            surfaceId: SURFACE_ID,
            title: `E2E board ${crypto.randomUUID().slice(0, 8)}`,
            key: 'EB',
        });
        shared = { id: board.id, title: board.title };
    }
    const tag = crypto.randomUUID().slice(0, 6);
    for (const title of titles) {
        await mcp(page, 'create_issue', {
            boardId: shared.id,
            title: `${tag} ${title}`,
            status: 'todo',
        });
    }
    return { ...shared, tag };
}

/** Waits until the board stops moving (the canvas flies and resizes it). */
async function settled(window: Locator) {
    let last = JSON.stringify(await window.boundingBox());
    for (let attempt = 0; attempt < 20; attempt++) {
        await window.page().waitForTimeout(250);
        const next = JSON.stringify(await window.boundingBox());
        if (next === last) return;
        last = next;
    }
    throw new Error('The board never settled');
}

/** One key, then a pause long enough for issues to animate into place. */
async function press(page: Page, key: string) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
}

function boardWindow(page: Page, title: string) {
    return page.getByRole('article', { name: `Board: ${title}` });
}

function column(window: Locator, name: string) {
    return window.getByRole('region', { name, exact: true });
}

/** A test's own issues in a column, top to bottom, by title (tag dropped). */
async function order(window: Locator, name: string, tag: string) {
    return column(window, name)
        .getByRole('button', { name: new RegExp(`^Move .* ${tag} `) })
        .evaluateAll(
            (issues, tagged) =>
                issues.map((issue) =>
                    issue
                        .getAttribute('aria-label')!
                        .split(` ${tagged} `)[1]!
                        .trim(),
                ),
            tag,
        );
}

/** A test's issue's drag handle ("Move <id> <title>"), by title. */
function issueHandle(window: Locator, tag: string, title: string) {
    return window.getByRole('button', {
        name: new RegExp(`^Move .* ${tag} ${title}$`),
    });
}

/** The whole issue, by title. */
function issueBody(window: Locator, tag: string, title: string) {
    return window.getByRole('listitem', {
        name: new RegExp(` ${tag} ${title}$`),
    });
}

function centerOf(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Issue boards', () => {
    test('the mouse drags an issue to another column at the canvas zoom, with the issue under the pointer', async ({
        authedPage: page,
    }) => {
        const board = await boardWith(page, ['Mouse me', 'Stay']);
        // A view that frames just this board, then one step out: the board is
        // drawn scaled, not at actual size, which the overlay must match.
        const view = await mcp(page, 'save_view', {
            surfaceId: SURFACE_ID,
            name: `Frame ${board.tag}`,
            itemIds: [board.id],
        });
        await page.goto(`${SURFACE}/views/${view.id}`);
        await waitForHydration(page);
        await page.getByRole('button', { name: 'Zoom out' }).click();
        const window = boardWindow(page, board.title);
        const handle = issueHandle(window, board.tag, 'Mouse me');
        await expect(handle).toBeVisible();
        await settled(window);
        const scale = await page
            .locator('.trellis__viewport')
            .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
        expect(Math.abs(scale - 1)).toBeGreaterThan(0.05);

        const body = (await issueBody(
            window,
            board.tag,
            'Mouse me',
        ).boundingBox())!;
        const to = (await column(window, 'In Review').boundingBox())!;
        const start = centerOf((await handle.boundingBox())!);
        const end = { x: to.x + to.width / 2, y: to.y + 60 };

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 10, start.y + 10, { steps: 4 });
        await page.mouse.move(end.x, end.y, { steps: 12 });

        // The lifted copy is drawn at the canvas's scale, under the pointer,
        // and every column outlines itself as a target.
        const lifted = page.locator('body > div div.rotate-1.shadow-lg');
        await expect(lifted).toHaveCount(1);
        const liftedBox = (await lifted.boundingBox())!;
        expect(Math.abs(liftedBox.width - body.width)).toBeLessThan(6);
        expect(end.x).toBeGreaterThan(liftedBox.x);
        expect(end.x).toBeLessThan(liftedBox.x + liftedBox.width);

        await page.mouse.up();
        await expect
            .poll(() => order(window, 'In Review', board.tag))
            .toEqual(['Mouse me']);
        await expect
            .poll(() => order(window, 'Todo', board.tag))
            .toEqual(['Stay']);
        await mcp(page, 'delete_view', { viewId: view.id });
    });

    test('an issue dropped between two others lands between them, where the line shows', async ({
        authedPage: page,
    }) => {
        const board = await boardWith(page, ['Top', 'Middle', 'Bottom']);
        await page.goto(`${SURFACE}/cards/${board.id}`);
        await waitForHydration(page);
        const window = boardWindow(page, board.title);
        await settled(window);

        // Carry Bottom up so its middle sits in the gap between Top and
        // Middle: the line should appear there, and it should land there.
        const top = (await issueBody(window, board.tag, 'Top').boundingBox())!;
        const middle = (await issueBody(
            window,
            board.tag,
            'Middle',
        ).boundingBox())!;
        const bottomBody = (await issueBody(
            window,
            board.tag,
            'Bottom',
        ).boundingBox())!;
        const handle = (await issueHandle(
            window,
            board.tag,
            'Bottom',
        ).boundingBox())!;
        const grab = centerOf(handle);
        const gapY = (top.y + top.height + middle.y) / 2;
        // Move so the issue's center (not the pointer) reaches the gap.
        const target = {
            x: grab.x,
            y: gapY - (bottomBody.y + bottomBody.height / 2 - grab.y),
        };

        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x, grab.y - 8, { steps: 3 });
        await page.mouse.move(target.x, target.y, { steps: 10 });

        // Nothing else moved, and the line sits between Top and Middle.
        expect(
            (await issueBody(window, board.tag, 'Middle').boundingBox())!.y,
        ).toBeCloseTo(middle.y, 0);
        const line = column(window, 'Todo').locator(
            'li[aria-hidden="true"] span',
        );
        await expect(line).toHaveCount(1);
        const lineY = (await line.boundingBox())!.y;
        expect(lineY).toBeGreaterThan(top.y + top.height - 4);
        expect(lineY).toBeLessThan(middle.y + 4);

        await page.mouse.up();
        await expect
            .poll(() => order(window, 'Todo', board.tag))
            .toEqual(['Top', 'Bottom', 'Middle']);
        await page.reload();
        await expect
            .poll(() => order(window, 'Todo', board.tag))
            .toEqual(['Top', 'Bottom', 'Middle']);
    });

    test('the keyboard reorders a column and moves an issue across, and it all saves', async ({
        authedPage: page,
    }) => {
        const board = await boardWith(page, ['First', 'Second', 'Third']);
        await page.goto(`${SURFACE}/cards/${board.id}`);
        await waitForHydration(page);
        const window = boardWindow(page, board.title);
        await settled(window);

        // Space picks up, arrows move, Space drops. First goes below its two
        // siblings (any other tests' issues in Todo sit above them).
        await issueHandle(window, board.tag, 'First').focus();
        await press(page, 'Space');
        await press(page, 'ArrowDown');
        await press(page, 'ArrowDown');
        await press(page, 'Space');
        await expect
            .poll(() => order(window, 'Todo', board.tag))
            .toEqual(['Second', 'Third', 'First']);

        await issueHandle(window, board.tag, 'Second').focus();
        await press(page, 'Space');
        await press(page, 'ArrowRight');
        await press(page, 'Space');
        await expect
            .poll(() => order(window, 'In Progress', board.tag))
            .toEqual(['Second']);

        await page.reload();
        await expect
            .poll(() => order(window, 'Todo', board.tag))
            .toEqual(['Third', 'First']);
        await expect
            .poll(() => order(window, 'In Progress', board.tag))
            .toEqual(['Second']);
    });

    test('a press-and-hold drag works on touch', async ({
        browser,
    }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Touch is driven through the Chrome DevTools protocol.',
        );
        const baseURL = testInfo.project.use.baseURL!;
        const context = await browser.newContext({ baseURL, hasTouch: true });
        await createFreshUser(context, baseURL, 'touch');
        const page = await context.newPage();
        const board = await boardWith(page, ['Touch me']);
        await page.goto(`${SURFACE}/cards/${board.id}`);
        await waitForHydration(page);
        const window = boardWindow(page, board.title);
        await settled(window);

        // Raw touch events don't scroll the way Playwright's clicks do, and
        // the shared board's Todo column may have scrolled this issue away.
        await issueHandle(
            window,
            board.tag,
            'Touch me',
        ).scrollIntoViewIfNeeded();
        const start = centerOf(
            (await issueHandle(window, board.tag, 'Touch me').boundingBox())!,
        );
        const to = (await column(window, 'Done').boundingBox())!;
        const end = { x: to.x + to.width / 2, y: to.y + 40 };

        const cdp = await context.newCDPSession(page);
        const touch = (
            type: 'touchStart' | 'touchMove' | 'touchEnd',
            point?: { x: number; y: number },
        ) =>
            cdp.send('Input.dispatchTouchEvent', {
                type,
                touchPoints: point
                    ? [{ x: Math.round(point.x), y: Math.round(point.y) }]
                    : [],
            });

        await touch('touchStart', start);
        // The handle drags at once on touch (no press delay); a short pause
        // just lets the browser settle the touch.
        await page.waitForTimeout(50);
        for (let step = 1; step <= 12; step++) {
            await touch('touchMove', {
                x: start.x + ((end.x - start.x) * step) / 12,
                y: start.y + ((end.y - start.y) * step) / 12,
            });
        }
        await touch('touchEnd');

        await expect
            .poll(() => order(window, 'Done', board.tag))
            .toEqual(['Touch me']);
        await context.close();
    });

    test('the status menu moves an issue, and a column takes a new issue', async ({
        authedPage: page,
    }) => {
        const board = await boardWith(page, ['Menu me']);
        await page.goto(`${SURFACE}/cards/${board.id}`);
        await waitForHydration(page);
        const window = boardWindow(page, board.title);
        await expect(window.getByTitle('Made by an agent')).toBeVisible();

        const menuIssue = issueHandle(window, board.tag, 'Menu me');
        const identifier = (await menuIssue.getAttribute('aria-label'))!.split(
            ' ',
        )[1];
        await window
            .getByRole('button', { name: `Status of ${identifier}: Todo` })
            .click();
        await page.getByRole('menuitemradio', { name: 'Done' }).click();
        await expect
            .poll(() => order(window, 'Done', board.tag))
            .toEqual(['Menu me']);

        await window
            .getByRole('button', { name: 'New issue in Backlog' })
            .click();
        const field = window.getByRole('textbox', {
            name: 'New issue title in Backlog',
        });
        await field.fill(`${board.tag} Fresh idea`);
        await field.press('Enter');
        await expect
            .poll(() => order(window, 'Backlog', board.tag))
            .toEqual(['Fresh idea']);
    });
});
