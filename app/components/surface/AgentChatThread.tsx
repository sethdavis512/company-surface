import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import { useChat } from '@ai-sdk/react';
import {
    DefaultChatTransport,
    getToolName,
    isToolUIPart,
    type UIMessage,
} from 'ai';
import {
    AlertCircleIcon,
    CheckIcon,
    LoaderCircleIcon,
    RotateCcwIcon,
    SendHorizontalIcon,
    SquareIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import { Button } from '~/components/ui/button';
import { markdownToPortableText } from '~/lib/portable-text';
import { AGENT_ID, type ChatItem, type SurfaceItemKind } from '~/lib/surface';
import type { SurfaceAgentUIMessage } from '~/agent/surface-agent.server';
import { Avatar } from './Avatar';
import { DocumentBody } from './DocumentBody';
import { KIND_ICONS, KIND_NAMES } from './kind-icons';
import { useZoomToWindow } from './ZoomOverlay';
import {
    FocusedItemContext,
    useSurfaceLinks,
    useSurfacePeople,
} from './surface-context';

type Part = UIMessage['parts'][number];

/** What each tool says while it runs, and once it's done. */
const TOOL_LOOKS: Record<string, { doing: string; done: string }> = {
    list_spaces: { doing: 'Looking over the workspace', done: 'Looked over' },
    list_cards: { doing: 'Looking over the surface', done: 'Looked over' },
    read_card: { doing: 'Reading', done: 'Read' },
    search: { doing: 'Searching', done: 'Searched' },
    create_document: { doing: 'Writing a document', done: 'Wrote' },
    append_to_document: { doing: 'Adding to a document', done: 'Added to' },
    create_chart: { doing: 'Drawing a chart', done: 'Made' },
    create_board: { doing: 'Starting a board', done: 'Started' },
    create_issue: { doing: 'Filing an issue', done: 'Filed an issue on' },
    update_issue: { doing: 'Updating an issue', done: 'Updated an issue on' },
    add_note: { doing: 'Pinning a note', done: 'Pinned' },
    add_sketch: { doing: 'Sketching', done: 'Drew' },
    add_web_page: { doing: 'Opening a page', done: 'Opened' },
    add_video: { doing: 'Adding a video', done: 'Added' },
    add_image: { doing: 'Adding an image', done: 'Added' },
    open_pull_request: { doing: 'Opening a pull request', done: 'Opened' },
    link_cards: { doing: 'Linking cards', done: 'Linked' },
    get_layout: {
        doing: 'Looking at the layout',
        done: 'Looked at the layout',
    },
    arrange_cards: { doing: 'Arranging the canvas', done: 'Arranged' },
    move_card: { doing: 'Moving a card', done: 'Moved' },
    rename_card: { doing: 'Renaming a card', done: 'Renamed' },
    set_card_color: { doing: 'Recoloring a card', done: 'Recolored' },
    // Mastra's own tool for the workspace's working memory.
    updateWorkingMemory: {
        doing: 'Remembering',
        done: 'Saved to workspace memory',
    },
};

/** Tools that only look: shown as a quiet line, not a card. */
const READ_TOOLS = new Set([
    'list_spaces',
    'list_cards',
    'read_card',
    'search',
    'get_layout',
    'updateWorkingMemory',
]);

const STARTERS = [
    'Draft a one-page launch plan for a new mobile app',
    'Chart weekly signups for the last 8 weeks and explain the trend',
    'Start a board for a website redesign with 5 issues',
    'Brainstorm 4 sticky notes of team offsite ideas',
];

type CardRef = { id: string; kind: SurfaceItemKind; title: string };

function cardRefOf(value: unknown): CardRef | null {
    if (!value || typeof value !== 'object') return null;
    const { id, kind, title } = value as Record<string, unknown>;
    return typeof id === 'string' &&
        typeof kind === 'string' &&
        kind in KIND_NAMES &&
        typeof title === 'string'
        ? { id, kind: kind as SurfaceItemKind, title }
        : null;
}

function textOf(message: UIMessage): string {
    return message.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');
}

/**
 * A chat with the live agent (Claude, via `/api/agent-chat`): your message
 * shows at once, the reply streams in with a card for each thing the agent
 * makes, and the canvas picks the new cards up as each tool finishes. What
 * the store has saved comes from the loader; the turn in flight comes from
 * `useChat` until the store has it too (same message ids).
 */
export function AgentChatThread({
    chat,
    live,
}: {
    chat: ChatItem;
    /** Off without an Anthropic key: the chat says so instead of answering. */
    live: boolean;
}) {
    const revalidator = useRevalidator();
    const { meId } = useSurfacePeople();
    const [draft, setDraft] = useState('');
    const listRef = useRef<HTMLOListElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [transport] = useState(
        () =>
            new DefaultChatTransport<SurfaceAgentUIMessage>({
                api: '/api/agent-chat',
                // The server holds the history; send only the new message.
                prepareSendMessagesRequest: ({ messages }) => {
                    const last = messages
                        .filter((message) => message.role === 'user')
                        .at(-1);
                    return {
                        body: {
                            chatId: chat.id,
                            message: {
                                id: last?.id,
                                text: last ? textOf(last) : '',
                            },
                        },
                    };
                },
            }),
    );
    const {
        messages: streamed,
        sendMessage,
        regenerate,
        stop,
        status,
        error,
        clearError,
    } = useChat<SurfaceAgentUIMessage>({
        id: chat.id,
        transport,
        onFinish: () => revalidator.revalidate(),
    });
    const busy = status === 'submitted' || status === 'streaming';

    // Each finished tool call may have put a card on the canvas: fetch it now
    // rather than at the next poll.
    const toolsDone = streamed
        .flatMap((message) => message.parts)
        .filter(
            (part) => isToolUIPart(part) && part.state === 'output-available',
        ).length;
    useEffect(() => {
        if (toolsDone > 0) revalidator.revalidate();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- on each new result
    }, [toolsDone]);

    const saved = new Set(chat.messages.map((message) => message.id));
    const pending = streamed.filter((message) => !saved.has(message.id));
    const askedYet = chat.messages.some((m) => m.authorId === meId);
    // Another tab's turn, or this one's before the first word arrives.
    const thinking =
        status === 'submitted' || (!busy && Boolean(chat.awaitingReply));

    // Follow the conversation as it grows, unless you've scrolled up to read.
    const following = useRef(true);
    useEffect(() => {
        const list = listRef.current;
        if (list && following.current) list.scrollTop = list.scrollHeight;
    });

    function send(text: string) {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        clearError();
        following.current = true;
        void sendMessage({ text: trimmed });
        setDraft('');
    }

    return (
        <>
            <ol
                ref={listRef}
                aria-label="Messages"
                aria-busy={busy}
                onScroll={(event) => {
                    const list = event.currentTarget;
                    following.current =
                        list.scrollHeight - list.scrollTop - list.clientHeight <
                        48;
                }}
                className="nodrag nowheel flex min-h-0 flex-1 cursor-auto scrollbar-none flex-col gap-3 overflow-y-auto px-4 py-4"
            >
                {chat.messages.map((message) =>
                    message.authorId === AGENT_ID ? (
                        <AgentMessage
                            key={message.id}
                            id={message.id}
                            parts={
                                message.parts ?? [
                                    { type: 'text', text: message.text },
                                ]
                            }
                        />
                    ) : (
                        <MyMessage
                            key={message.id}
                            id={message.id}
                            authorId={message.authorId}
                            text={message.text}
                        />
                    ),
                )}
                {pending.map((message) =>
                    message.role === 'assistant' ? (
                        <AgentMessage
                            key={message.id}
                            id={message.id}
                            parts={message.parts}
                            streaming={busy}
                        />
                    ) : (
                        <MyMessage
                            key={message.id}
                            id={message.id}
                            authorId={meId}
                            text={textOf(message)}
                        />
                    ),
                )}
                {thinking && <Thinking />}
                {error && (
                    <li
                        role="alert"
                        className="bg-destructive/8 text-destructive flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
                    >
                        <AlertCircleIcon
                            aria-hidden="true"
                            className="size-4 shrink-0"
                        />
                        <span className="flex-1">
                            {error.message || 'The agent could not answer.'}
                        </span>
                        <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                                clearError();
                                void regenerate();
                            }}
                        >
                            <RotateCcwIcon aria-hidden="true" />
                            Retry
                        </Button>
                    </li>
                )}
            </ol>

            {!live && (
                <p
                    role="status"
                    className="text-muted-foreground border-t px-5 pt-3 pb-5 text-xs leading-snug"
                >
                    The live agent is off: this server has no{' '}
                    <code className="text-foreground">ANTHROPIC_API_KEY</code>.
                    Add it to the env file and restart the dev server.
                </p>
            )}

            {live && !askedYet && pending.length === 0 && (
                <div
                    aria-label="Try asking"
                    role="group"
                    className="nodrag nowheel flex scrollbar-none gap-1.5 overflow-x-auto px-4 pb-2"
                >
                    {STARTERS.map((starter) => (
                        <button
                            key={starter}
                            type="button"
                            onClick={() => send(starter)}
                            className="bg-muted hover:bg-accent focus-visible:ring-ring w-44 shrink-0 rounded-xl px-3 py-2 text-left text-xs leading-snug outline-none focus-visible:ring-2"
                        >
                            {starter}
                        </button>
                    ))}
                </div>
            )}

            <form
                hidden={!live}
                onSubmit={(event) => {
                    event.preventDefault();
                    send(draft);
                    inputRef.current?.focus();
                }}
                className="flex items-center gap-2 border-t px-4 pt-3 pb-5"
            >
                <input
                    ref={inputRef}
                    name="text"
                    autoComplete="off"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-label={`Message ${chat.title}`}
                    placeholder="Ask the agent to make something"
                    className="nodrag bg-muted placeholder:text-muted-foreground focus-visible:ring-ring min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none focus-visible:ring-2"
                />
                {busy ? (
                    <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label="Stop"
                        onClick={() => void stop()}
                        className="nodrag rounded-full"
                    >
                        <SquareIcon
                            aria-hidden="true"
                            className="fill-current"
                        />
                    </Button>
                ) : (
                    <Button
                        type="submit"
                        size="icon"
                        aria-label="Send"
                        disabled={!draft.trim()}
                        className="nodrag rounded-full"
                    >
                        <SendHorizontalIcon aria-hidden="true" />
                    </Button>
                )}
            </form>
            <span className="sr-only" aria-live="polite">
                {status === 'streaming' ? 'The agent is answering' : ''}
            </span>
        </>
    );
}

