import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import type { PortableTextBlock } from '@portabletext/types';
import { ArrowUpRightIcon } from 'lucide-react';
import { type SurfaceItem } from '~/lib/surface';
import type {
    DocumentBlock,
    ItemEmbedBlock,
    ItemRefMark,
    LinkMark,
} from '~/lib/portable-text';
import { KIND_ICONS, KIND_NAMES } from './kind-icons';
import { useSurfaceItems, useSurfaceLinks } from './surface-context';

type Props = {
    blocks: DocumentBlock[];
};

/**
 * A document's Portable Text. Standard blocks render as prose; `itemRef`
 * marks become chips that open the item they point at, and `itemEmbed`
 * blocks become cards for it.
 */
export function DocumentBody({ blocks }: Props) {
    return (
        <PortableText
            value={blocks as PortableTextBlock[]}
            components={components}
        />
    );
}

const components: PortableTextComponents = {
    marks: {
        itemRef: ({ value, children }) => (
            <ItemChip itemId={(value as ItemRefMark).itemId}>
                {children}
            </ItemChip>
        ),
        link: ({ value, children }) => (
            <a
                href={(value as LinkMark).href}
                target="_blank"
                rel="noreferrer noopener"
            >
                {children}
            </a>
        ),
    },
    types: {
        itemEmbed: ({ value }) => (
            <ItemCard itemId={(value as ItemEmbedBlock).itemId} />
        ),
    },
};

type ChipProps = {
    itemId: string;
    children: ReactNode;
    /** Inside the editor: a styled span, so clicking places the caret. */
    editing?: boolean;
};

/** Inline: the linked text with its item's icon, opening the item. */
export function ItemChip({ itemId, children, editing = false }: ChipProps) {
    const links = useSurfaceLinks();
    const { itemOf } = useSurfaceItems();
    const item = itemOf(itemId);
    if (!item) {
        return (
            <span
                title="No longer on the surface"
                className="text-muted-foreground line-through"
            >
                {children}
            </span>
        );
    }
    const Icon = KIND_ICONS[item.kind];
    const title = `${KIND_NAMES[item.kind]}: ${item.title}`;
    const className =
        'not-prose bg-muted text-foreground inline-flex items-baseline gap-1 rounded-md px-1.5 font-medium no-underline';
    const icon = (
        <Icon
            aria-hidden="true"
            className="text-muted-foreground size-3.5 shrink-0 self-center"
        />
    );

    if (editing) {
        return (
            <span title={title} data-item-ref={item.id} className={className}>
                {icon}
                {children}
            </span>
        );
    }
    return (
        <Link
            to={links.item(item.id)}
            title={title}
            className={`${className} hover:bg-accent focus-visible:ring-ring outline-none focus-visible:ring-2`}
        >
            {icon}
            {children}
        </Link>
    );
}

type CardProps = {
    itemId: string;
    /**
     * Inside the editor: the card is something you select, not a link, and
     * the arrow opens the item.
     */
    editing?: boolean;
};

/** A block of its own: the item's kind, title, and a line about it. */
export function ItemCard({ itemId, editing = false }: CardProps) {
    const links = useSurfaceLinks();
    const { itemOf } = useSurfaceItems();
    const item = itemOf(itemId);
    if (!item) {
        return (
            <p className="text-muted-foreground italic">
                An item that is no longer on the surface.
            </p>
        );
    }
    const Icon = KIND_ICONS[item.kind];
    const label = `${KIND_NAMES[item.kind]}: ${item.title}`;
    const body = (
        <>
            <span className="bg-card flex size-9 shrink-0 items-center justify-center rounded-md border">
                <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {KIND_NAMES[item.kind]}
                </span>
                <span className="text-foreground truncate text-sm font-semibold">
                    {item.title}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                    {summary(item)}
                </span>
            </span>
        </>
    );
    const className =
        'not-prose bg-muted/50 my-4 flex items-center gap-3 rounded-lg border px-4 py-3 no-underline';

    if (editing) {
        return (
            <div aria-label={label} className={className}>
                {body}
                <Link
                    to={links.item(item.id)}
                    aria-label={`Open ${item.title}`}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring rounded-md p-1 outline-none focus-visible:ring-2"
                >
                    <ArrowUpRightIcon aria-hidden="true" className="size-4" />
                </Link>
            </div>
        );
    }
    return (
        <Link
            to={links.item(item.id)}
            aria-label={label}
            className={`${className} hover:bg-accent focus-visible:ring-ring outline-none focus-visible:ring-2`}
        >
            {body}
            <ArrowUpRightIcon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
            />
        </Link>
    );
}

function summary(item: SurfaceItem): string {
    switch (item.kind) {
        case 'chat': {
            const last = item.messages.at(-1);
            return last ? last.text : 'No messages yet';
        }
        case 'document':
            return `${item.blocks.length} blocks`;
        case 'pull-request':
            return `#${item.number} · ${item.status}`;
        case 'chart':
            return item.caption;
        case 'board': {
            const done = item.issues.filter(
                (issue) => issue.status === 'done',
            ).length;
            return `${item.issues.length} issues · ${done} done`;
        }
        case 'video':
            return 'YouTube video';
        case 'web':
            return new URL(item.url).hostname;
        case 'image':
            return item.animated ? 'Animated GIF' : 'Image';
        case 'note':
            return item.text.replace(/\s+/g, ' ').trim() || 'Empty note';
        case 'sketch':
            return `${item.strokes.length} strokes`;
        case 'shape':
            return `${item.shape[0].toUpperCase()}${item.shape.slice(1)}`;
    }
}
