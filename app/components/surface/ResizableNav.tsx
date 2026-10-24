import {
    createContext,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { NAV_WIDTH, serializeNavPanel, type NavPanel } from '~/lib/nav-panel';

type NavRail = {
    /** The nav is down to its icon rail. */
    collapsed: boolean;
    toggle: () => void;
};

const NavRailContext = createContext<NavRail | null>(null);

/** Whether the nav is collapsed, and a way to flip it. */
export function useNavRail(): NavRail {
    const value = useContext(NavRailContext);
    if (!value) throw new Error('useNavRail needs a ResizableNav');
    return value;
}

type Props = {
    /** From the loader (`readNavPanel`), so the server renders it. */
    initial: NavPanel;
    /** The nav at full width. */
    nav: ReactNode;
    /** The nav collapsed to icons. */
    rail: ReactNode;
    /** The canvas. */
    children: ReactNode;
};

/**
 * The surface's two panes (react-resizable-panels, as in Sprocket): the left
 * nav, which you can drag between its limits or collapse to an icon rail
 * (drag it narrow, or its collapse button), and the canvas filling the rest.
 * The nav keeps its pixel width when the window resizes; its width and
 * collapsed state are saved to a cookie as they change. Below `md` the nav
 * is hidden and the canvas fills the screen, as before.
 */
export function ResizableNav({ initial, nav, rail, children }: Props) {
    const panelRef = usePanelRef();
    const [collapsed, setCollapsed] = useState(initial.collapsed);
    const width = useRef(initial.width);

    function toggle() {
        const panel = panelRef.current;
        if (!panel) return;
        // Back to the width you had, which the library only remembers
        // within a page load (a nav that loaded collapsed would come back at
        // its minimum).
        if (panel.isCollapsed()) panel.resize(`${width.current}px`);
        else panel.collapse();
    }

    return (
        <NavRailContext.Provider value={{ collapsed, toggle }}>
            <Group
                id="surface"
                orientation="horizontal"
                className="min-h-0 grow max-md:[&>[data-panel]:first-child]:hidden! max-md:[&>[data-panel]:last-child]:basis-full! max-md:[&>[data-separator]]:hidden!"
            >
                <Panel
                    id="surface-nav"
                    panelRef={panelRef}
                    collapsible
                    collapsedSize={`${NAV_WIDTH.rail}px`}
                    minSize={`${NAV_WIDTH.min}px`}
                    maxSize={`${NAV_WIDTH.max}px`}
                    defaultSize={`${initial.collapsed ? NAV_WIDTH.rail : initial.width}px`}
                    groupResizeBehavior="preserve-pixel-size"
                    onResize={(size) => {
                        const isCollapsed =
                            panelRef.current?.isCollapsed() ??
                            size.inPixels <= NAV_WIDTH.rail + 1;
                        // Collapsing passes through the minimum on its way
                        // down; that isn't a width anyone chose.
                        if (!isCollapsed && size.inPixels > NAV_WIDTH.min + 1) {
                            width.current = size.inPixels;
                        }
                        setCollapsed(isCollapsed);
                        document.cookie = serializeNavPanel({
                            width: width.current,
                            collapsed: isCollapsed,
                        });
                    }}
                    className="bg-card flex min-h-0 flex-col"
                >
                    {collapsed ? rail : nav}
                </Panel>
                <Separator
                    aria-label="Resize the navigation"
                    // A 1px line with a wider invisible grab area.
                    className="bg-border hover:bg-primary/60 focus-visible:bg-primary data-[separator=active]:bg-primary relative w-px transition-colors outline-none after:absolute after:-inset-x-1.5 after:inset-y-0"
                />
                <Panel
                    id="surface-canvas"
                    minSize="320px"
                    className="relative min-h-0"
                >
                    {children}
                </Panel>
            </Group>
        </NavRailContext.Provider>
    );
}
