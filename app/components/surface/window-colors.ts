import type { WindowColor } from '~/lib/surface';

/**
 * How each of the six border colors looks. Classes are spelled out in full
 * so Tailwind sees them; the colors are the `--tint-*` tokens in app.css.
 */
export const WINDOW_COLORS: Record<
    WindowColor,
    { label: string; border: string; swatch: string }
> = {
    rose: { label: 'Rose', border: 'border-tint-rose', swatch: 'bg-tint-rose' },
    amber: {
        label: 'Amber',
        border: 'border-tint-amber',
        swatch: 'bg-tint-amber',
    },
    emerald: {
        label: 'Emerald',
        border: 'border-tint-emerald',
        swatch: 'bg-tint-emerald',
    },
    sky: { label: 'Sky', border: 'border-tint-sky', swatch: 'bg-tint-sky' },
    violet: {
        label: 'Violet',
        border: 'border-tint-violet',
        swatch: 'bg-tint-violet',
    },
    slate: {
        label: 'Slate',
        border: 'border-tint-slate',
        swatch: 'bg-tint-slate',
    },
};

/**
 * A sticky note's tint and edge in each palette color (spelled out for
 * Tailwind). The tint is a layer over the card color, not a see-through
 * fill, so cards behind a note never show through it.
 */
export const NOTE_FILLS: Record<WindowColor, string> = {
    rose: 'before:bg-tint-rose/35 border-tint-rose/60',
    amber: 'before:bg-tint-amber/40 border-tint-amber/70',
    emerald: 'before:bg-tint-emerald/35 border-tint-emerald/60',
    sky: 'before:bg-tint-sky/35 border-tint-sky/60',
    violet: 'before:bg-tint-violet/35 border-tint-violet/60',
    slate: 'before:bg-tint-slate/35 border-tint-slate/60',
};

/** Border classes for a window: its color, a little heavier, or the default. */
export function windowBorderClass(color: WindowColor | undefined) {
    return color ? `border-2 ${WINDOW_COLORS[color].border}` : 'border';
}
