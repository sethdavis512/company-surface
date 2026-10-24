import { cx } from 'cva.config';

/** A row in the surface's left nav, highlighted when its route is open. */
export function navItemClassName({ isActive }: { isActive: boolean }) {
    return cx(
        'focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 pointer-coarse:py-3',
        isActive ? 'bg-accent font-semibold' : 'hover:bg-accent/60',
    );
}

export const navHeadingClassName =
    'text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase';
