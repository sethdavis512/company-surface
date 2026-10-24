/**
 * The left nav's width and whether it's collapsed to its icon rail, kept in
 * a cookie (as Sprocket keeps its split widths) so the loader can read it
 * and the server renders the nav at your size, with no jump after
 * hydration. In pixels, not the panel library's percentages, so it holds
 * the same at any window width. Pure and client-safe: the loader parses
 * with it, the nav writes with it.
 */

export const NAV_PANEL_COOKIE = 'surface-nav-panel';

/** Widths in pixels: the default, the drag limits, and the icon rail. */
export const NAV_WIDTH = { default: 256, min: 208, max: 420, rail: 56 };

export type NavPanel = {
    /** The expanded width (kept while collapsed, for expanding again). */
    width: number;
    collapsed: boolean;
};

export const DEFAULT_NAV_PANEL: NavPanel = {
    width: NAV_WIDTH.default,
    collapsed: false,
};

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The nav's saved state from a Cookie header; the default for anything
 * missing or malformed (a hand-edited cookie never makes a nonsense width).
 */
export function readNavPanel(cookieHeader: string | null): NavPanel {
    const raw = cookieHeader
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${NAV_PANEL_COOKIE}=`))
        ?.slice(NAV_PANEL_COOKIE.length + 1);
    const match = raw ? /^(\d{2,4})-([01])$/.exec(raw) : null;
    if (!match) return DEFAULT_NAV_PANEL;
    const width = Number(match[1]);
    if (width < NAV_WIDTH.min || width > NAV_WIDTH.max) {
        return DEFAULT_NAV_PANEL;
    }
    return { width, collapsed: match[2] === '1' };
}

/** A `document.cookie` assignment that saves the nav for a year. */
export function serializeNavPanel({ width, collapsed }: NavPanel): string {
    const clamped = Math.round(
        Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, width)),
    );
    return `${NAV_PANEL_COOKIE}=${clamped}-${collapsed ? 1 : 0}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}
