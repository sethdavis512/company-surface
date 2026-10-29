import { createCookie } from 'react-router';
import { APP_SLUG } from '~/config';
import {
    DEFAULT_CANVAS_SETTINGS,
    canvasSettingsSchema,
    type CanvasSettings,
} from '~/lib/canvas-settings';

/** Each person's canvas settings, so the canvas renders right on first paint. */
const canvasSettingsCookie = createCookie(`${APP_SLUG}_canvas_settings`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
});

export async function getCanvasSettings(
    request: Request,
): Promise<CanvasSettings> {
    const parsed = canvasSettingsSchema.safeParse(
        await canvasSettingsCookie.parse(request.headers.get('Cookie')),
    );
    return parsed.success ? parsed.data : DEFAULT_CANVAS_SETTINGS;
}

export function serializeCanvasSettings(settings: CanvasSettings) {
    return canvasSettingsCookie.serialize(settings);
}
