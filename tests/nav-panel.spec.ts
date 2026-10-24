import type { Page } from '@playwright/test';
import { test, expect, waitForHydration } from './fixtures';

const SURFACE = '/surfaces/atlas-launch';

function navWidth(page: Page) {
    return page
        .locator('[data-panel][id="surface-nav"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

test.describe('Left nav panel', () => {
    test('collapses to an icon rail that still gets you around, and stays that way', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        expect(await navWidth(page)).toBe(256);

        await page.getByRole('button', { name: 'Collapse navigation' }).click();
        await expect.poll(() => navWidth(page)).toBe(56);
        const rail = page.getByRole('navigation', { name: 'Surface' });
        await rail
            .getByRole('link', { name: 'Document: Atlas launch brief' })
            .click();
        await expect(page).toHaveURL(/\/cards\/doc-brief$/);

        // Rendered collapsed by the server on the next visit.
        await page.goto(SURFACE);
        await waitForHydration(page);
        expect(await navWidth(page)).toBe(56);
        await page.getByRole('button', { name: 'Expand navigation' }).click();
        await expect.poll(() => navWidth(page)).toBe(256);
        await expect(
            page.getByRole('button', { name: /^Surface: Atlas launch/ }),
        ).toBeVisible();
    });

    test('drags wider, remembers it, and collapses when dragged narrow', async ({
        authedPage: page,
    }) => {
        await page.goto(SURFACE);
        await waitForHydration(page);
        const handle = page.getByRole('separator', {
            name: 'Resize the navigation',
        });
        const box = (await handle.boundingBox())!;
        const y = box.y + box.height / 2;

        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => navWidth(page)).toBe(356);

        await page.reload();
        await waitForHydration(page);
        expect(await navWidth(page)).toBe(356);

        // Past the minimum, it snaps to the rail.
        const wide = (await handle.boundingBox())!;
        await page.mouse.move(wide.x + wide.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(wide.x - 320, y, { steps: 10 });
        await page.mouse.up();
        await expect.poll(() => navWidth(page)).toBe(56);
        await expect(
            page.getByRole('button', { name: 'Expand navigation' }),
        ).toBeVisible();
    });
});
