import { afterEach, describe, expect, it } from 'vitest';
import {
    getItem,
    resetSurface,
    SEED_SURFACE_ID,
} from '~/models/surface.server';
import { WITHHELD_TOOLS, openSurfaceTools, resultText } from './surface-tools';

afterEach(() => resetSurface());

describe('openSurfaceTools', () => {
    it('serves the MCP tools, less the withheld ones', async () => {
        const { tools, close } = await openSurfaceTools();
        try {
            expect(tools).toHaveProperty('list_cards');
            expect(tools).toHaveProperty('create_document');
            for (const name of WITHHELD_TOOLS) {
                expect(tools).not.toHaveProperty(name);
            }
        } finally {
            await close();
        }
    });

    it('acts on the store, as the agent', async () => {
        const { tools, close } = await openSurfaceTools();
        try {
            const output = await tools.add_note!.execute!(
                { surfaceId: SEED_SURFACE_ID, text: 'Remember the demo' },
                {} as never,
            );
            const note = JSON.parse(output as string) as { id: string };
            const stored = getItem(note.id);
            expect(stored.kind).toBe('note');
            expect(stored.createdById).toBe('agent');
        } finally {
            await close();
        }
    });
});

describe('resultText', () => {
    it('joins text parts and marks errors', () => {
        expect(
            resultText({
                content: [{ type: 'text', text: 'No item with id "x".' }],
                isError: true,
            }),
        ).toBe('Error: No item with id "x".');
    });
});
