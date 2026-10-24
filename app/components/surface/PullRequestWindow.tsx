import { use } from 'react';
import { Link, useFetcher } from 'react-router';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import {
    CheckCircle2Icon,
    CircleDashedIcon,
    GitBranchIcon,
    GitPullRequestIcon,
    MessageCircleIcon,
    XCircleIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
    isAgentMade,
    type PullRequestItem,
    type PullRequestStatus,
} from '~/lib/surface';
import type { action as surfaceAction } from '~/routes/surface';
import { Avatar } from './Avatar';
import {
    FocusedItemContext,
    useSurfaceItems,
    useSurfacePeople,
    useWindowColors,
    useSurfaceLinks,
} from './surface-context';
import { AgentBadge, AgentStripe } from './AgentMark';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type PullRequestNode = FlowNode<
    { item: PullRequestItem },
    'pull-request'
>;

export const PULL_REQUEST_STATUS: Record<
    PullRequestStatus,
    {
        label: string;
        badge: 'success' | 'outline' | 'info' | 'error';
        icon: string;
    }
> = {
    open: { label: 'Open', badge: 'success', icon: 'text-success' },
    draft: { label: 'Draft', badge: 'outline', icon: 'text-muted-foreground' },
    merged: { label: 'Merged', badge: 'info', icon: 'text-tint-violet' },
    closed: { label: 'Closed', badge: 'error', icon: 'text-destructive' },
};

/**
 * A mock pull request: the code change a chat produced. Links back to its
 * chat, shows checks and changed files, and has the next step (ready for
 * review, merge) as a button that posts to the surface action.
 */
export function PullRequestWindow({
    data,
    selected,
}: NodeProps<PullRequestNode>) {
    const links = useSurfaceLinks();
    const pr = data.item;
    const { personById } = useSurfacePeople();
    const { titleOf } = useSurfaceItems();
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === pr.id;
    const fetcher = useFetcher<typeof surfaceAction>();

    // Show the next status at once while it saves.
    const pendingStatus = fetcher.formData?.get('status');
    const status =
        typeof pendingStatus === 'string'
            ? (pendingStatus as PullRequestStatus)
            : pr.status;
    const look = PULL_REQUEST_STATUS[status];
    const author = personById(pr.authorId);
    const chatTitle = pr.chatId ? titleOf(pr.chatId) : undefined;
    const additions = pr.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = pr.files.reduce((sum, file) => sum + file.deletions, 0);
    const next =
        status === 'draft'
            ? { status: 'open', label: 'Ready for review' }
            : status === 'open'
              ? { status: 'merged', label: 'Merge' }
              : null;

    return (
        <div className="group/window relative size-full">
            <Handle type="target" position="top" />
            <LinkHandle />
            <WindowControls
                itemId={pr.id}
                title={`#${pr.number}`}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={pr.id}
                title={pr.title}
                kind={`PR #${pr.number}`}
                rounded="rounded-2xl"
            />
            <article
                aria-label={`Pull request: #${pr.number} ${pr.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-2xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(pr.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(pr) && <AgentStripe />}
                <header className="flex cursor-grab flex-col gap-2 border-b px-5 pt-4 pb-3 active:cursor-grabbing">
                    <div className="flex items-center gap-2">
                        <GitPullRequestIcon
                            aria-hidden="true"
                            className={cx('size-4 shrink-0', look.icon)}
                        />
                        <span className="text-muted-foreground text-xs">
                            {pr.repo} #{pr.number}
                        </span>
                        {isAgentMade(pr) && <AgentBadge className="ms-auto" />}
                        <Badge
                            variant={look.badge}
                            className={isAgentMade(pr) ? undefined : 'ms-auto'}
                        >
                            {look.label}
                        </Badge>
                    </div>
                    <CardTitle
                        itemId={pr.id}
                        title={pr.title}
                        className="line-clamp-2 text-sm leading-snug font-semibold"
                    />
                    <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
                        <GitBranchIcon aria-hidden="true" className="size-3" />
                        <span className="truncate">{pr.branch}</span>
                        <span aria-hidden="true">→</span>
                        <span>{pr.base}</span>
                    </p>
                </header>

                <div className="nodrag nowheel flex min-h-0 flex-1 cursor-auto scrollbar-none flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
                    {chatTitle && (
                        <Link
                            to={links.item(pr.chatId!)}
                            className="bg-muted hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-lg px-3 py-2 text-xs outline-none focus-visible:ring-2"
                        >
                            <MessageCircleIcon
                                aria-hidden="true"
                                className="text-muted-foreground size-3.5"
                            />
                            <span className="text-muted-foreground">
                                From chat
                            </span>
                            <span className="truncate font-medium">
                                {chatTitle}
                            </span>
                        </Link>
                    )}

                    {pr.summary && (
                        <p className="text-muted-foreground leading-snug">
                            {pr.summary}
                        </p>
                    )}

                    <ul
                        aria-label="Checks"
                        className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
                    >
                        <li className="flex items-center gap-1">
                            <CheckCircle2Icon
                                aria-hidden="true"
                                className="text-success size-3.5"
                            />
                            {pr.checks.passed} passed
                        </li>
                        {pr.checks.failed > 0 && (
                            <li className="flex items-center gap-1">
                                <XCircleIcon
                                    aria-hidden="true"
                                    className="text-destructive size-3.5"
                                />
                                {pr.checks.failed} failed
                            </li>
                        )}
                        {pr.checks.pending > 0 && (
                            <li className="flex items-center gap-1">
                                <CircleDashedIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-3.5"
                                />
                                {pr.checks.pending} pending
                            </li>
                        )}
                    </ul>

                    <section aria-label="Files changed">
                        <h3 className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
                            <span>{pr.files.length} files changed</span>
                            <span className="font-mono">
                                <span className="text-success-foreground">
                                    +{additions}
                                </span>{' '}
                                <span className="text-destructive-foreground">
                                    −{deletions}
                                </span>
                            </span>
                        </h3>
                        <ul className="flex flex-col divide-y rounded-lg border font-mono text-[11px]">
                            {pr.files.map((file) => (
                                <li
                                    key={file.path}
                                    className="flex items-center gap-2 px-2.5 py-1.5"
                                >
                                    <span className="min-w-0 flex-1 truncate">
                                        {file.path}
                                    </span>
                                    <span className="text-success-foreground">
                                        +{file.additions}
                                    </span>
                                    <span className="text-destructive-foreground">
                                        −{file.deletions}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>

                <footer className="flex items-center gap-2 border-t px-5 py-3">
                    <Avatar person={author} size="sm" />
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                        {author?.name ?? 'Someone'}
                    </span>
                    {next && (
                        <fetcher.Form method="post" action={links.action}>
                            <input
                                type="hidden"
                                name="intent"
                                value="set-pr-status"
                            />
                            <input
                                type="hidden"
                                name="pullRequestId"
                                value={pr.id}
                            />
                            <input
                                type="hidden"
                                name="status"
                                value={next.status}
                            />
                            <Button
                                type="submit"
                                size="xs"
                                className="nodrag"
                                variant={
                                    next.status === 'merged'
                                        ? 'default'
                                        : 'outline'
                                }
                            >
                                {next.label}
                            </Button>
                        </fetcher.Form>
                    )}
                </footer>
            </article>
        </div>
    );
}
