import { Component, use, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSubmit } from 'react-router';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import {
    createStateStore,
    type Spec,
    type StateStore,
} from '@json-render/core';
import { JSONUIProvider, Renderer } from '@json-render/react';
import { LayoutDashboardIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { isAgentMade, type UiItem } from '~/lib/surface';
import { uiData, uiSpecProblems } from '~/lib/ui-card';
import { AgentBadge, AgentStripe } from './AgentMark';
import { CardTitle } from './CardTitle';
import { LinkHandle } from './LinkHandle';
import { uiRegistry } from './UiRegistry';
import {
    FocusedItemContext,
    useSurfaceItems,
    useSurfaceLinks,
    useSurfacePeople,
    useWindowColors,
} from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';

export type UiNode = FlowNode<{ item: UiItem }, 'ui'>;

let nextAction = 0;

/**
 * The catalog's actions, as the surface's own changes, posted like a click
 * anywhere else on the canvas (so a moved issue shows on its board at once,
 * from the same pending fetcher). json-render hands `{ "$item": "id" }`
 * params over as the item's state path (`/boards/0/issues/2/id`, so
 * `setState` can aim at it); those are read back from the card's store.
 */
function useUiActions(store: StateStore) {
    const links = useSurfaceLinks();
    const submit = useSubmit();
    const navigate = useNavigate();
    return useMemo(() => {
        const post = (fields: Record<string, string>) =>
            submit(fields, {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `ui-action-${nextAction++}`,
            });
        const value = (params: Record<string, unknown>, key: string) => {
            let raw = params[key];
            if (typeof raw === 'string' && raw.startsWith('/')) {
                const stored = store.get(raw);
                if (stored !== undefined && typeof stored !== 'object') {
                    raw = stored;
                }
            }
            return raw === null || raw === undefined ? '' : String(raw);
        };
        return {
            openCard: (params: Record<string, unknown>) => {
                const cardId = value(params, 'cardId');
                if (cardId) navigate(links.item(cardId));
            },
            moveIssue: (params: Record<string, unknown>) =>
                post({
                    intent: 'move-issue',
                    boardId: value(params, 'boardId'),
                    issueId: value(params, 'issueId'),
                    status: value(params, 'status'),
                }),
            createIssue: (params: Record<string, unknown>) => {
                const title = value(params, 'title').trim();
                if (!title) return;
                return post({
                    intent: 'create-issue',
                    boardId: value(params, 'boardId'),
                    title,
                    status: value(params, 'status') || 'backlog',
                });
            },
            setPullRequestStatus: (params: Record<string, unknown>) =>
                post({
                    intent: 'set-pr-status',
                    pullRequestId: value(params, 'pullRequestId'),
                    status: value(params, 'status'),
                }),
            postMessage: (params: Record<string, unknown>) => {
                const text = value(params, 'text').trim();
                if (!text) return;
                return post({
                    intent: 'post-message',
                    chatId: value(params, 'chatId'),
                    text,
                });
            },
            addNote: (params: Record<string, unknown>) => {
                const text = value(params, 'text').trim();
                if (!text) return;
                return post({
                    intent: 'create-card',
                    kind: 'note',
                    title: text,
                });
            },
        };
    }, [submit, navigate, links, store]);
}

/**
 * The card's state: the spec's own (`spec.state`, under `/ui`) plus the
 * surface's live data (`uiData`), which replaces its keys on every change
 * so bound values follow the surface. A new spec starts fresh.
 */
function useUiStore(item: UiItem) {
    const { items } = useSurfaceItems();
    const { people, meId } = useSurfacePeople();
    const data = useMemo(
        () => uiData(items, people, meId),
        [items, people, meId],
    );
    const [store] = useState(() =>
        createStateStore({ ...(item.spec.state ?? {}), ...data }),
    );
    useEffect(() => {
        store.update(
            Object.fromEntries(
                Object.entries(data).map(([key, value]) => [`/${key}`, value]),
            ),
        );
    }, [store, data]);
    return store;
}

/** A spec that throws while drawing shows why, instead of the canvas going. */
class SpecBoundary extends Component<
    { children: ReactNode },
    { error: string | null }
> {
    state = { error: null as string | null };
    static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error.message : 'It broke.' };
    }
    render() {
        if (this.state.error) {
            return <Problem lines={[this.state.error]} />;
        }
        return this.props.children;
    }
}

function Problem({ lines }: { lines: string[] }) {
    return (
        <div
            role="alert"
            className="border-destructive/40 bg-destructive/8 rounded-xl border px-3 py-2.5 text-sm"
        >
            <p className="font-medium">This card can&apos;t be drawn.</p>
            <ul className="text-muted-foreground mt-1 list-disc ps-4 text-xs">
                {lines.slice(0, 5).map((line) => (
                    <li key={line}>{line}</li>
                ))}
            </ul>
        </div>
    );
}

function UiBody({ item }: { item: UiItem }) {
    const store = useUiStore(item);
    const handlers = useUiActions(store);
    const problems = useMemo(() => uiSpecProblems(item.spec), [item.spec]);
    if (problems.length > 0) return <Problem lines={problems} />;
    return (
        <JSONUIProvider registry={uiRegistry} store={store} handlers={handlers}>
            <SpecBoundary>
                <Renderer spec={item.spec as Spec} registry={uiRegistry} />
            </SpecBoundary>
        </JSONUIProvider>
    );
}

/**
 * A UI card: an interface an agent composed from the UI catalog, drawn with
 * the app's components and bound to the surface's live data.
 */
export function UiWindow({ data, selected }: NodeProps<UiNode>) {
    const item = data.item;
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === item.id;

    return (
        <div className="group/window relative size-full">
            <Handle type="target" position="top" />
            <LinkHandle />
            <WindowControls
                itemId={item.id}
                title={item.title}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={item.id}
                title={item.title}
                kind="UI"
                rounded="rounded-2xl"
            />
            <article
                aria-label={`UI: ${item.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-2xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(item.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(item) && <AgentStripe />}
                <header className="flex cursor-grab items-center gap-2 border-b px-4 pt-3 pb-2 active:cursor-grabbing">
                    <LayoutDashboardIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4 shrink-0"
                    />
                    <CardTitle
                        itemId={item.id}
                        title={item.title}
                        className="min-w-0 flex-1 truncate text-sm font-semibold"
                    />
                    {isAgentMade(item) && <AgentBadge />}
                </header>
                <div className="nodrag nowheel min-h-0 flex-1 cursor-auto overflow-y-auto p-4">
                    {/* A new spec (an agent's update) starts from its own state. */}
                    <UiBody key={item.updatedAt} item={item} />
                </div>
            </article>
        </div>
    );
}
