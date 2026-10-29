import type { Page } from '@playwright/test';
import { test, expect, waitForHydration } from './fixtures';

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

/** A surface of the test's own, so nothing here touches the seed. */
async function openFreshSurface(page: Page) {
    const surface = await mcp(page, 'create_surface', {
        spaceId: 'design',
        name: `Canvas ${crypto.randomUUID().slice(0, 6)}`,
    });
    // A new surface starts with a chat with the agent; this test wants an
    // empty canvas.
    for (const card of await mcp(page, 'list_cards', {
        surfaceId: surface.id,
    })) {
        await mcp(page, 'delete_card', { itemId: card.id });
    }
    await page.goto(`/surfaces/${surface.id}`);
    await waitForHydration(page);
    return surface as { id: string };
}

/** Right-clicks empty canvas at a point inside it. */
async function rightClickCanvas(page: Page, fx = 0.6, fy = 0.6) {
    const canvas = (await page
        .getByRole('application', { name: 'Company surface' })
        .boundingBox())!;
    const point = {
        x: canvas.x + canvas.width * fx,
        y: canvas.y + canvas.height * fy,
    };
    await page.mouse.click(point.x, point.y, { button: 'right' });
    return point;
}

test.describe('Canvas extras', () => {
    test('a sticky note takes typing and keeps it', async ({
        authedPage: page,
    }) => {
        await openFreshSurface(page);
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Sticky note' }).click();

        const note = page.getByRole('article', {
            name: 'Sticky note: Empty note',
        });
        await expect(note).toBeVisible();
        // It arrived while the surface was open, so it fades in.
        await expect(
            page.locator('[data-node-id^="note-"]').first(),
        ).toHaveClass(/animate-card-in/);

        const text = note.getByRole('textbox');
        await text.click();
        await text.pressSequentially('Ship it Friday', { delay: 15 });
        await text.blur();
        await expect(
            page.getByRole('article', { name: 'Sticky note: Ship it Friday' }),
        ).toBeVisible();

        await page.reload();
        await waitForHydration(page);
        await expect(
            page
                .getByRole('article', { name: 'Sticky note: Ship it Friday' })
                .getByRole('textbox'),
        ).toHaveValue('Ship it Friday');
    });

    test('the filter bar stays folded until used, and says when it is filtering', async ({
        authedPage: page,
    }) => {
        await page.goto('/surfaces/atlas-launch');
        await waitForHydration(page);
        const bar = page.getByRole('toolbar', { name: 'Filter cards' });
        await expect(bar.getByRole('button', { name: 'Filter' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'All' })).toHaveCount(0);

        await bar.hover();
        await bar.getByRole('button', { name: 'Charts' }).click();
        // Pointer and focus leave: it folds, and the pill says one is on.
        await page.mouse.move(5, 5);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await expect(
            bar.getByRole('button', { name: /^Filter 1 on · 2 of \d+/ }),
        ).toBeVisible();
    });

    test('right-clicking empty canvas zooms and adds a card right there', async ({
        authedPage: page,
    }) => {
        await openFreshSurface(page);
        const viewport = page.locator('.trellis__viewport');
        const scale = () =>
            viewport.evaluate(
                (el) => new DOMMatrix(getComputedStyle(el).transform).a,
            );

        await rightClickCanvas(page);
        await page.getByRole('menuitem', { name: 'Zoom out' }).click();
        await expect.poll(scale).toBeLessThan(1);
        await rightClickCanvas(page);
        await page.getByRole('menuitem', { name: 'Zoom to 100%' }).click();
        await expect.poll(scale).toBe(1);

        const point = await rightClickCanvas(page, 0.3, 0.6);
        await page.getByRole('menuitem', { name: 'Add here' }).hover();
        await page.getByRole('menuitem', { name: 'Chat' }).click();
        const chat = page.getByRole('region', { name: 'Chat: New chat' });
        await expect(chat).toBeVisible();
        await expect
            .poll(async () => {
                const box = (await chat.boundingBox())!;
                return Math.round(
                    Math.abs(box.x + box.width / 2 - point.x) +
                        Math.abs(box.y + box.height / 2 - point.y),
                );
            })
            .toBeLessThan(4);

        // On a card, the browser keeps its own menu.
        await chat.click({ button: 'right', position: { x: 60, y: 200 } });
        await expect(
            page.getByRole('menuitem', { name: 'Zoom in' }),
        ).toHaveCount(0);
    });

    test('double-clicking a card header focuses it; double-clicking its body does not', async ({
        authedPage: page,
    }) => {
        await page.setViewportSize({ width: 1400, height: 1000 });
        await page.goto('/surfaces/launch-retro');
        await waitForHydration(page);
        // Zoomed in to reading size first, as a person would be (zoomed
        // out, a click on a card zooms to it instead).
        const overlay = page.getByRole('button', {
            name: 'Zoom to Launch retro notes',
        });
        await overlay.focus();
        await page.keyboard.press('Enter');
        await expect(overlay).toHaveCount(0);
        const doc = page.getByRole('article', {
            name: 'Document: Launch retro notes',
        });
        await doc.locator('.prose').dblclick();
        await expect(page).toHaveURL(/\/surfaces\/launch-retro$/);

        await doc.locator('header').dblclick();
        await expect(page).toHaveURL(
            /\/surfaces\/launch-retro\/cards\/doc-retro-notes$/,
        );
    });
});
