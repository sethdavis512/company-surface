import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSubmit } from 'react-router';
import { ChevronLeftIcon, FileTextIcon, UserIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { Button } from '~/components/ui/button';
import {
    Menu,
    MenuPopup,
    MenuRadioGroup,
    MenuRadioItem,
    MenuTrigger,
} from '~/components/ui/menu';
import {
    ISSUE_PRIORITIES,
    ISSUE_STATUSES,
    isAgentMade,
    type BoardItem,
    type Issue,
    type IssuePriority,
    type IssueStatus,
} from '~/lib/surface';
import { AgentIcon } from './AgentMark';
import { Avatar } from './Avatar';
import { ISSUE_STATUS, PRIORITY } from './issue-looks';
import { KIND_ICONS } from './kind-icons';
import {
    useSurfaceItems,
    useSurfaceLinks,
    useSurfacePeople,
} from './surface-context';

const UNASSIGNED = 'unassigned';

type Props = {
    board: BoardItem;
    issue: Issue;
    onClose: () => void;
};

function when(iso: string) {
    return new Date(iso).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
    });
}

/** Keys typed in the detail stay there (the canvas has its own). */
function keepKeys(event: KeyboardEvent) {
    event.stopPropagation();
}

/**
 * One issue, opened inside its board's card, the way Linear shows one: the
 * title and description to read and edit, its activity (who made it, then
 * comments, with a box to add one) on the left; its properties (status,
 * priority, assignee, linked cards) down the right. Back, or Escape,
 * returns to the columns.
 */
