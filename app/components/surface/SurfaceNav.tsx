import { useId, type CSSProperties, type ReactNode } from 'react';
import { NavLink, useFetcher } from 'react-router';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon } from 'lucide-react';
import { cx } from 'cva.config';
import {
    navCollapsedSchema,
    navOrderSchema,
    type NavSectionKey,
} from '~/lib/nav-order';
import {
    isAgentMade,
    type Surface,
    type SurfaceItem,
    type SurfaceItemKind,
} from '~/lib/surface';
import { AgentIcon } from './AgentMark';
import { KIND_ICONS } from './kind-icons';
import { NavGroup } from './NavGroup';
import { navItemClassName } from './nav-link';
import { SavedViews } from './SavedViews';
import { useSurfaceLinks } from './surface-context';

const KIND_LABELS: Record<SurfaceItemKind, string> = {
    chat: 'Chats',
    document: 'Documents',
    'pull-request': 'Pull requests',
    chart: 'Charts',
    board: 'Boards',
    video: 'Videos',
    web: 'Web pages',
    image: 'Images',
    note: 'Sticky notes',
    sketch: 'Sketches',
    ui: 'UI cards',
};

type Props = {
    surface: Surface;
    /** Items visited and left, most recent first. */
    recent: SurfaceItem[];
    /** An item is focused: saving a view waits until you're back. */
    focused: boolean;
    /** The sections' saved order (complete: every section once). */
    navOrder: NavSectionKey[];
    /** The sections this person has collapsed. */
    navCollapsed: NavSectionKey[];
};

/**
 * Every item on the surface, by kind, plus the ones you visited most
 * recently and your saved views. Items link to their focused routes, views
 * to theirs. Sections drag by the grip beside their heading (or with the
 * keyboard: focus the grip, Space, arrows, Space), and the order is saved
 * in a cookie, shown at once from the request on its way.
 */
export function SurfaceNav({
    surface,
    recent,
    focused,
    navOrder,
    navCollapsed,
}: Props) {
    const links = useSurfaceLinks();
    const fetcher = useFetcher({ key: 'nav-order' });
    const pending = navOrderSchema.safeParse(
        JSON.parse(String(fetcher.formData?.get('order') ?? 'null')),
    );
    const order = pending.success ? pending.data : navOrder;
    // Collapsed sections, saved in a cookie too and shown at once.
    const collapser = useFetcher({ key: 'nav-collapsed' });
    const pendingCollapsed = navCollapsedSchema.safeParse(
        JSON.parse(String(collapser.formData?.get('collapsed') ?? 'null')),
    );
    const collapsed = pendingCollapsed.success
        ? pendingCollapsed.data
        : navCollapsed;
    function openProps(key: NavSectionKey) {
        return {
            open: !collapsed.includes(key),
            onOpenChange: (open: boolean) => {
                const next = open
                    ? collapsed.filter((other) => other !== key)
                    : [...collapsed, key];
                void collapser.submit(
                    {
                        intent: 'set-nav-collapsed',
                        collapsed: JSON.stringify(next),
                    },
                    { method: 'post', action: links.action },
                );
            },
        };
    }
    // A stable id, so the server and client agree on dnd-kit's aria ids.
    const dndId = useId();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    function render(key: NavSectionKey): ReactNode {
        if (key === 'recent') {
            return recent.length > 0 ? (
                <NavSection
                    label="Recent"
                    items={recent}
                    {...openProps('recent')}
                />
            ) : null;
        }
        if (key === 'views') {
            return (
                <SavedViews
                    views={surface.views}
                    focused={focused}
                    {...openProps('views')}
                />
            );
        }
        const items = surface.items.filter((item) => item.kind === key);
        return items.length > 0 ? (
            <NavSection
                label={KIND_LABELS[key]}
                items={items}
                {...openProps(key)}
            />
        ) : null;
    }

    const shown = order
        .map((key) => ({ key, content: render(key) }))
        .filter(({ content }) => content !== null);

    function handleDragEnd({ active, over }: DragEndEvent) {
        if (!over || active.id === over.id) return;
        // Move within the whole order, so hidden sections (an empty Recent)
        // keep their places.
        const next = arrayMove(
            order,
            order.indexOf(active.id as NavSectionKey),
            order.indexOf(over.id as NavSectionKey),
        );
        void fetcher.submit(
            { intent: 'set-nav-order', order: JSON.stringify(next) },
            { method: 'post', action: links.action },
        );
    }

    return (
        <nav
            aria-label="Surface"
            className="flex scrollbar-none flex-col gap-6 overflow-y-auto p-4"
        >
            <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={shown.map(({ key }) => key)}
                    strategy={verticalListSortingStrategy}
                >
                    {shown.map(({ key, content }) => (
                        <SortableSection key={key} id={key}>
                            {content}
                        </SortableSection>
                    ))}
                </SortableContext>
            </DndContext>
        </nav>
    );
}

const SECTION_NAMES: Record<NavSectionKey, string> = {
    recent: 'Recent',
    views: 'Views',
    ...KIND_LABELS,
};

type SortableSectionProps = {
    id: NavSectionKey;
    children: ReactNode;
};

/**
 * A nav section that drags by its grip, which sits in the nav's left
 * padding beside the heading: shown on hover or keyboard focus, always on
 * touchscreens.
 */
function SortableSection({ id, children }: SortableSectionProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });
    const style: CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            data-nav-section={id}
            className={cx(
                'group/section relative',
                isDragging && 'bg-card relative z-10 opacity-80',
            )}
        >
            <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label={`Move ${SECTION_NAMES[id]} section`}
                {...attributes}
                {...listeners}
                className={cx(
                    'text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-0 -left-4 flex h-5 w-4 cursor-grab touch-none items-center justify-center rounded opacity-0 outline-none group-hover/section:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing pointer-coarse:opacity-100',
                    isDragging && 'opacity-100',
                )}
            >
                <GripVerticalIcon aria-hidden="true" className="size-3.5" />
            </button>
            {children}
        </div>
    );
}

type NavSectionProps = {
    label: string;
    items: SurfaceItem[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

function NavSection({ label, items, open, onOpenChange }: NavSectionProps) {
    const links = useSurfaceLinks();
    if (items.length === 0) return null;

    return (
        <NavGroup label={label} open={open} onOpenChange={onOpenChange}>
            <ul className="flex flex-col gap-0.5">
                {items.map((item) => {
                    const Icon = KIND_ICONS[item.kind];
                    return (
                        <li key={item.id}>
                            <NavLink
                                to={links.item(item.id)}
                                prefetch="intent"
                                className={navItemClassName}
                            >
                                <Icon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-4 shrink-0"
                                />
                                <span className="truncate">{item.title}</span>
                                {isAgentMade(item) && (
                                    <AgentIcon className="ms-auto" />
                                )}
                            </NavLink>
                        </li>
                    );
                })}
            </ul>
        </NavGroup>
    );
}
