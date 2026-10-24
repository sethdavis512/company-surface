import {
    CircleCheckIcon,
    CircleDashedIcon,
    CircleDotIcon,
    CircleEllipsisIcon,
    CircleIcon,
    MinusIcon,
    SignalHighIcon,
    SignalLowIcon,
    SignalMediumIcon,
    TriangleAlertIcon,
    type LucideIcon,
} from 'lucide-react';
import type { IssuePriority, IssueStatus } from '~/lib/surface';

/** How each status and priority looks, on the board and in an issue. */
export const ISSUE_STATUS: Record<
    IssueStatus,
    { label: string; icon: LucideIcon; color: string }
> = {
    backlog: {
        label: 'Backlog',
        icon: CircleDashedIcon,
        color: 'text-muted-foreground',
    },
    todo: { label: 'Todo', icon: CircleIcon, color: 'text-foreground' },
    in_progress: {
        label: 'In Progress',
        icon: CircleDotIcon,
        color: 'text-warning',
    },
    in_review: {
        label: 'In Review',
        icon: CircleEllipsisIcon,
        color: 'text-success',
    },
    done: { label: 'Done', icon: CircleCheckIcon, color: 'text-info' },
};

export const PRIORITY: Record<
    IssuePriority,
    { label: string; icon: LucideIcon; color: string }
> = {
    urgent: {
        label: 'Urgent',
        icon: TriangleAlertIcon,
        color: 'text-destructive',
    },
    high: { label: 'High', icon: SignalHighIcon, color: 'text-foreground' },
    medium: {
        label: 'Medium',
        icon: SignalMediumIcon,
        color: 'text-foreground',
    },
    low: { label: 'Low', icon: SignalLowIcon, color: 'text-muted-foreground' },
    none: {
        label: 'No priority',
        icon: MinusIcon,
        color: 'text-muted-foreground',
    },
};