function MyMessage({
    id,
    authorId,
    text,
}: {
    id: string;
    authorId: string;
    text: string;
}) {
    const { meId, personById } = useSurfacePeople();
    const mine = authorId === meId;
    return (
        <li
            data-message-id={id}
            className={cx('flex items-end gap-2', mine && 'flex-row-reverse')}
        >
            {!mine && <Avatar person={personById(authorId)} size="sm" />}
            <p
                className={cx(
                    'max-w-[min(78%,36rem)] rounded-2xl px-3.5 py-2 text-sm leading-snug wrap-anywhere whitespace-pre-wrap',
                    mine
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md',
                )}
            >
                {text}
            </p>
        </li>
    );
}

function AgentMessage({
    id,
    parts,
    streaming = false,
}: {
    id: string;
    parts: Part[];
    streaming?: boolean;
}) {
    const { personById } = useSurfacePeople();
    const shown = parts.filter(
        (part) =>
            (part.type === 'text' && part.text.trim()) || isToolUIPart(part),
    );
    if (shown.length === 0) return null;
    return (
        <li data-message-id={id} className="flex items-start gap-2">
            <Avatar person={personById(AGENT_ID)} size="sm" />
            <div className="flex max-w-[min(85%,40rem)] min-w-0 flex-1 flex-col gap-1.5">
                {shown.map((part, index) =>
                    part.type === 'text' ? (
                        <AgentText
                            key={index}
                            text={part.text}
                            streaming={streaming && index === shown.length - 1}
                        />
                    ) : isToolUIPart(part) ? (
                        <ToolCard key={part.toolCallId} part={part} />
                    ) : null,
                )}
            </div>
        </li>
    );
}

