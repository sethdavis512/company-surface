import { z } from 'zod';

/**
 * How one person likes the canvas drawn, kept per browser (a cookie, like
 * the nav's order), not in the shared store: changing it never moves
 * anything for anyone else.
 */

/** Link thickness, in screen pixels at zoom 1 (Trellis's default is 1.5). */
export const LINK_WIDTH = { min: 1, max: 6, step: 0.5, fallback: 1.5 } as const;

export const canvasSettingsSchema = z.object({
    linkWidth: z.coerce.number().min(LINK_WIDTH.min).max(LINK_WIDTH.max),
});

export type CanvasSettings = z.infer<typeof canvasSettingsSchema>;

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
    linkWidth: LINK_WIDTH.fallback,
};
