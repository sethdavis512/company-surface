import { use, useEffect, useRef, useState } from 'react';
import { Link, useFetcher, useRouteLoaderData } from 'react-router';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import { GitPullRequestIcon, SendHorizontalIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { Button } from '~/components/ui/button';
import {
    isAgentChat,
    MEMBER_ROLE,
    isAgentMade,
    type ChatItem,
    type ChatMessage,
} from '~/lib/surface';
import type {
    action as surfaceAction,
    loader as surfaceLoader,
} from '~/routes/surface';
import { AgentChatThread } from './AgentChatThread';
import { Avatar } from './Avatar';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import {
    FocusedItemContext,
    useSurfaceItems,
    useSurfacePeople,
    useWindowColors,
    useSurfaceLinks,
} from './surface-context';
import { AgentBadge, AgentStripe } from './AgentMark';
import { PULL_REQUEST_STATUS } from './PullRequestWindow';
import { windowBorderClass } from './window-colors';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type ChatNode = FlowNode<{ item: ChatItem }, 'chat'>;

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function ChatWindow({ data, selected }: NodeProps<ChatNode>) {
    const links = useSurfaceLinks();
    const chat = data.item;
    const { meId, personById } = useSurfacePeople();
    const focused = use(FocusedItemContext) === chat.id;
    const { colorOf } = useWindowColors();
    const pullRequests = useSurfaceItems().pullRequestsFrom(chat.id);
    const agentChat = isAgentChat(
        chat,
        (id) => personById(id)?.role === MEMBER_ROLE,
    );
    const liveAgent =
        useRouteLoaderData<typeof surfaceLoader>('routes/surface')
            ?.liveAgent === true && agentChat;

    const others = chat.participantIds
        .filter((id) => id !== meId)
        .map((id) => personById(id));
    const isGroup = others.length > 1;
    const subtitle = liveAgent
        ? 'Claude, live'
        : agentChat
          ? 'Live agent off'
          : isGroup
            ? `${chat.participantIds.length} people`
            : (others[0]?.role ?? '');

    return (
        <div className="group/window relative size-full">
            <Handle type="source" position="top" />
            <LinkHandle />
            {/* Pull requests hang below their chat. */}
            <Handle id="bottom" type="source" position="bottom" />
            <WindowControls
                itemId={chat.id}
                title={chat.title}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={chat.id}
                title={chat.title}
                kind="Chat"
                rounded="rounded-[2rem]"
            />
            <section
                aria-label={`Chat: ${chat.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-[2rem] shadow-lg transition-shadow',
                    windowBorderClass(colorOf(chat.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(chat) && <AgentStripe />}
                <header className="flex cursor-grab items-center gap-3 border-b px-5 pt-5 pb-3 active:cursor-grabbing">
                    <div className="flex -space-x-1.5">
                        {others.slice(0, 3).map((person, index) => (
                            <Avatar key={person?.id ?? index} person={person} />
                        ))}
                    </div>
                    <div className="min-w-0">
                        <CardTitle
                            itemId={chat.id}
                            title={chat.title}
                            className="truncate text-sm font-semibold"
                        />
                        <p className="text-muted-foreground truncate text-xs">
                            {subtitle}
                        </p>
                    </div>
                    {isAgentMade(chat) && <AgentBadge className="ms-auto" />}
                </header>

                {pullRequests.length > 0 && (
                    <nav
                        aria-label="Pull requests from this chat"
                        className="nodrag nowheel flex scrollbar-none gap-1.5 overflow-x-auto border-b px-4 py-2"
                    >
                        {pullRequests.map((pr) => (
                            <Link
                                key={pr.id}
                                to={links.item(pr.id)}
                                title={pr.title}
                                className="bg-muted hover:bg-accent focus-visible:ring-ring flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs outline-none focus-visible:ring-2"
                            >
                                <GitPullRequestIcon
                                    aria-hidden="true"
                                    className={cx(
                                        'size-3.5',
                                        PULL_REQUEST_STATUS[pr.status].icon,
                                    )}
                                />
                                #{pr.number}
                            </Link>
                        ))}
                    </nav>
                )}

                {agentChat ? (
                    <AgentChatThread chat={chat} live={liveAgent} />
                ) : (
                    <PeopleChatThread chat={chat} isGroup={isGroup} />
                )}
            </section>
        </div>
    );
}

/** A chat between people, answered by the mock reply service. */
function PeopleChatThread({
    chat,
    isGroup,
}: {
    chat: ChatItem;
    isGroup: boolean;
}) {
    const links = useSurfaceLinks();
    const { meId, personById } = useSurfacePeople();
    const fetcher = useFetcher<typeof surfaceAction>();
    const [draft, setDraft] = useState('');
    const listRef = useRef<HTMLOListElement>(null);

    // Show my message right away; the server's copy replaces it once saved.
    const sending = fetcher.state !== 'idle';
    const pendingText = sending ? fetcher.formData?.get('text') : null;
    const messages: ChatMessage[] =
        typeof pendingText === 'string'
            ? [
                  ...chat.messages,
                  {
                      id: 'pending',
                      authorId: meId,
                      text: pendingText,
                      sentAt: new Date().toISOString(),
                  },
              ]
            : chat.messages;
    const isTyping = sending || Boolean(chat.awaitingReply);

    useEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [messages.length, isTyping]);

    return (
        <>
            <ol
                ref={listRef}
                aria-label="Messages"
                className="nodrag nowheel flex min-h-0 flex-1 cursor-auto scrollbar-none flex-col gap-3 overflow-y-auto px-4 py-4"
            >
                {messages.map((message) => {
                    const mine = message.authorId === meId;
                    const author = personById(message.authorId);
                    return (
                        <li
                            key={message.id}
                            data-message-id={message.id}
                            className={cx(
                                'flex items-end gap-2',
                                mine && 'flex-row-reverse',
                            )}
                        >
                            {!mine && <Avatar person={author} size="sm" />}
                            <div
                                className={cx(
                                    'flex max-w-[min(78%,36rem)] flex-col gap-0.5',
                                    mine && 'items-end',
                                )}
                            >
                                {!mine && isGroup && (
                                    <span className="text-muted-foreground px-1 text-[11px]">
                                        {author?.name}
                                    </span>
                                )}
                                <p
                                    className={cx(
                                        'rounded-2xl px-3.5 py-2 text-sm leading-snug wrap-anywhere',
                                        mine
                                            ? 'bg-primary text-primary-foreground rounded-br-md'
                                            : 'bg-muted text-foreground rounded-bl-md',
                                    )}
                                >
                                    {message.text}
                                </p>
                                <time
                                    dateTime={message.sentAt}
                                    suppressHydrationWarning
                                    className="text-muted-foreground px-1 text-[10px]"
                                >
                                    {formatTime(message.sentAt)}
                                </time>
                            </div>
                        </li>
                    );
                })}
                {isTyping && (
                    <li
                        aria-live="polite"
                        className="text-muted-foreground flex items-center gap-1 px-1 text-xs"
                    >
                        <span className="sr-only">Someone is typing</span>
                        {[0, 1, 2].map((dot) => (
                            <span
                                key={dot}
                                aria-hidden="true"
                                style={{ animationDelay: `${dot * 150}ms` }}
                                className="bg-muted-foreground size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
                            />
                        ))}
                    </li>
                )}
            </ol>

            <fetcher.Form
                method="post"
                action={links.action}
                onSubmit={(event) => {
                    if (!draft.trim()) event.preventDefault();
                    // Cleared after the form data is read, so it still sends.
                    else setDraft('');
                }}
                className="flex items-center gap-2 border-t px-4 pt-3 pb-5"
            >
                <input type="hidden" name="intent" value="post-message" />
                <input type="hidden" name="chatId" value={chat.id} />
                <input
                    name="text"
                    autoComplete="off"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-label={`Message ${chat.title}`}
                    placeholder="Message"
                    className="bg-muted placeholder:text-muted-foreground focus-visible:ring-ring min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none focus-visible:ring-2"
                />
                <Button
                    type="submit"
                    size="icon"
                    aria-label="Send"
                    disabled={!draft.trim() || sending}
                    className="nodrag rounded-full"
                >
                    <SendHorizontalIcon aria-hidden="true" />
                </Button>
            </fetcher.Form>
        </>
    );
}
