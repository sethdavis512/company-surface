import { use, useState } from 'react';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import { ExternalLinkIcon, ImageIcon, ImageOffIcon } from 'lucide-react';
import { cx } from 'cva.config';
import { isAgentMade, type ImageItem } from '~/lib/surface';
import { AgentBadge, AgentStripe } from './AgentMark';
import { FocusedItemContext, useWindowColors } from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type ImageNode = FlowNode<{ item: ImageItem }, 'image'>;

/**
 * A picture, fit inside its window whatever its shape (so a focused image
 * grows to fill the canvas). Animated GIFs say "GIF" in the header. If the
 * address stops serving an image, the window says so instead of a broken
 * icon.
 */
export function ImageWindow({ data, selected }: NodeProps<ImageNode>) {
    const item = data.item;
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === item.id;
    // Which address failed, so a new address tries again.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const failed = failedSrc === item.src;

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
                kind={item.animated ? 'GIF' : 'Image'}
                rounded="rounded-xl"
            />
            <article
                aria-label={`${item.animated ? 'GIF' : 'Image'}: ${item.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(item.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(item) && <AgentStripe />}
                <header className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b px-4 active:cursor-grabbing">
                    <ImageIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4 shrink-0"
                    />
                    <CardTitle
                        itemId={item.id}
                        title={item.title}
                        className="min-w-0 flex-1 truncate text-sm font-semibold"
                    />
                    {item.animated && (
                        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide">
                            GIF
                        </span>
                    )}
                    {isAgentMade(item) && <AgentBadge />}
                    <a
                        href={item.src}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label="Open the original"
                        title="Open the original"
                        className="nodrag text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring rounded-md p-1 outline-none focus-visible:ring-2"
                    >
                        <ExternalLinkIcon
                            aria-hidden="true"
                            className="size-4"
                        />
                    </a>
                </header>
                <div className="bg-muted/40 dark:bg-foreground/85 flex min-h-0 flex-1 items-center justify-center p-3">
                    {failed ? (
                        <p className="text-muted-foreground flex flex-col items-center gap-2 text-center text-sm">
                            <ImageOffIcon
                                aria-hidden="true"
                                className="size-6"
                            />
                            The image couldn't be loaded.
                        </p>
                    ) : (
                        <img
                            src={item.src}
                            alt={item.alt || item.title}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            draggable={false}
                            onError={() => setFailedSrc(item.src)}
                            className="size-full rounded-md object-contain select-none"
                        />
                    )}
                </div>
            </article>
        </div>
    );
}
