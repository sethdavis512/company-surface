import { cva, cx } from 'cva.config';
import type { VariantProps } from 'cva';
import { BotIcon } from 'lucide-react';
import { AGENT_ID, type Person } from '~/lib/surface';

export const avatarVariants = cva({
    base: 'bg-muted text-foreground inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-card select-none',
    variants: {
        size: {
            sm: 'size-6 text-[10px]',
            md: 'size-8 text-xs',
        },
    },
    defaultVariants: { size: 'md' },
});

type Props = VariantProps<typeof avatarVariants> & {
    person: Person | undefined;
    className?: string;
};

/** A person's initials; the agent gets its own color and a bot instead. */
export function Avatar({ person, size, className }: Props) {
    const agent = person?.id === AGENT_ID;
    return (
        <span
            title={person?.name}
            aria-hidden="true"
            className={cx(
                avatarVariants({ size }),
                agent && 'bg-agent text-background',
                className,
            )}
        >
            {agent ? (
                <BotIcon className="size-[60%]" />
            ) : (
                (person?.initials ?? '?')
            )}
        </span>
    );
}
