import { use } from 'react';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import { ExternalLinkIcon, SquarePlayIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { isAgentMade, youtubeEmbedUrl, type VideoItem } from '~/lib/surface';
import { AgentBadge, AgentStripe } from './AgentMark';
import { FocusedItemContext, useWindowColors } from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type VideoNode = FlowNode<{ item: VideoItem }, 'video'>;

/**
 * A YouTube video, playing in its window (the privacy-enhanced player).
 * The player takes clicks only once the window is selected or focused, so
 * dragging across the canvas never gets caught in the iframe.
 */
export function VideoWindow({ data, selected }: NodeProps<VideoNode>) {
    const item = data.item;
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === item.id;
    const live = selected || focused;

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
                kind="Video"
                rounded="rounded-xl"
            />
            <article
                aria-label={`Video: ${item.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(item.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(item) && <AgentStripe />}
                <header className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b px-4 active:cursor-grabbing">
                    <SquarePlayIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4 shrink-0"
                    />
                    <CardTitle
                        itemId={item.id}
                        title={item.title}
                        className="min-w-0 flex-1 truncate text-sm font-semibold"
                    />
                    {isAgentMade(item) && <AgentBadge />}
                    <a
                        href={`https://www.youtube.com/watch?v=${item.videoId}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label="Watch on YouTube"
                        title="Watch on YouTube"
                        className="nodrag text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring rounded-md p-1 outline-none focus-visible:ring-2"
                    >
                        <ExternalLinkIcon
                            aria-hidden="true"
                            className="size-4"
                        />
                    </a>
                </header>
                <div className="nodrag nowheel min-h-0 flex-1 bg-black">
                    <iframe
                        src={youtubeEmbedUrl(item.videoId)}
                        title={item.title}
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        className={cx(
                            'size-full border-0',
                            !live && 'pointer-events-none',
                        )}
                    />
                </div>
            </article>
        </div>
    );
}
