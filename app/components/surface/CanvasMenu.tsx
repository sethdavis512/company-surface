import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useFlow } from '@sethdavis512/trellis';
import {
    FocusIcon,
    LayoutGridIcon,
    PencilLineIcon,
    Trash2Icon,
    MaximizeIcon,
    ScanIcon,
    SearchIcon,
    SquarePlusIcon,
    UnlinkIcon,
    ZoomInIcon,
    ZoomOutIcon,
} from 'lucide-react';
import {
    ContextMenu,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuPopup,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubPopup,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '~/components/ui/context-menu';
import { isRenamable, type SurfaceItemKind } from '~/lib/surface';
import { useAddCard } from './AddCard';
import { useDeleteCard } from './DeleteCard';
import { KIND_ICONS } from './kind-icons';
import {
    useRenaming,
    useSurfaceItems,
    useSurfaceLinks,
} from './surface-context';

const ADD_HERE: { kind: SurfaceItemKind; label: string }[] = [
    { kind: 'chat', label: 'Chat' },
    { kind: 'document', label: 'Document' },
    { kind: 'board', label: 'Board' },
    { kind: 'note', label: 'Sticky note' },
    { kind: 'sketch', label: 'Sketch' },
    { kind: 'shape', label: 'Shape' },
    { kind: 'video', label: 'Video…' },
    { kind: 'web', label: 'Web page…' },
    { kind: 'image', label: 'Image…' },
];

/** What on the canvas keeps the browser's own menu (cards, trays, maps). */
const NOT_EMPTY =
    '[data-node-id], .trellis__panel, .trellis__controls, .trellis__minimap';

/** Controls in a card's header that keep their own (or the browser's) menu. */
const HEADER_CONTROLS = 'button, a, input, textarea, select, [role="menu"]';

type Props = {
    onArrange: () => void;
    onSearch: () => void;
    /** A link's label by its id (the menu names the link it removes). */
    linkLabel: (relationId: string) => string | undefined;
    onRemoveLink: (relationId: string) => void;
    children: ReactNode;
};

/**
 * Right-clicking empty canvas: add a card right there, zoom, fit, arrange,
 * or search; on a link between cards, remove it first. On a card's header,
 * the card's own menu: rename or focus it. Anywhere else on a card (or a
 * tray) the browser's own menu shows instead, so copying text still works.
 */
export function CanvasMenu({
    onArrange,
    onSearch,
    linkLabel,
    onRemoveLink,
    children,
}: Props) {
    const flow = useFlow();
    const { add } = useAddCard();
    // Where the menu was opened, on the canvas, for "Add here".
    const point = useRef({ x: 0, y: 0 });
    // The link (line between cards) right-clicked, if it was one.
    const [linkId, setLinkId] = useState<string | null>(null);
    // The card whose header was right-clicked, if it was one.
    const [cardId, setCardId] = useState<string | null>(null);
    const { startRename } = useRenaming();
    const { confirmDelete } = useDeleteCard();
    const { kindOf } = useSurfaceItems();
    const links = useSurfaceLinks();
    const navigate = useNavigate();
    const cardKind = cardId ? kindOf(cardId) : undefined;

    return (
        <ContextMenu>
            <ContextMenuTrigger
                className="size-full"
                onContextMenuCapture={(event) => {
                    const target = event.target as Element;
                    const header = target.closest('[data-node-id] header');
                    if (header && !target.closest(HEADER_CONTROLS)) {
                        setCardId(
                            header
                                .closest('[data-node-id]')!
                                .getAttribute('data-node-id'),
                        );
                        setLinkId(null);
                        return;
                    }
                    setCardId(null);
                    if (target.closest(NOT_EMPTY)) {
                        // Not ours: let the browser show its menu.
                        event.stopPropagation();
                        return;
                    }
                    // A link's line, or its label (which Trellis draws in a
                    // layer of its own, tagged by `toEdges`).
                    const link =
                        target.closest('[data-edge-id]') ??
                        target
                            .closest('.trellis__edge-label')
                            ?.querySelector('[data-edge-id]');
                    setLinkId(link?.getAttribute('data-edge-id') ?? null);
                    point.current = flow.screenToFlowPosition({
                        x: event.clientX,
                        y: event.clientY,
                    });
                }}
            >
                {children}
            </ContextMenuTrigger>
            <ContextMenuPopup className="w-52">
                {cardId ? (
                    <>
                        {cardKind && isRenamable({ kind: cardKind }) && (
                            <ContextMenuItem
                                onClick={() => startRename(cardId)}
                            >
                                <PencilLineIcon aria-hidden="true" />
                                Rename
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem
                            onClick={() => void navigate(links.item(cardId))}
                        >
                            <FocusIcon aria-hidden="true" />
                            Focus
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            variant="destructive"
                            onClick={() => confirmDelete(cardId)}
                        >
                            <Trash2Icon aria-hidden="true" />
                            Delete…
                        </ContextMenuItem>
                    </>
                ) : (
                    emptyCanvasItems()
                )}
            </ContextMenuPopup>
        </ContextMenu>
    );

    /** The menu for empty canvas (and a link, when one was clicked). */
    function emptyCanvasItems() {
        return (
            <>
                {linkId && (
                    <>
                        <ContextMenuItem
                            variant="destructive"
                            onClick={() => onRemoveLink(linkId)}
                        >
                            <UnlinkIcon aria-hidden="true" />
                            Remove link
                            {linkLabel(linkId) && (
                                <span className="text-muted-foreground ms-auto truncate text-xs">
                                    {linkLabel(linkId)}
                                </span>
                            )}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}
                <ContextMenuSub>
                    <ContextMenuSubTrigger>
                        <SquarePlusIcon aria-hidden="true" />
                        Add here
                    </ContextMenuSubTrigger>
                    <ContextMenuSubPopup className="w-44">
                        {ADD_HERE.map(({ kind, label }) => {
                            const Icon = KIND_ICONS[kind];
                            return (
                                <ContextMenuItem
                                    key={kind}
                                    onClick={() =>
                                        add(kind, { at: { ...point.current } })
                                    }
                                >
                                    <Icon aria-hidden="true" />
                                    {label}
                                </ContextMenuItem>
                            );
                        })}
                    </ContextMenuSubPopup>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        onClick={() => flow.zoomIn({ duration: 200 })}
                    >
                        <ZoomInIcon aria-hidden="true" />
                        Zoom in
                    </ContextMenuItem>
                    <ContextMenuItem
                        onClick={() => flow.zoomOut({ duration: 200 })}
                    >
                        <ZoomOutIcon aria-hidden="true" />
                        Zoom out
                    </ContextMenuItem>
                    <ContextMenuItem
                        onClick={() => flow.zoomTo(1, { duration: 200 })}
                    >
                        <ScanIcon aria-hidden="true" />
                        Zoom to 100%
                    </ContextMenuItem>
                    <ContextMenuItem
                        onClick={() => flow.fitView({ duration: 300 })}
                    >
                        <MaximizeIcon aria-hidden="true" />
                        Fit to view
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={onArrange}>
                    <LayoutGridIcon aria-hidden="true" />
                    Arrange cards
                </ContextMenuItem>
                <ContextMenuItem onClick={onSearch}>
                    <SearchIcon aria-hidden="true" />
                    Search
                    <ContextMenuShortcut>⌘K</ContextMenuShortcut>
                </ContextMenuItem>
            </>
        );
    }
}
