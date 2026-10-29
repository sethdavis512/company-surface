import { describe, expect, it } from 'vitest';
import { DEFAULT_CANVAS_SETTINGS, LINK_WIDTH } from './canvas-settings';
import {
    getCanvasSettings,
    serializeCanvasSettings,
} from './canvas-settings.server';

async function requestWith(settings: unknown) {
    const cookie = (
        await serializeCanvasSettings(settings as { linkWidth: number })
    ).split(';')[0]!;
    return new Request('http://localhost/', { headers: { Cookie: cookie } });
}

describe('canvas settings cookie', () => {
    it('reads back what was saved', async () => {
        expect(
            await getCanvasSettings(await requestWith({ linkWidth: 3 })),
        ).toEqual({ linkWidth: 3 });
    });

    it('falls back to the default without a cookie or with a bad one', async () => {
        expect(
            await getCanvasSettings(new Request('http://localhost/')),
        ).toEqual(DEFAULT_CANVAS_SETTINGS);
        expect(
            await getCanvasSettings(
                await requestWith({ linkWidth: LINK_WIDTH.max + 10 }),
            ),
        ).toEqual(DEFAULT_CANVAS_SETTINGS);
    });
});
