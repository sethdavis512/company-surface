import { test, expect, waitForHydration } from './fixtures';

test.describe('Spaces and surfaces', () => {
    test('home lists spaces and their surfaces, and each surface has its own cards', async ({
        authedPage: page,
    }) => {
        await page.goto('/');
        await waitForHydration(page);
        await expect(
            page.getByRole('heading', { name: 'Spaces', level: 1 }),
        ).toBeVisible();
        const customers = page.getByRole('region', { name: 'Customers' });
        await customers.getByRole('link', { name: /Northwind/ }).click();

        await expect(page).toHaveURL(/\/surfaces\/northwind$/);
        await expect(page).toHaveTitle(/^Northwind \|/);
        await expect(
            page.getByRole('article', {
                name: 'Document: Northwind account plan',
            }),
        ).toBeVisible();
        // Atlas launch's cards are on their own surface, not this one.
        await expect(
            page.getByRole('article', { name: 'Document: Atlas launch brief' }),
        ).toHaveCount(0);

        // The switcher says where you are and jumps to another surface.
        const switcher = page.getByRole('button', {
            name: 'Surface: Northwind, in Customers. Switch surface',
        });
        await switcher.click();
        await page.getByRole('menuitem', { name: 'Atlas launch' }).click();
        await expect(page).toHaveURL(/\/surfaces\/atlas-launch$/);
        await expect(
            page.getByRole('article', { name: 'Document: Atlas launch brief' }),
        ).toBeVisible();
    });

    test('a new surface opens with a chat with the agent, ready for cards', async ({
        authedPage: page,
    }) => {
        const name = `Planning ${Date.now()}`;
        await page.goto('/');
        await waitForHydration(page);
        const product = page.getByRole('region', { name: 'Product' });
        await product.getByRole('button', { name: 'New surface' }).click();
        await product.getByRole('textbox', { name: 'Surface name' }).fill(name);
        await product.getByRole('button', { name: 'Create' }).click();

        await expect(page).toHaveURL(/\/surfaces\/surface-[\w-]+$/);
        await expect(page).toHaveTitle(new RegExp(`^${name} \\|`));
        await expect(
            page.getByRole('button', {
                name: `Surface: ${name}, in Product. Switch surface`,
            }),
        ).toBeVisible();
        await expect(page.locator('[data-node-id]')).toHaveCount(1);
        await expect(
            page.getByRole('region', { name: 'Chat: Ask the agent' }),
        ).toBeVisible();
    });

    test('an unknown surface answers 404 with a way home', async ({
        authedPage: page,
    }) => {
        const response = await page.goto('/surfaces/not-a-surface');
        expect(response?.status()).toBe(404);
        await expect(
            page.getByText('That surface does not exist.'),
        ).toBeVisible();
        await page.getByRole('link', { name: 'All spaces' }).click();
        await expect(page).toHaveURL(/\/$/);
    });
});
