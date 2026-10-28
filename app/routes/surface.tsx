import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, PanelLeftCloseIcon, SearchIcon } from 'lucide-react';
import {
    data,
    redirect,
    isRouteErrorResponse,
    Link,
    Outlet,
    useLocation,
    useParams,
    useRevalidator,
    type ShouldRevalidateFunctionArgs,
} from 'react-router';
import { z } from 'zod';
import { TrellisProvider } from '@sethdavis512/trellis';
import trellisStyles from '@sethdavis512/trellis/style.css?url';
import { SurfaceCanvas } from '~/components/surface/SurfaceCanvas';
import { AddCardProvider } from '~/components/surface/AddCard';
import { SearchPalette } from '~/components/surface/SearchPalette';
import { NavRail } from '~/components/surface/NavRail';
import { ResizableNav, useNavRail } from '~/components/surface/ResizableNav';
import { SurfaceNav } from '~/components/surface/SurfaceNav';
import { SurfaceSwitcher } from '~/components/surface/SurfaceSwitcher';
import { Button } from '~/components/ui/button';
import { APP_NAME } from '~/config';
import { requireUserFromContext } from '~/context';
import { env } from '~/lib/env.server';
import { authMiddleware } from '~/middleware/auth';
import {
    completeNavOrder,
    navCollapsedSchema,
    navOrderSchema,
} from '~/lib/nav-order';
import { documentBlocksSchema } from '~/lib/portable-text';
import { sketchStrokesSchema } from '~/lib/sketch';
import { readNavPanel } from '~/lib/nav-panel';
import {
    getNavCollapsed,
    getNavOrder,
    serializeNavCollapsed,
    serializeNavOrder,
} from '~/lib/nav-order.server';
import {
    ME_ID,
    SurfaceConflictError,
    SurfaceError,
    createIssue,
    getSurfaceForUser,
    moveWindows,
    addCard,
    updateNote,
    updateSketch,
    setItemLocked,
    linkItems,
    unlinkItems,
    commentOnIssue,
    duplicateItem,
    renameItem,
    deleteItem,
    navigateWebPage,
    resetWindowPositions,
    postMessage,
    deleteView,
    restackItem,
    saveView,
    setItemColor,
    updateDocument,
    setPullRequestStatus,
    updateIssue,
} from '~/models/surface.server';
import {
    ISSUE_PRIORITIES,
    ISSUE_STATUSES,
    TITLE_MAX,
    WINDOW_COLOR_NAMES,
    itemPath,
    pushRecent,
    type SurfaceItem,
} from '~/lib/surface';
import type { Route } from './+types/surface';

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

export const links: Route.LinksFunction = () => [
    { rel: 'stylesheet', href: trellisStyles },
];

/**
 * Typing in the filter bar's search only changes `?q=`, which the canvas
 * reads in the browser: no need to reload the surface for it. Anything
 * else (polling, actions, other URL changes) revalidates as usual.
 */