function AgentText({ text, streaming }: { text: string; streaming: boolean }) {
    const blocks = useMemo(() => markdownToPortableText(text), [text]);
    return (
        <div
            className={cx(
                'bg-muted text-foreground prose prose-sm dark:prose-invert w-fit max-w-full rounded-2xl rounded-tl-md px-3.5 py-2 leading-snug wrap-anywhere',
                '[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
                streaming &&
                    "after:bg-foreground/60 after:ms-0.5 after:inline-block after:h-3.5 after:w-1.5 after:animate-pulse after:align-middle after:content-[''] motion-reduce:after:animate-none",
            )}
        >
            <DocumentBody blocks={blocks} />
        </div>
    );
}

type ToolPart = Extract<Part, { toolCallId: string }>;

function ToolCard({ part }: { part: ToolPart }) {
    const name = getToolName(part);
    const looks = TOOL_LOOKS[name] ?? { doing: 'Working', done: 'Done' };
    const input = (part.input ?? {}) as Record<string, unknown>;
    const inputTitle =
        typeof input.title === 'string' ? input.title : undefined;

    if (part.state === 'output-error') {
        return (
            <p className="text-destructive flex items-start gap-1.5 px-1 text-xs">
                <AlertCircleIcon
                    aria-hidden="true"
                    className="mt-px size-3.5 shrink-0"
                />
                <span>
                    {looks.doing} failed: {part.errorText}
                </span>
            </p>
        );
    }
    if (part.state !== 'output-available') {
        return (
            <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                />
                <span className="truncate">
                    {looks.doing}
                    {inputTitle && `: ${inputTitle}`}…
                </span>
            </p>
        );
    }

    const output = part.output as Record<string, unknown>;
    if (READ_TOOLS.has(name)) {
        const card = cardRefOf(output);
        const detail =
            name === 'get_layout' || name === 'updateWorkingMemory'
                ? ''
                : name === 'list_spaces'
                  ? `${(output.spaces as unknown[]).length} spaces`
                  : name === 'list_cards'
                    ? `${(output.cards as unknown[]).length} cards`
                    : name === 'search'
                      ? `“${String(input.query)}”`
                      : card?.title;
        return (
            <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                    {looks.done} {detail}
                </span>
            </p>
        );
    }
    if (name === 'arrange_cards') {
        const groups = (output.groups as unknown[]).length;
        return (
            <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                    Arranged {String(output.moved)} cards in {groups}{' '}
                    {groups === 1 ? 'group' : 'groups'}
                </span>
            </p>
        );
    }
    if (name === 'link_cards') {
        const from = cardRefOf(output.from);
        const to = cardRefOf(output.to);
        return (
            <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                    Linked {from?.title} → {to?.title} ({String(output.label)})
                </span>
            </p>
        );
    }

    const card = cardRefOf(output);
    if (!card) return null;
    const issue = output.issue as
        { identifier: string; title: string } | undefined;
    return (
        <MadeCard
            card={card}
            verb={looks.done}
            detail={issue ? `${issue.identifier} ${issue.title}` : undefined}
        />
    );
}

