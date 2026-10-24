import { useRef, type ComponentPropsWithoutRef } from 'react';
import { useFetcher } from 'react-router';
import { cx } from 'cva.config';
import { TITLE_MAX } from '~/lib/surface';
import { useRenaming, useSurfaceLinks } from './surface-context';

/** Longer than this between clicks and it's two clicks, not a double-click. */
const DOUBLE_CLICK_MS = 250;
/** A press that moves further than this was a drag, not a click. */
const CLICK_SLOP_PX = 4;

type Props = {
    itemId: string;
    title: string;
} & Omit<ComponentPropsWithoutRef<'h2'>, 'title' | 'children'>;

/**
 * A card's title in its header. Click it (or focus it and press Enter or
 * F2, or pick Rename from the header's right-click menu) to edit it in
 * place: Enter or clicking away saves (`rename-card`), Escape cancels. The
 * click waits a moment, so a double-click still focuses the card, and a
 * drag of the header never opens it. The new title shows at once.
 */
export function CardTitle({ itemId, title, className, ...props }: Props) {
    const links = useSurfaceLinks();
    const { renamingId, startRename, stopRename } = useRenaming();
    const fetcher = useFetcher({ key: `rename:${itemId}` });
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const pressedAt = useRef<{ x: number; y: number } | null>(null);
    const pending = fetcher.formData?.get('title');
    const shown = typeof pending === 'string' ? pending : title;

    function save(value: string) {
        stopRename();
        const next = value.trim();
        if (!next || next === shown) return;
        void fetcher.submit(
            { intent: 'rename-card', itemId, title: next },
            { method: 'post', action: links.action },
        );
    }

    if (renamingId === itemId) {
        return (
            <input
                aria-label="Card title"
                defaultValue={shown}
                maxLength={TITLE_MAX}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => save(event.currentTarget.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                        save(event.currentTarget.value);
                    } else if (event.key === 'Escape') {
                        stopRename();
                    }
                }}
                className={cx(
                    'nodrag bg-background ring-ring -mx-1 min-w-0 flex-1 rounded px-1 text-sm font-semibold outline-none focus-visible:ring-2',
                )}
            />
        );
    }

    return (
        <h2
            {...props}
            tabIndex={0}
            title="Click to rename"
            onPointerDown={(event) => {
                pressedAt.current = { x: event.clientX, y: event.clientY };
            }}
            onClick={(event) => {
                clearTimeout(timer.current);
                const from = pressedAt.current;
                const moved =
                    from &&
                    Math.hypot(event.clientX - from.x, event.clientY - from.y) >
                        CLICK_SLOP_PX;
                if (event.detail !== 1 || moved) return;
                timer.current = setTimeout(
                    () => startRename(itemId),
                    DOUBLE_CLICK_MS,
                );
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'F2') {
                    event.preventDefault();
                    event.stopPropagation();
                    startRename(itemId);
                }
            }}
            className={cx(
                'focus-visible:ring-ring cursor-text rounded outline-none focus-visible:ring-2',
                className,
            )}
        >
            {shown}
        </h2>
    );
}