export function IssueDetail({ board, issue, onClose }: Props) {
    const links = useSurfaceLinks();
    const submit = useSubmit();
    const { people, personById } = useSurfacePeople();
    const { titleOf, kindOf } = useSurfaceItems();
    const [title, setTitle] = useState<string | null>(null);
    const [description, setDescription] = useState<string | null>(null);
    const [comment, setComment] = useState('');
    const status = ISSUE_STATUS[issue.status];
    const priority = PRIORITY[issue.priority];
    const assignee = issue.assigneeId
        ? personById(issue.assigneeId)
        : undefined;
    const creator = personById(issue.createdById);

    function save(fields: Record<string, string>) {
        void submit(
            { boardId: board.id, issueId: issue.id, ...fields },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `issue:${issue.id}:${fields.intent}:${Object.keys(fields).join(',')}`,
            },
        );
    }

    function saveTitle() {
        if (title !== null && title.trim() && title.trim() !== issue.title) {
            save({ intent: 'edit-issue', title: title.trim() });
        }
        setTitle(null);
    }

    function saveDescription() {
        if (description !== null && description !== (issue.description ?? '')) {
            save({ intent: 'edit-issue', description });
        }
        setDescription(null);
    }

    function handleComment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!comment.trim()) return;
        save({ intent: 'comment-issue', text: comment.trim() });
        setComment('');
    }

    return (
        <div
            role="region"
            aria-label={`Issue ${issue.identifier}`}
            onKeyDown={(event) => {
                keepKeys(event);
                if (event.key === 'Escape') onClose();
            }}
            className="nodrag nowheel flex min-h-0 flex-1 cursor-auto flex-col"
        >
            <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs">
                <Button variant="ghost" size="xs" onClick={onClose}>
                    <ChevronLeftIcon aria-hidden="true" />
                    {board.title}
                </Button>
                <span className="text-muted-foreground" aria-hidden="true">
                    /
                </span>
                <span className="text-muted-foreground font-mono">
                    {issue.identifier}
                </span>
            </div>
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 scrollbar-none flex-col gap-4 overflow-y-auto px-6 py-5">
                    <input
                        aria-label="Title"
                        value={title ?? issue.title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter')
                                event.currentTarget.blur();
                        }}
                        maxLength={200}
                        className="focus-visible:bg-muted/40 -mx-2 rounded-md bg-transparent px-2 py-1 text-xl font-semibold outline-none"
                    />
                    <textarea
                        aria-label="Description"
                        value={description ?? issue.description ?? ''}
                        placeholder="Add a description…"
                        onChange={(event) => setDescription(event.target.value)}
                        onBlur={saveDescription}
                        rows={4}
                        className="focus-visible:bg-muted/40 placeholder:text-muted-foreground -mx-2 min-h-24 resize-none rounded-md bg-transparent px-2 py-1 text-sm leading-relaxed outline-none"
                    />

                    <section
                        aria-label="Activity"
                        className="flex flex-col gap-3 border-t pt-4"
                    >
                        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                            Activity
                        </h3>
                        <p className="text-muted-foreground flex items-center gap-2 text-xs">
                            <Avatar person={creator} size="sm" />
                            <span>
                                <span className="text-foreground font-medium">
                                    {creator?.name ?? 'Someone'}
                                </span>{' '}
                                created the issue
                            </span>
                            {isAgentMade(issue) && (
                                <AgentIcon className="size-3" />
                            )}
                        </p>
                        {(issue.comments ?? []).map((entry) => {
                            const author = personById(entry.authorId);
                            return (
                                <article
                                    key={entry.id}
                                    aria-label={`Comment by ${author?.name ?? 'someone'}`}
                                    className="bg-muted/40 flex flex-col gap-1 rounded-lg border px-3 py-2"
                                >
                                    <p className="flex items-center gap-2 text-xs">
                                        <Avatar person={author} size="sm" />
                                        <span className="font-medium">
                                            {author?.name ?? 'Someone'}
                                        </span>
                                        <time
                                            dateTime={entry.at}
                                            suppressHydrationWarning
                                            className="text-muted-foreground"
                                        >
                                            {when(entry.at)}
                                        </time>
                                    </p>
                                    <p className="text-sm whitespace-pre-wrap">
                                        {entry.text}
                                    </p>
                                </article>
                            );
                        })}
                        <form
                            onSubmit={handleComment}
                            className="focus-within:ring-ring flex flex-col gap-2 rounded-lg border p-2 focus-within:ring-2"
                        >
                            <textarea
                                aria-label="Leave a comment"
                                value={comment}
                                onChange={(event) =>
                                    setComment(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Enter' &&
                                        (event.metaKey || event.ctrlKey)
                                    ) {
                                        event.currentTarget.form?.requestSubmit();
                                    }
                                }}
                                placeholder="Leave a comment…"
                                rows={2}
                                className="placeholder:text-muted-foreground resize-none bg-transparent px-1 text-sm outline-none"
                            />
                            <Button
                                type="submit"
                                size="xs"
                                className="self-end"
                                disabled={!comment.trim()}
                            >
                                Comment
                            </Button>
                        </form>
                    </section>
                </div>

                <aside
                    aria-label="Properties"
                    className="bg-muted/20 flex w-56 shrink-0 scrollbar-none flex-col gap-1 overflow-y-auto border-l p-3 text-sm"
                >
                    <Property label="Status">
                        <PickerMenu
                            label={`Status: ${status.label}`}
                            value={issue.status}
                            options={ISSUE_STATUSES.map((value) => ({
                                value,
                                label: ISSUE_STATUS[value].label,
                                icon: ISSUE_STATUS[value].icon,
                                color: ISSUE_STATUS[value].color,
                            }))}
                            onChange={(value) =>
                                save({
                                    intent: 'move-issue',
                                    status: value as IssueStatus,
                                })
                            }
                        >
                            <status.icon
                                aria-hidden="true"
                                className={cx('size-4', status.color)}
                            />
                            {status.label}
                        </PickerMenu>
                    </Property>
                    <Property label="Priority">
                        <PickerMenu
                            label={`Priority: ${priority.label}`}
                            value={issue.priority}
                            options={ISSUE_PRIORITIES.map((value) => ({
                                value,
                                label: PRIORITY[value].label,
                                icon: PRIORITY[value].icon,
                                color: PRIORITY[value].color,
                            }))}
                            onChange={(value) =>
                                save({
                                    intent: 'edit-issue',
                                    priority: value as IssuePriority,
                                })
                            }
                        >
                            <priority.icon
                                aria-hidden="true"
                                className={cx('size-4', priority.color)}
                            />
                            {priority.label}
                        </PickerMenu>
                    </Property>
                    <Property label="Assignee">
                        <PickerMenu
                            label={`Assignee: ${assignee?.name ?? 'Unassigned'}`}
                            value={issue.assigneeId ?? UNASSIGNED}
                            options={[
                                {
                                    value: UNASSIGNED,
                                    label: 'Unassigned',
                                    icon: UserIcon,
                                    color: 'text-muted-foreground',
                                },
                                ...people.map((person) => ({
                                    value: person.id,
                                    label: person.name,
                                    icon: UserIcon,
                                    color: 'text-foreground',
                                })),
                            ]}
                            onChange={(value) =>
                                save({
                                    intent: 'edit-issue',
                                    assigneeId:
                                        value === UNASSIGNED ? '' : value,
                                })
                            }
                        >
                            {assignee ? (
                                <Avatar person={assignee} size="sm" />
                            ) : (
                                <UserIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-4"
                                />
                            )}
                            {assignee?.name ?? 'Unassigned'}
                        </PickerMenu>
                    </Property>
                    {issue.links.length > 0 && (
                        <Property label="Linked">
                            <ul className="flex flex-col gap-1">
                                {issue.links.map((id) => {
                                    const kind = kindOf(id);
                                    const Icon = kind
                                        ? KIND_ICONS[kind]
                                        : FileTextIcon;
                                    return (
                                        <li key={id}>
                                            <Link
                                                to={links.item(id)}
                                                className="hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2"
                                            >
                                                <Icon
                                                    aria-hidden="true"
                                                    className="text-muted-foreground size-3.5 shrink-0"
                                                />
                                                <span className="truncate">
                                                    {titleOf(id) ?? id}
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Property>
                    )}
                    <p className="text-muted-foreground mt-auto px-2 pt-3 text-xs">
                        Updated{' '}
                        <time
                            dateTime={issue.updatedAt}
                            suppressHydrationWarning
                        >
                            {when(issue.updatedAt)}
                        </time>
                    </p>
                </aside>
            </div>
        </div>
    );
}

function Property({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-0.5 py-1">
            <span className="text-muted-foreground px-2 text-xs">{label}</span>
            {children}
        </div>
    );
}

type Option = {
    value: string;
    label: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: 'true' }>;
    color: string;
};

/** A property you click to change, Linear-style: its value, then a menu. */
function PickerMenu({
    label,
    value,
    options,
    onChange,
    children,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
    children: React.ReactNode;
}) {
    return (
        <Menu>
            <MenuTrigger
                aria-label={label}
                className="hover:bg-accent focus-visible:ring-ring data-popup-open:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2"
            >
                {children}
            </MenuTrigger>
            <MenuPopup align="start" className="w-44">
                <MenuRadioGroup
                    value={value}
                    onValueChange={(next: string) => onChange(next)}
                >
                    {options.map((option) => (
                        <MenuRadioItem
                            key={option.value}
                            value={option.value}
                            closeOnClick
                        >
                            <span className="flex items-center gap-2">
                                <option.icon
                                    aria-hidden="true"
                                    className={cx('size-3.5', option.color)}
                                />
                                {option.label}
                            </span>
                        </MenuRadioItem>
                    ))}
                </MenuRadioGroup>
            </MenuPopup>
        </Menu>
    );
}
