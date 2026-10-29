import type { Locator, Page } from '@playwright/test';
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
async function freshSurface(page: Page) {
    const surface = await mcp(page, 'create_surface', {
        spaceId: 'design',
        name: `Controls ${crypto.randomUUID().slice(0, 6)}`,
    });
    // A new surface starts with a chat with the agent; this test wants an
    // empty canvas.
    for (const card of await mcp(page, 'list_cards', {
        surfaceId: surface.id,
    })) {
        await mcp(page, 'delete_card', { itemId: card.id });
    }
    return surface as { id: string };
}

async function center(locator: Locator) {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where a card's node sits on the canvas (its transform). */
function nodePosition(page: Page, id: string) {
    return page
        .locator(`[data-node-id="${id}"]`)
        .evaluate((el) => (el as HTMLElement).style.transform);
}

test.describe('Canvas controls', () => {
    test('a sketch draws with the mouse, keeps the drawing, and undoes', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const sketch = await mcp(page, 'add_sketch', {
            surfaceId: surface.id,
            title: 'Napkin',
        });
        await page.goto(`/surfaces/${surface.id}/cards/${sketch.id}`);
        await waitForHydration(page);

        const card = page.getByRole('article', { name: 'Sketch: Napkin' });
        await card.getByRole('radio', { name: 'Color #ff0000' }).click();
        const paper = card.getByTestId('sketch-paper');
        await expect(paper).toHaveAccessibleName('Drawing: 0 strokes');
        const box = (await paper.boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + 40);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 120, { steps: 10 });
        await page.mouse.up();
        await expect(paper).toHaveAccessibleName('Drawing: 1 strokes');
        await expect(paper.locator('path')).toHaveAttribute('fill', '#ff0000');

        await expect
            .poll(
                async () =>
                    (await mcp(page, 'get_card', { itemId: sketch.id })).strokes
                        ?.length,
            )
            .toBe(1);
        await page.reload();
        await waitForHydration(page);
        await expect(paper).toHaveAccessibleName('Drawing: 1 strokes');

        await card.getByRole('button', { name: 'Undo' }).click();
        await expect(paper).toHaveAccessibleName('Drawing: 0 strokes');
        await expect
            .poll(
                async () =>
                    (await mcp(page, 'get_card', { itemId: sketch.id })).strokes
                        ?.length,
            )
            .toBe(0);
    });

    test('a locked card stays put when dragged, until unlocked', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const note = await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Pinned',
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);

        const card = page.getByRole('article', { name: 'Sticky note: Pinned' });
        const header = card.locator('header');
        await header.hover();
        await page
            .getByRole('button', { name: 'Lock Pinned in place' })
            .click();
        await expect(
            page.getByRole('button', { name: 'Unlock Pinned in place' }),
        ).toHaveAttribute('aria-pressed', 'true');

        const before = await nodePosition(page, note.id);
        const from = await center(header);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 150, from.y + 80, { steps: 8 });
        await page.mouse.up();
        expect(await nodePosition(page, note.id)).toBe(before);

        await header.hover();
        await page
            .getByRole('button', { name: 'Unlock Pinned in place' })
            .click();
        await expect(
            page.getByRole('button', { name: 'Lock Pinned in place' }),
        ).toHaveAttribute('aria-pressed', 'false');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 150, from.y + 80, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => nodePosition(page, note.id)).not.toBe(before);
    });

    test('dragging from a card links it to another; right-clicking the link removes it', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const a = await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Cause',
        });
        await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Effect',
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);
        await expect(page.locator('g[data-edge-id]')).toHaveCount(0);

        // Easy connect: grab just outside the card's edge, anywhere along it.
        const from = page.getByRole('article', { name: 'Sticky note: Cause' });
        await from.hover();
        const box = (await page
            .locator(`[data-node-id="${a.id}"]`)
            .boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height + 5 };
        const end = await center(
            page.getByRole('article', { name: 'Sticky note: Effect' }),
        );
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 12 });
        await page.mouse.up();

        const edge = page.locator('g[data-edge-id]');
        await expect(edge).toHaveCount(1);
        // Saved, not just drawn.
        await page.reload();
        await waitForHydration(page);
        await expect(edge).toHaveCount(1);

        // The link runs between the two cards; right-click its middle.
        const middle = await edge
            .locator('.trellis__edge-interaction')
            .evaluate((path: SVGPathElement) => {
                const at = path.getPointAtLength(path.getTotalLength() / 2);
                const point = new DOMPoint(at.x, at.y).matrixTransform(
                    path.getScreenCTM()!,
                );
                return { x: point.x, y: point.y };
            });
        await page.mouse.click(middle.x, middle.y, { button: 'right' });
        await page.getByRole('menuitem', { name: 'Remove link' }).click();
        await expect(edge).toHaveCount(0);
    });

    test('in focus, double-clicking the header or clicking the canvas goes back', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const note = await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Focus me',
        });
        const path = `/surfaces/${surface.id}`;
        await page.goto(`${path}/cards/${note.id}`);
        await waitForHydration(page);
        const header = page
            .getByRole('article', { name: 'Sticky note: Focus me' })
            .locator('header');

        await header.dblclick();
        await expect(page).toHaveURL(new RegExp(`${path}$`));

        await page.goto(`${path}/cards/${note.id}`);
        await waitForHydration(page);
        const canvas = (await page
            .getByRole('application', { name: 'Company surface' })
            .boundingBox())!;
        // The strip of canvas above the focused card, clear of "Back".
        await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + 30);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
    });

    test('an issue opens inside its board, Linear style, and edits in place', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const board = await mcp(page, 'create_board', {
            surfaceId: surface.id,
            title: 'Detail board',
            key: 'DB',
        });
        await mcp(page, 'create_issue', {
            boardId: board.id,
            title: 'Write the brief',
            status: 'todo',
        });
        await page.goto(`/surfaces/${surface.id}/cards/${board.id}`);
        await waitForHydration(page);

        await page
            .getByRole('button', { name: 'Open DB-1: Write the brief' })
            .click();
        const detail = page.getByRole('region', { name: 'Issue DB-1' });
        await expect(detail).toBeVisible();

        const title = detail.getByRole('textbox', { name: 'Title' });
        await title.fill('Write the launch brief');
        await title.press('Enter');
        await detail.getByRole('button', { name: /^Status: / }).click();
        await page.getByRole('menuitemradio', { name: 'In Progress' }).click();
        await detail
            .getByRole('textbox', { name: 'Leave a comment' })
            .fill('Starting today');
        await detail.getByRole('button', { name: 'Comment' }).click();
        await expect(
            detail.getByRole('article', { name: /^Comment by / }),
        ).toContainText('Starting today');

        await expect
            .poll(async () => {
                const card = await mcp(page, 'get_card', { itemId: board.id });
                const issue = card.issues[0];
                return [issue.title, issue.status, issue.comments?.length];
            })
            .toEqual(['Write the launch brief', 'in_progress', 1]);

        // Back to the columns; Escape works too.
        await title.focus();
        await page.keyboard.press('Escape');
        await expect(detail).toHaveCount(0);
        await expect(
            page.getByRole('button', {
                name: 'Open DB-1: Write the launch brief',
            }),
        ).toBeVisible();
    });

    test('a card renames by clicking its title, from its header menu, or by an agent', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const sketch = await mcp(page, 'add_sketch', {
            surfaceId: surface.id,
            title: 'Napkin',
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);

        // Click the title, type, Enter.
        await page.getByRole('heading', { name: 'Napkin' }).click();
        const field = page.getByRole('textbox', { name: 'Card title' });
        await expect(field).toBeFocused();
        await field.fill('Floor plan');
        await field.press('Enter');
        await expect(
            page.getByRole('article', { name: 'Sketch: Floor plan' }),
        ).toBeVisible();
        await expect
            .poll(
                async () =>
                    (await mcp(page, 'get_card', { itemId: sketch.id })).title,
            )
            .toBe('Floor plan');
        await expect(
            page
                .getByRole('navigation', { name: 'Surface' })
                .getByText('Floor plan'),
        ).toBeVisible();

        // Escape leaves it as it was.
        await page.getByRole('heading', { name: 'Floor plan' }).click();
        await field.fill('Nope');
        await field.press('Escape');
        await expect(
            page.getByRole('heading', { name: 'Floor plan' }),
        ).toBeVisible();

        // Rename from the header's right-click menu.
        await page
            .getByRole('article', { name: 'Sketch: Floor plan' })
            .locator('header')
            .click({ button: 'right', position: { x: 300, y: 20 } });
        await page.getByRole('menuitem', { name: 'Rename' }).click();
        await field.fill('Seating chart');
        await field.blur();
        await expect(
            page.getByRole('heading', { name: 'Seating chart' }),
        ).toBeVisible();

        // An agent renames it too.
        await mcp(page, 'rename_card', {
            itemId: sketch.id,
            title: 'Final plan',
        });
        await expect(
            page.getByRole('heading', { name: 'Final plan' }),
        ).toBeVisible();
    });

    test('double-clicking a title still focuses the card instead of renaming it', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const sketch = await mcp(page, 'add_sketch', {
            surfaceId: surface.id,
            title: 'Napkin',
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);
        await page.getByRole('heading', { name: 'Napkin' }).dblclick();
        await expect(page).toHaveURL(new RegExp(`/cards/${sketch.id}$`));
        await page.waitForTimeout(400);
        await expect(
            page.getByRole('textbox', { name: 'Card title' }),
        ).toHaveCount(0);
    });

    test('deleting a card asks first, then takes the cards hanging under it too', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const doc = await mcp(page, 'create_document', {
            surfaceId: surface.id,
            title: 'Old plan',
        });
        await mcp(page, 'add_image', {
            url: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg',
            title: 'Old sketch',
            attachedTo: doc.id,
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);
        const card = page.getByRole('article', { name: 'Document: Old plan' });
        // Zoomed out, a click on a card zooms to it; get to reading size.
        const zoom = page.getByRole('button', { name: 'Zoom to Old plan' });
        if (await zoom.count()) {
            await zoom.focus();
            await page.keyboard.press('Enter');
            await expect(zoom).toHaveCount(0);
        }

        // Cancel keeps it.
        await card.locator('header').hover();
        await page.getByRole('button', { name: 'Delete Old plan' }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toContainText('Delete “Old plan”?');
        await expect(dialog).toContainText('Image: Old sketch');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(card).toBeVisible();

        // From the header's right-click menu, and confirmed.
        await card
            .locator('header')
            .click({ button: 'right', position: { x: 400, y: 20 } });
        await page.getByRole('menuitem', { name: 'Delete…' }).click();
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(card).toHaveCount(0);
        await expect(
            page.getByRole('article', { name: 'Image: Old sketch' }),
        ).toHaveCount(0);
        await expect
            .poll(
                async () =>
                    (await mcp(page, 'list_cards', { surfaceId: surface.id }))
                        .length,
            )
            .toBe(0);
    });

    test('agents link and delete cards over MCP', async ({
        authedPage: page,
    }) => {
        const surface = await freshSurface(page);
        const start = await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'Start',
            color: 'emerald',
        });
        const end = await mcp(page, 'add_note', {
            surfaceId: surface.id,
            text: 'End',
        });
        await mcp(page, 'link_cards', {
            from: start.id,
            to: end.id,
            label: 'then',
        });
        await page.goto(`/surfaces/${surface.id}`);
        await waitForHydration(page);
        await expect(
            page.getByRole('article', { name: 'Sticky note: End' }),
        ).toBeVisible();
        await expect(page.locator('g[data-edge-id]')).toHaveCount(1);

        const result = await mcp(page, 'delete_card', { itemId: start.id });
        expect(result.deleted).toEqual([start.id]);
        await expect(
            page.getByRole('article', { name: 'Sticky note: Start' }),
        ).toHaveCount(0);
        await expect(page.locator('g[data-edge-id]')).toHaveCount(0);
    });
});