/** A card the agent made or changed: click to fly the canvas to it. */
function MadeCard({
    card,
    verb,
    detail,
}: {
    card: CardRef;
    verb: string;
    detail?: string;
}) {
    const links = useSurfaceLinks();
    const navigate = useNavigate();
    const zoomTo = useZoomToWindow();
    const chatFocused = use(FocusedItemContext) !== undefined;
    const Icon = KIND_ICONS[card.kind];
    return (
        <button
            type="button"
            title={chatFocused ? 'Open it' : 'Show it on the canvas'}
            onClick={() => {
                if (chatFocused || !zoomTo(card.id)) {
                    void navigate(links.item(card.id));
                }
            }}
            className="bg-card hover:bg-accent focus-visible:ring-ring motion-safe:animate-card-in flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left shadow-xs outline-none focus-visible:ring-2"
        >
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-[11px]">
                    {verb} {KIND_NAMES[card.kind].toLowerCase()}
                </span>
                <span className="truncate text-sm font-medium">
                    {card.title}
                </span>
                {detail && (
                    <span className="text-muted-foreground truncate text-xs">
                        {detail}
                    </span>
                )}
            </span>
        </button>
    );
}

function Thinking() {
    return (
        <li
            aria-live="polite"
            className="text-muted-foreground flex items-center gap-1 px-1 text-xs"
        >
            <span className="sr-only">The agent is thinking</span>
            {[0, 1, 2].map((dot) => (
                <span
                    key={dot}
                    aria-hidden="true"
                    style={{ animationDelay: `${dot * 150}ms` }}
                    className="bg-muted-foreground size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
                />
            ))}
        </li>
    );
}
