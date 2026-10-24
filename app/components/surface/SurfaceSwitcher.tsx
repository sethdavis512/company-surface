import { Link } from 'react-router';
import {
    CheckIcon,
    ChevronsUpDownIcon,
    LayersIcon,
    LayoutGridIcon,
} from 'lucide-react';
import {
    Menu,
    MenuGroup,
    MenuGroupLabel,
    MenuLinkItem,
    MenuPopup,
    MenuSeparator,
    MenuTrigger,
} from '~/components/ui/menu';
import { surfacePath, type Space, type Workspace } from '~/lib/surface';

type Props = {
    surfaceId: string;
    name: string;
    space: Space;
    workspace: Workspace;
    /** On the collapsed nav rail: just an icon. */
    compact?: boolean;
};

/**
 * Where you are (space, then surface) atop the nav, and a menu to jump to
 * any other surface or back to all spaces.
 */
export function SurfaceSwitcher({
    surfaceId,
    name,
    space,
    workspace,
    compact = false,
}: Props) {
    return (
        <Menu>
            <MenuTrigger
                aria-label={`Surface: ${name}, in ${space.name}. Switch surface`}
                title={compact ? `${space.name} / ${name}` : undefined}
                className={
                    compact
                        ? 'hover:bg-accent focus-visible:ring-ring data-popup-open:bg-accent flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2'
                        : 'hover:bg-accent focus-visible:ring-ring data-popup-open:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 pointer-coarse:py-2.5'
                }
            >
                {compact ? (
                    <LayersIcon aria-hidden="true" className="size-4" />
                ) : (
                    <>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-muted-foreground truncate text-xs">
                                {space.name}
                            </span>
                            <span className="truncate text-sm font-semibold">
                                {name}
                            </span>
                        </span>
                        <ChevronsUpDownIcon
                            aria-hidden="true"
                            className="text-muted-foreground size-4 shrink-0"
                        />
                    </>
                )}
            </MenuTrigger>
            <MenuPopup
                align="start"
                side={compact ? 'right' : 'bottom'}
                className="w-60"
            >
                {workspace.spaces.map((group) => (
                    <MenuGroup key={group.id}>
                        <MenuGroupLabel>{group.name}</MenuGroupLabel>
                        {group.surfaces.map((surface) => (
                            <MenuLinkItem
                                key={surface.id}
                                render={<Link to={surfacePath(surface.id)} />}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {surface.name}
                                </span>
                                {surface.id === surfaceId && (
                                    <CheckIcon aria-label="Current surface" />
                                )}
                            </MenuLinkItem>
                        ))}
                    </MenuGroup>
                ))}
                <MenuSeparator />
                <MenuLinkItem render={<Link to="/" />}>
                    <LayoutGridIcon aria-hidden="true" />
                    All spaces
                </MenuLinkItem>
            </MenuPopup>
        </Menu>
    );
}
