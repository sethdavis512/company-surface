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

/** A surface of the test's own, so adding cards never touches the seed. */
async function openFreshSurface(page: Page) {
    const surface = await mcp(page, 'create_surface', {
        spaceId: 'product',
        name: `Fresh ${crypto.randomUUID().slice(0, 6)}`,
    });
    await page.goto(`/surfaces/${surface.id}`);
    await waitForHydration(page);
    return surface as { id: string };
}

async function addFromMenu(page: Page, item: string) {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
}

test.describe('Adding cards', () => {
    test('Add card puts a chat in the middle of what you are looking at', async ({
        authedPage: page,
    }) => {
        await openFreshSurface(page);
        await addFromMenu(page, 'Chat');

        const chat = page.getByRole('region', { name: 'Chat: New chat' });
        await expect(chat).toBeVisible();
        const canvas = (await page
            .getByRole('application', { name: 'Company surface' })
            .boundingBox())!;
        await expect
            .poll(async () => {
                const box = (await chat.boundingBox())!;
                return Math.round(
                    Math.abs(
                        box.x + box.width / 2 - (canvas.x + canvas.width / 2),
                    ),
                );
            })
            .toBeLessThan(3);
        await expect(
            page
                .getByRole('navigation', { name: 'Surface' })
                .getByRole('link', { name: 'New chat' }),
        ).toBeVisible();
    });

    test('a new document opens in the editor, ready to type in', async ({
        authedPage: page,
    }) => {
        await openFreshSurface(page);
        await addFromMenu(page, 'Document');

        await expect(page).toHaveURL(/\/cards\/doc-[\w-]+$/);
        const editor = page.getByRole('textbox', {
            name: 'Edit Untitled document',
        });
        await expect(editor).toBeFocused();
        await page.keyboard.type('First thoughts');
        await expect(editor).toContainText('First thoughts');
    });

    test('images, videos, and pages ask for an address and check it first', async ({
        authedPage: page,
    }) => {
        await openFreshSurface(page);
        await addFromMenu(page, 'Image…');

        const dialog = page.getByRole('dialog', { name: 'Add an image' });
        const address = dialog.getByRole('textbox', { name: 'Image address' });
        await address.fill('http://example.com/spin.gif');
        await dialog.getByRole('button', { name: 'Add' }).click();
        await expect(
            dialog.getByText("That isn't an https address."),
        ).toBeVisible();

        await address.fill('https://example.com/spin.gif');
        await dialog
            .getByRole('textbox', { name: 'Title (optional)' })
            .fill('Spinner');
        await dialog.getByRole('button', { name: 'Add' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(
            page.getByRole('article', { name: 'GIF: Spinner' }),
        ).toBeVisible();
    });

    test('Add to hangs a chart and a draft pull request under a chat', async ({
        authedPage: page,
    }) => {
        // Tall enough that the new chat's header clears the filter bar.
        await page.setViewportSize({ width: 1280, height: 1000 });
        await openFreshSurface(page);
        await addFromMenu(page, 'Chat');
        const chat = page.getByRole('region', { name: 'Chat: New chat' });
        await expect(chat).toBeVisible();

        await chat.locator('header').first().hover({ force: true });
        await page.getByRole('button', { name: 'Add to New chat' }).click();
        await page.getByRole('menuitem', { name: 'Chart' }).click();
        const chart = page.getByRole('article', { name: 'Chart: New chart' });
        await expect(chart).toBeVisible();

        await chat.locator('header').first().hover({ force: true });
        await page.getByRole('button', { name: 'Add to New chat' }).click();
        await page.getByRole('menuitem', { name: 'Pull request' }).click();
        await expect(
            page.getByRole('article', {
                name: /^Pull request: #\d+ New change$/,
            }),
        ).toBeVisible();

        // Both hang under the chat, in its column.
        const chatBox = (await chat.boundingBox())!;
        const chartBox = (await chart.boundingBox())!;
        expect(Math.abs(chartBox.x - chatBox.x)).toBeLessThan(2);
        expect(chartBox.y).toBeGreaterThan(chatBox.y + chatBox.height);
    });

    test('⌘K adds cards too', async ({ authedPage: page }) => {
        await openFreshSurface(page);
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', {
            name: 'Search the surface',
        });
        await palette
            .getByRole('combobox', { name: 'Search' })
            .pressSequentially('add board', { delay: 20 });
        await palette.getByRole('option', { name: 'Add board' }).click();
        await expect(palette).toHaveCount(0);
        await expect(
            page.getByRole('article', { name: 'Board: New board' }),
        ).toBeVisible();
    });
});
