import { z } from 'zod';

/** The left nav's sections, in their default order. */
export const NAV_SECTIONS = [
    'recent',
    'views',
    'chat',
    'document',
    'pull-request',
    'chart',
    'board',
    'video',
    'web',
    'image',
    'note',
    'sketch',
    'ui',
] as const;

export type NavSectionKey = (typeof NAV_SECTIONS)[number];

export const navOrderSchema = z.array(z.enum(NAV_SECTIONS));

/** The sections someone has collapsed, each once. */
export const navCollapsedSchema = z
    .array(z.enum(NAV_SECTIONS))
    .max(NAV_SECTIONS.length)
    .transform((keys) => [...new Set(keys)]);

/**
 * A saved order made whole: its known sections first (no repeats), then
 * any it doesn't mention (say, a section added since) in default order.
 */
export function completeNavOrder(saved: readonly string[]): NavSectionKey[] {
    const known = new Set<string>(NAV_SECTIONS);
    const kept = [...new Set(saved)].filter((key): key is NavSectionKey =>
        known.has(key),
    );
    return [...kept, ...NAV_SECTIONS.filter((key) => !kept.includes(key))];
}