export function shouldRevalidate({
    currentUrl,
    nextUrl,
    formMethod,
    defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
    if (
        (formMethod === undefined || formMethod === 'GET') &&
        currentUrl.pathname === nextUrl.pathname &&
        currentUrl.search !== nextUrl.search
    ) {
        const withoutQuery = (url: URL) => {
            const params = new URLSearchParams(url.search);
            params.delete('q');
            return params.toString();
        };
        if (withoutQuery(currentUrl) === withoutQuery(nextUrl)) return false;
    }
    return defaultShouldRevalidate;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
    const user = requireUserFromContext(context);
    const surface = await getSurfaceForUser(user, params.surfaceId);
    if (!surface) throw data('Surface not found', { status: 404 });
    return {
        surface,
        navOrder: await getNavOrder(request),
        navCollapsed: await getNavCollapsed(request),
        navPanel: readNavPanel(request.headers.get('Cookie')),
        /** Agent chats answer for real (Claude) instead of from the mock. */
        liveAgent: Boolean(env.ANTHROPIC_API_KEY),
    };
}

const intentSchema = z.discriminatedUnion('intent', [
    z.object({
        intent: z.literal('post-message'),
        chatId: z.string().min(1),
        text: z.string().trim().min(1).max(4000),
    }),
    z.object({
        intent: z.literal('restack'),
        itemId: z.string().min(1),
        to: z.enum(['front', 'back']),
    }),
    z.object({
        intent: z.literal('save-view'),
        name: z.string().trim().min(1).max(60),
        x: z.coerce.number().finite(),
        y: z.coerce.number().finite(),
        zoom: z.coerce.number().positive().max(10),
    }),
    z.object({
        intent: z.literal('delete-view'),
        viewId: z.string().min(1),
    }),
    z.object({
        intent: z.literal('set-pr-status'),
        pullRequestId: z.string().min(1),
        status: z.enum(['draft', 'open', 'merged', 'closed']),
    }),
    z.object({
        intent: z.literal('move-issue'),
        boardId: z.string().min(1),
        issueId: z.string().min(1),
        status: z.enum(ISSUE_STATUSES),
        index: z.coerce.number().int().min(0).optional(),
    }),
    z.object({
        intent: z.literal('edit-issue'),
        boardId: z.string().min(1),
        issueId: z.string().min(1),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(10000).optional(),
        priority: z.enum(ISSUE_PRIORITIES).optional(),
        // '' unassigns.
        assigneeId: z.string().optional(),
    }),
    z.object({
        intent: z.literal('comment-issue'),
        boardId: z.string().min(1),
        issueId: z.string().min(1),
        text: z.string().trim().min(1).max(4000),
    }),
    z.object({
        intent: z.literal('create-issue'),
        boardId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
        status: z.enum(ISSUE_STATUSES),
    }),
    z.object({
        intent: z.literal('update-document'),
        documentId: z.string().min(1),
        baseUpdatedAt: z.string().min(1),
        blocks: z
            .string()
            .transform((raw, ctx) => {
                try {
                    return JSON.parse(raw) as unknown;
                } catch {
                    ctx.addIssue({ code: 'custom', message: 'Not JSON' });
                    return z.NEVER;
                }
            })
            .pipe(documentBlocksSchema),
    }),
    z.object({
        intent: z.literal('create-card'),
        kind: z.enum([
            'chat',
            'document',
            'board',
            'video',
            'web',
            'image',
            'chart',
            'pull-request',
            'note',
            'sketch',
        ]),
        title: z.string().trim().max(160).optional(),
        url: z.string().trim().max(2000).optional(),
        attachedTo: z.string().min(1).optional(),
        x: z.coerce.number().finite().optional(),
        y: z.coerce.number().finite().optional(),
    }),
    z.object({
        intent: z.literal('link-cards'),
        from: z.string().min(1),
        to: z.string().min(1),
        label: z.string().trim().min(1).max(40).default('related'),
    }),
    z.object({
        intent: z.literal('unlink-cards'),
        relationId: z.string().min(1),
    }),
    z.object({
        intent: z.literal('set-lock'),
        itemId: z.string().min(1),
        locked: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true'),
        x: z.coerce.number().finite().optional(),
        y: z.coerce.number().finite().optional(),
    }),
    z.object({
        intent: z.literal('update-note'),
        noteId: z.string().min(1),
        text: z.string().max(4000),
    }),
    z.object({
        intent: z.literal('update-sketch'),
        sketchId: z.string().min(1),
        strokes: z
            .string()
            .max(500_000)
            .transform((value, ctx) => {
                try {
                    return JSON.parse(value) as unknown;
                } catch {
                    ctx.addIssue({ code: 'custom', message: 'Not JSON' });
                    return z.NEVER;
                }
            })
            .pipe(sketchStrokesSchema),
    }),
    z.object({
        intent: z.literal('delete-card'),
        itemId: z.string().min(1),
    }),
    z.object({
        intent: z.literal('rename-card'),
        itemId: z.string().min(1),
        title: z.string().trim().min(1).max(TITLE_MAX),
    }),
    z.object({
        intent: z.literal('duplicate'),
        itemId: z.string().min(1),
        x: z.coerce.number().finite().optional(),
        y: z.coerce.number().finite().optional(),
    }),
    z.object({
        intent: z.literal('navigate-web'),
        webId: z.string().min(1),
        url: z.string().trim().min(1).max(2000),
    }),
    z.object({
        intent: z.literal('move-windows'),
        positions: z
            .string()
            .transform((raw, ctx) => {
                try {
                    return JSON.parse(raw) as unknown;
                } catch {
                    ctx.addIssue({ code: 'custom', message: 'Not JSON' });
                    return z.NEVER;
                }
            })
            .pipe(
                z.record(
                    z.string(),
                    z.object({
                        x: z.number().finite(),
                        y: z.number().finite(),
                    }),
                ),
            ),
    }),
    z.object({ intent: z.literal('reset-positions') }),
    z.object({
        intent: z.literal('set-nav-order'),
        order: z
            .string()
            .transform((raw, ctx) => {
                try {
                    return JSON.parse(raw) as unknown;
                } catch {
                    ctx.addIssue({ code: 'custom', message: 'Not JSON' });
                    return z.NEVER;
                }
            })
            .pipe(navOrderSchema),
    }),
    z.object({
        intent: z.literal('set-nav-collapsed'),
        collapsed: z
            .string()
            .transform((raw, ctx) => {
                try {
                    return JSON.parse(raw) as unknown;
                } catch {
                    ctx.addIssue({ code: 'custom', message: 'Not JSON' });
                    return z.NEVER;
                }
            })
            .pipe(navCollapsedSchema),
    }),
    z.object({
        intent: z.literal('set-color'),
        itemId: z.string().min(1),
        // An empty color goes back to the default border.
        color: z
            .union([z.enum(WINDOW_COLOR_NAMES), z.literal('')])
            .transform((color) => color || null),
    }),
]);

/**
 * The canvas's mutations: chat windows post messages, window controls
 * restack and recolor, pull requests and issues move along, boards take new
 * issues, and the nav saves and deletes views. All submit with fetchers (`action="/"`), so the page
 * never navigates, and the loader re-runs to confirm.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
    requireUserFromContext(context);
    const parsed = intentSchema.safeParse(
        Object.fromEntries(await request.formData()),
    );
    if (!parsed.success) {
        return data({ error: 'That change was not valid.' }, { status: 400 });
    }

    const input = parsed.data;
    // A new card: a document opens focused, ready to write in; anything
    // else just appears where it was put.
    if (input.intent === 'create-card') {
        try {
            const card = addCard({
                surfaceId: params.surfaceId,
                kind: input.kind,
                title: input.title,
                url: input.url,
                attachedTo: input.attachedTo,
                position:
                    input.x === undefined || input.y === undefined
                        ? undefined
                        : { x: input.x, y: input.y },
                authorId: ME_ID,
            });
            if (card.kind === 'document') {
                throw redirect(itemPath(params.surfaceId, card.id));
            }
            return { error: null, createdId: card.id };
        } catch (error) {
            if (error instanceof SurfaceError) {
                return data({ error: error.message }, { status: 400 });
            }
            throw error;
        }
    }
    // Documents answer with their new version (the next save's base), or
    // 409 when someone else saved first.
    if (input.intent === 'update-document') {
        try {
            const doc = updateDocument({
                documentId: input.documentId,
                blocks: input.blocks,
                baseUpdatedAt: input.baseUpdatedAt,
                authorId: ME_ID,
            });
            return { error: null, updatedAt: doc.updatedAt };
        } catch (error) {
            if (error instanceof SurfaceConflictError) {
                return data(
                    { error: error.message, conflict: true },
                    { status: 409 },
                );
            }
            if (error instanceof SurfaceError) {
                return data({ error: error.message }, { status: 404 });
            }
            throw error;
        }
    }
    // The nav's order and collapsed sections are this person's, in cookies,
    // not the shared store.
    if (input.intent === 'set-nav-collapsed') {
        return data(
            { error: null },
            {
                headers: {
                    'Set-Cookie': await serializeNavCollapsed(input.collapsed),
                },
            },
        );
    }
    if (input.intent === 'set-nav-order') {
        return data(
            { error: null },
            {
                headers: {
                    'Set-Cookie': await serializeNavOrder(
                        completeNavOrder(input.order),
                    ),
                },
            },
        );
    }
    try {
        if (input.intent === 'post-message') {
            postMessage({
                chatId: input.chatId,
                authorId: ME_ID,
                text: input.text,
            });
        } else if (input.intent === 'save-view') {
            saveView({
                surfaceId: params.surfaceId,
                name: input.name,
                center: { x: input.x, y: input.y },
                zoom: input.zoom,
            });
        } else if (input.intent === 'delete-view') {
            deleteView(input.viewId);
        } else if (input.intent === 'set-pr-status') {
            setPullRequestStatus(input.pullRequestId, input.status);
        } else if (input.intent === 'edit-issue') {
            updateIssue({
                boardId: input.boardId,
                issueId: input.issueId,
                title: input.title,
                description: input.description,
                priority: input.priority,
                assigneeId:
                    input.assigneeId === undefined
                        ? undefined
                        : input.assigneeId || null,
            });
        } else if (input.intent === 'comment-issue') {
            commentOnIssue({
                boardId: input.boardId,
                issueId: input.issueId,
                text: input.text,
                authorId: ME_ID,
            });
        } else if (input.intent === 'move-issue') {
            updateIssue({
                boardId: input.boardId,
                issueId: input.issueId,
                status: input.status,
                index: input.index,
            });
        } else if (input.intent === 'create-issue') {
            createIssue({
                boardId: input.boardId,
                title: input.title,
                status: input.status,
                authorId: ME_ID,
            });
        } else if (input.intent === 'link-cards') {
            if (input.from !== input.to) {
                linkItems({
                    from: input.from,
                    to: input.to,
                    label: input.label,
                });
            }
        } else if (input.intent === 'unlink-cards') {
            unlinkItems(input.relationId);
        } else if (input.intent === 'set-lock') {
            setItemLocked(
                input.itemId,
                input.locked,
                input.x === undefined || input.y === undefined
                    ? undefined
                    : { x: input.x, y: input.y },
            );
        } else if (input.intent === 'update-note') {
            updateNote({ noteId: input.noteId, text: input.text });
        } else if (input.intent === 'update-sketch') {
            updateSketch({ sketchId: input.sketchId, strokes: input.strokes });
        } else if (input.intent === 'delete-card') {
            deleteItem(input.itemId);
        } else if (input.intent === 'rename-card') {
            renameItem({ itemId: input.itemId, title: input.title });
        } else if (input.intent === 'duplicate') {
            duplicateItem({
                itemId: input.itemId,
                authorId: ME_ID,
                position:
                    input.x === undefined || input.y === undefined
                        ? undefined
                        : { x: input.x, y: input.y },
            });
        } else if (input.intent === 'navigate-web') {
            navigateWebPage({ webId: input.webId, url: input.url });
        } else if (input.intent === 'move-windows') {
            moveWindows(input.positions);
        } else if (input.intent === 'reset-positions') {
            resetWindowPositions(params.surfaceId);
        } else if (input.intent === 'restack') {
            restackItem(input.itemId, input.to);
        } else {
            setItemColor(input.itemId, input.color);
        }
    } catch (error) {
        if (error instanceof SurfaceError) {
            return data({ error: error.message }, { status: 404 });
        }
        throw error;
    }
    return { error: null };
}

/** Collapses the nav to its icon rail (drag its edge to resize it). */
function CollapseNavButton() {
    const { toggle } = useNavRail();
    return (
        <button
            type="button"
            onClick={toggle}
            aria-label="Collapse navigation"
            title="Collapse navigation"
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
        >
            <PanelLeftCloseIcon aria-hidden="true" className="size-4" />
        </button>
    );
}

/** ⌘K (Ctrl+K elsewhere) opens search from anywhere on the surface. */
function useSearchShortcut(setOpen: (open: boolean) => void) {
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (
                event.key.toLowerCase() === 'k' &&
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey
            ) {
                event.preventDefault();
                setOpen(true);
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [setOpen]);
}

/** How often the open surface checks for changes made elsewhere (agents, replies). */
const POLL_MS = 2000;

/**
 * Re-runs the loaders on an interval while the tab is visible, so items and
 * messages that agents add (through `/api/mcp`) show up without a reload.
 */
function usePollForChanges() {
    const revalidator = useRevalidator();
    const latest = useRef(revalidator);
    useEffect(() => {
        latest.current = revalidator;
    });

    useEffect(() => {
        const timer = setInterval(() => {
            const { state, revalidate } = latest.current;
            if (document.visibilityState === 'visible' && state === 'idle') {
                void revalidate();
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, []);
}

/**
 * Items you opened, most recent first: an item goes to the top the moment
 * you open it (including a deep link). Kept in this route's state, which
 * lives as long as the canvas does (across item routes, not across reloads).
 * Updated while rendering, React's pattern for state that follows a changing
 * value, so there is no effect and no extra frame.
 */
function useRecentItems(
    itemId: string | undefined,
    items: SurfaceItem[],
): SurfaceItem[] {
    const byId = useMemo(
        () => new Map(items.map((item) => [item.id, item])),
        [items],
    );
    const [recentIds, setRecentIds] = useState<string[]>(() =>
        itemId && byId.has(itemId) ? [itemId] : [],
    );
    const [lastItemId, setLastItemId] = useState(itemId);

    if (itemId !== lastItemId) {
        setLastItemId(itemId);
        if (itemId && byId.has(itemId)) {
            setRecentIds((ids) => pushRecent(ids, itemId));
        }
    }

    return recentIds.flatMap((id) => byId.get(id) ?? []);
}

/**
 * The canvas stays mounted across `/` and `/cards/:itemId`, so moving
 * between them animates the view instead of redrawing the page. The child
 * routes only name the page (and report unknown items).
 */
export default function SurfaceRoute({ loaderData }: Route.ComponentProps) {
    const { surface } = loaderData;
    const { itemId, viewId } = useParams();
    const location = useLocation();
    const view = surface.views.find((candidate) => candidate.id === viewId);
    const recent = useRecentItems(itemId, surface.items);
    usePollForChanges();
    const [searching, setSearching] = useState(false);
    useSearchShortcut(setSearching);

    return (
        <TrellisProvider>
            <AddCardProvider>
                <ResizableNav
                    initial={loaderData.navPanel}
                    rail={
                        <NavRail
                            surface={surface}
                            navOrder={loaderData.navOrder}
                            onSearch={() => setSearching(true)}
                        />
                    }
                    nav={
                        <>
                            <div className="flex flex-col gap-2 px-4 pt-4">
                                <div className="flex items-center gap-1">
                                    <div className="min-w-0 flex-1">
                                        <SurfaceSwitcher
                                            surfaceId={surface.id}
                                            name={surface.name}
                                            space={surface.space}
                                            workspace={surface.workspace}
                                        />
                                    </div>
                                    <CollapseNavButton />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSearching(true)}
                                    className="bg-muted/60 text-muted-foreground hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 pointer-coarse:py-2.5"
                                >
                                    <SearchIcon
                                        aria-hidden="true"
                                        className="size-4"
                                    />
                                    <span className="flex-1 text-left">
                                        Search
                                    </span>
                                    <kbd className="font-sans text-xs">⌘K</kbd>
                                </button>
                            </div>
                            <SurfaceNav
                                surface={surface}
                                recent={recent}
                                focused={Boolean(itemId)}
                                navOrder={loaderData.navOrder}
                                navCollapsed={loaderData.navCollapsed}
                            />
                        </>
                    }
                >
                    <div className="bg-canvas relative size-full min-h-0">
                        <SurfaceCanvas
                            surface={surface}
                            focusedId={itemId}
                            view={view}
                            visitKey={location.key}
                            onSearch={() => setSearching(true)}
                        />
                        <div className="pointer-events-none absolute inset-x-0 top-0">
                            <Outlet />
                        </div>
                    </div>
                </ResizableNav>
                <SearchPalette
                    open={searching}
                    onOpenChange={setSearching}
                    items={surface.items}
                    people={surface.people}
                    recent={recent}
                    focused={Boolean(itemId)}
                />
            </AddCardProvider>
        </TrellisProvider>
    );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const missing = isRouteErrorResponse(error) && error.status === 404;
    return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
            <title>{`${missing ? 'Not found' : 'Error'} | ${APP_NAME}`}</title>
            <p className="text-sm">
                {missing
                    ? 'That surface does not exist.'
                    : 'Something went wrong opening that surface.'}
            </p>
            <Button variant="outline" size="sm" render={<Link to="/" />}>
                <ArrowLeftIcon aria-hidden="true" />
                All spaces
            </Button>
        </div>
    );
}
