import { Fragment } from 'react';
import { NavLink } from 'react-router';
import {
    BookmarkIcon,
    PanelLeftOpenIcon,
    SearchIcon,
    type LucideIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import type { NavSectionKey } from '~/lib/nav-order';
import { isAgentMade, type Surface } from '~/lib/surface';
import { KIND_ICONS, KIND_NAMES } from './kind-icons';
import { useNavRail } from './ResizableNav';
import { useSurfaceLinks } from './surface-context';
import { SurfaceSwitcher } from './SurfaceSwitcher';

type Props = {
    surface: Surface;
    navOrder: NavSectionKey[];
    onSearch: () => void;
};

type RailSection = {
    key: NavSectionKey;
    links: {
        id: string;
        to: string;
        label: string;
        icon: LucideIcon;
        agent: boolean;
    }[];
};

function railItemClassName({ isActive }: { isActive: boolean }) {
    return cx(
        'focus-visible:ring-ring relative flex size-9 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2',
        isActive
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    );
}

/**
 * The nav collapsed to icons: expand, switch surface, search, then each
 * saved view and card as an icon (its name on hover), in the nav's section
 * order. Agent-made cards carry a dot.
 */
export function NavRail({ surface, navOrder, onSearch }: Props) {
    const { toggle } = useNavRail();
    const links = useSurfaceLinks();
    const sections = navOrder.flatMap((key): RailSection[] => {
        if (key === 'recent') return [];
        if (key === 'views') {
            return surface.views.length > 0
                ? [
                      {
                          key,
                          links: surface.views.map((view) => ({
                              id: view.id,
                              to: links.view(view.id),
                              label: `View: ${view.name}`,
                              icon: BookmarkIcon,
                              agent: false,
                          })),
                      },
                  ]
                : [];
        }
        const items = surface.items.filter((item) => item.kind === key);
        return items.length > 0
            ? [
                  {
                      key,
                      links: items.map((item) => ({
                          id: item.id,
                          to: links.item(item.id),
                          label: `${KIND_NAMES[item.kind]}: ${item.title}`,
                          icon: KIND_ICONS[item.kind],
                          agent: isAgentMade(item),
                      })),
                  },
              ]
            : [];
    });

    return (
        <nav
            aria-label="Surface"
            className="flex min-h-0 flex-1 scrollbar-none flex-col items-center gap-1 overflow-y-auto py-3"
        >
            <button
                type="button"
                onClick={toggle}
                aria-label="Expand navigation"
                title="Expand navigation"
                className={railItemClassName({ isActive: false })}
            >
                <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
            </button>
            <SurfaceSwitcher
                surfaceId={surface.id}
                name={surface.name}
                space={surface.space}
                workspace={surface.workspace}
                compact
            />
            <button
                type="button"
                onClick={onSearch}
                aria-label="Search"
                title="Search (⌘K)"
                className={railItemClassName({ isActive: false })}
            >
                <SearchIcon aria-hidden="true" className="size-4" />
            </button>
            {sections.map((section) => (
                <Fragment key={section.key}>
                    <span
                        aria-hidden="true"
                        className="bg-border my-1 h-px w-6"
                    />
                    {section.links.map(
                        ({ id, to, label, icon: Icon, agent }) => (
                            <NavLink
                                key={id}
                                to={to}
                                prefetch="intent"
                                aria-label={label}
                                title={label}
                                className={railItemClassName}
                            >
                                <Icon aria-hidden="true" className="size-4" />
                                {agent && (
                                    <span
                                        aria-hidden="true"
                                        className="bg-agent absolute top-1.5 right-1.5 size-1.5 rounded-full"
                                    />
                                )}
                            </NavLink>
                        ),
                    )}
                </Fragment>
            ))}
        </nav>
    );
}
