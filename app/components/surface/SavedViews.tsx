import { useState, type FormEvent } from 'react';
import {
    NavLink,
    useFetcher,
    useFetchers,
    useNavigate,
    useParams,
    useSubmit,
} from 'react-router';
import { useFlow, useFlowState } from '@sethdavis512/trellis';
import { BookmarkIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { viewCenter, type SavedView } from '~/lib/surface';
import { NavGroup } from './NavGroup';
import { navItemClassName } from './nav-link';
import { useSurfaceLinks } from './surface-context';

type Props = {
    views: SavedView[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** An item is focused: its window fills the canvas, so there's no spot to save. */
    focused: boolean;
};

/**
 * Saved spots on the canvas (center and zoom), for jumping from idea to
 * idea. The + button names and saves where you are now; each view links to
 * its route, which flies the canvas there. Saves and deletes show at once,
 * from the requests still on their way.
 */
export function SavedViews({ views, focused, open, onOpenChange }: Props) {
    const links = useSurfaceLinks();
    const flow = useFlow();
    const canvasSize = useFlowState((s) => s.size);
    const saver = useFetcher({ key: 'save-view' });
    const submit = useSubmit();
    const fetchers = useFetchers();
    const navigate = useNavigate();
    const { viewId } = useParams();
    const [name, setName] = useState<string | null>(null);

    const deleting = new Set(
        fetchers
            .filter((f) => f.formData?.get('intent') === 'delete-view')
            .map((f) => String(f.formData?.get('viewId'))),
    );
    const shown = views.filter((view) => !deleting.has(view.id));
    const pendingName = saver.formData?.get('name');

    function handleSave(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmed = name?.trim();
        if (!trimmed) return;
        const viewport = flow.getViewport();
        const center = viewCenter(viewport, canvasSize);
        void saver.submit(
            {
                intent: 'save-view',
                name: trimmed,
                x: String(center.x),
                y: String(center.y),
                zoom: String(viewport.zoom),
            },
            { method: 'post', action: links.action },
        );
        setName(null);
    }

    function handleDelete(id: string) {
        if (viewId === id) void navigate(links.action);
        void submit(
            { intent: 'delete-view', viewId: id },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `delete-view:${id}`,
            },
        );
    }

    return (
        <NavGroup
            label="Views"
            open={open}
            onOpenChange={onOpenChange}
            actions={
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Save current view"
                    title={
                        focused
                            ? 'Go back to the canvas to save a view'
                            : 'Save current view'
                    }
                    disabled={focused || name !== null}
                    onClick={() => {
                        onOpenChange(true);
                        setName(`View ${views.length + 1}`);
                    }}
                >
                    <PlusIcon aria-hidden="true" />
                </Button>
            }
        >
            <div className="flex flex-col gap-1">
                {name !== null && (
                    <form
                        onSubmit={handleSave}
                        className="flex items-center gap-1 px-1"
                    >
                        <input
                            autoFocus
                            aria-label="View name"
                            value={name}
                            maxLength={60}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') setName(null);
                            }}
                            className="bg-muted focus-visible:ring-ring min-w-0 flex-1 rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-2"
                        />
                        <Button type="submit" size="xs" disabled={!name.trim()}>
                            Save
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setName(null)}
                        >
                            Cancel
                        </Button>
                    </form>
                )}

                <ul className="flex flex-col gap-0.5">
                    {shown.map((view) => (
                        <li key={view.id} className="group relative">
                            <NavLink
                                to={links.view(view.id)}
                                className={(state) =>
                                    `${navItemClassName(state)} pe-10`
                                }
                            >
                                <BookmarkIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-4 shrink-0"
                                />
                                <span className="truncate">{view.name}</span>
                                <span className="text-muted-foreground ms-auto text-xs tabular-nums">
                                    {view.itemIds
                                        ? 'Fit'
                                        : `${Math.round(view.zoom * 100)}%`}
                                </span>
                            </NavLink>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Delete view ${view.name}`}
                                onClick={() => handleDelete(view.id)}
                                className="text-muted-foreground absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                            >
                                <Trash2Icon aria-hidden="true" />
                            </Button>
                        </li>
                    ))}
                    {typeof pendingName === 'string' && (
                        <li
                            aria-busy="true"
                            className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm"
                        >
                            <BookmarkIcon
                                aria-hidden="true"
                                className="size-4 shrink-0"
                            />
                            <span className="truncate">{pendingName}</span>
                        </li>
                    )}
                </ul>

                {shown.length === 0 &&
                    name === null &&
                    typeof pendingName !== 'string' && (
                        <p className="text-muted-foreground px-3 text-xs">
                            Save where you are to jump back later.
                        </p>
                    )}
            </div>
        </NavGroup>
    );
}
