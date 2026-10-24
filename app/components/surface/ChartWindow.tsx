import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import { barY, defineChart, lineY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { tooltip } from '@tanstack/charts/tooltip';
import { ChartColumnIcon, ChartLineIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { isAgentMade, type ChartItem } from '~/lib/surface';
import { AgentBadge, AgentStripe } from './AgentMark';
import {
    FocusedItemContext,
    useSurfaceItems,
    useWindowColors,
    useSurfaceLinks,
} from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type ChartNode = FlowNode<{ item: ChartItem }, 'chart'>;

/** Chart paint: an app token, so it follows light and dark. */
const CHART_COLOR = 'var(--color-tint-sky)';

/** The height of an element, kept current as it resizes (a window focusing). */
function useHeight<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [height, setHeight] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setHeight(Math.floor(entry!.contentRect.height));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, height] as const;
}

/**
 * A small chart (TanStack Charts) attached to the chat or document it
 * explains. The chart fills the window, so it grows when the window is
 * focused.
 */
export function ChartWindow({ data, selected }: NodeProps<ChartNode>) {
    const links = useSurfaceLinks();
    const item = data.item;
    const { titleOf } = useSurfaceItems();
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === item.id;
    const [plotRef, plotHeight] = useHeight<HTMLDivElement>();
    const parentTitle = item.attachedTo ? titleOf(item.attachedTo) : undefined;
    const Icon = item.chart === 'bar' ? ChartColumnIcon : ChartLineIcon;

    const definition = useMemo(
        () =>
            item.chart === 'bar'
                ? defineChart({
                      marks: [
                          barY(item.points, {
                              x: 'label',
                              y: 'value',
                              fill: CHART_COLOR,
                          }),
                      ],
                      scales: {
                          x: { scale: () => scaleBand().padding(0.25) },
                          y: {
                              scale: scaleLinear,
                              nice: true,
                              grid: true,
                              axis: { label: item.unit },
                          },
                      },
                      tooltip,
                  })
                : defineChart({
                      marks: [
                          lineY(item.points, {
                              x: 'label',
                              y: 'value',
                              stroke: CHART_COLOR,
                              points: true,
                          }),
                      ],
                      scales: {
                          x: { scale: () => scalePoint().padding(0.3) },
                          y: {
                              scale: scaleLinear,
                              nice: true,
                              grid: true,
                              axis: { label: item.unit },
                          },
                      },
                      tooltip,
                  }),
        [item.chart, item.points, item.unit],
    );

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
                kind="Chart"
                rounded="rounded-2xl"
            />
            <article
                aria-label={`Chart: ${item.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-2xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(item.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(item) && <AgentStripe />}
                <header className="flex cursor-grab items-center gap-2 border-b px-4 pt-3 pb-2 active:cursor-grabbing">
                    <Icon
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
                <div
                    ref={plotRef}
                    className="nodrag nowheel min-h-0 flex-1 cursor-auto px-2 pt-2"
                >
                    {plotHeight > 0 && (
                        <Chart
                            definition={definition}
                            height={plotHeight}
                            ariaLabel={item.title}
                            ariaDescription={item.caption}
                        />
                    )}
                </div>
                <footer className="text-muted-foreground flex items-center gap-2 border-t px-4 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                        {item.caption}
                    </span>
                    {parentTitle && (
                        <Link
                            to={links.item(item.attachedTo!)}
                            className="hover:text-foreground focus-visible:ring-ring shrink-0 rounded font-medium outline-none focus-visible:ring-2"
                        >
                            {parentTitle}
                        </Link>
                    )}
                </footer>
            </article>
        </div>
    );
}
