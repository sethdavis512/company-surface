import { BotIcon } from 'lucide-react';
import { cx } from 'cva.config';

/**
 * How the canvas says "an agent made this, not a person": the `--agent`
 * color, kept apart from the six border tints, on a stripe across the
 * window's top and a labeled badge in its header.
 */

/** A thin agent-colored bar across the top of a window. */
export function AgentStripe() {
    return (
        <span
            aria-hidden="true"
            className="bg-agent pointer-events-none absolute inset-x-0 top-0 z-10 h-1"
        />
    );
}

type BadgeProps = {
    className?: string;
};

/** "Agent", with a bot icon, for window headers. */
export function AgentBadge({ className }: BadgeProps) {
    return (
        <span
            title="Made by an agent"
            className={cx(
                'bg-agent/12 text-agent inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                className,
            )}
        >
            <BotIcon aria-hidden="true" className="size-3" />
            Agent
        </span>
    );
}

/** Just the bot icon, for tight spots like the nav. */
export function AgentIcon({ className }: BadgeProps) {
    return (
        <BotIcon
            role="img"
            aria-label="Made by an agent"
            className={cx('text-agent size-3.5 shrink-0', className)}
        />
    );
}
