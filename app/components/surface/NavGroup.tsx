import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { cx } from 'cva.config';
import {
    Collapsible,
    CollapsiblePanel,
    CollapsibleTrigger,
} from '~/components/ui/collapsible';
import { navHeadingClassName } from './nav-link';

type Props = {
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Buttons on the heading's right, outside the toggle (Views' +). */
    actions?: ReactNode;
    children: ReactNode;
};

/**
 * A left-nav section whose heading collapses it (COSS Collapsible, on Base
 * UI): the chevron turns while open, and the panel slides shut.
 */
export function NavGroup({
    label,
    open,
    onOpenChange,
    actions,
    children,
}: Props) {
    return (
        <section aria-label={label}>
            <Collapsible
                open={open}
                onOpenChange={onOpenChange}
                className="flex flex-col gap-1"
            >
                <div className="flex items-center justify-between pe-1">
                    <CollapsibleTrigger
                        className={cx(
                            navHeadingClassName,
                            'group/trigger hover:text-foreground focus-visible:ring-ring flex cursor-pointer items-center gap-1 rounded-md outline-none focus-visible:ring-2 pointer-coarse:py-2',
                        )}
                    >
                        {label}
                        <ChevronRightIcon
                            aria-hidden="true"
                            className="size-3 transition-transform group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
                        />
                    </CollapsibleTrigger>
                    {actions}
                </div>
                <CollapsiblePanel className="-m-0.5 p-0.5 motion-reduce:transition-none">
                    {children}
                </CollapsiblePanel>
            </Collapsible>
        </section>
    );
}
