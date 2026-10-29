import { SquarePlusIcon } from 'lucide-react';
import {
    Menu,
    MenuGroup,
    MenuGroupLabel,
    MenuItem,
    MenuPopup,
    MenuSeparator,
    MenuTrigger,
} from '~/components/ui/menu';
import type { SurfaceItemKind } from '~/lib/surface';
import { useAddCard } from './AddCard';
import { KIND_ICONS } from './kind-icons';

const NEW_CARDS: { kind: SurfaceItemKind; label: string }[] = [
    { kind: 'chat', label: 'Chat' },
    { kind: 'document', label: 'Document' },
    { kind: 'board', label: 'Board' },
    { kind: 'note', label: 'Sticky note' },
    { kind: 'sketch', label: 'Sketch' },
    { kind: 'ui', label: 'UI' },
];

const BY_ADDRESS: { kind: SurfaceItemKind; label: string }[] = [
    { kind: 'video', label: 'Video…' },
    { kind: 'web', label: 'Web page…' },
    { kind: 'image', label: 'Image…' },
];

/**
 * "Add" in its own tray at the canvas's top left, beside the filters (the
 * zoom and arrange controls stay about the view): adds a card in the middle
 * of what you're looking at.
 */
export function AddCardMenu() {
    const { add } = useAddCard();
    return (
        <Menu>
            {/* Its own tray, the filter bar's shape, pinned top left. */}
            <div className="bg-card pointer-events-auto shrink-0 rounded-full border p-1 shadow-md">
                <MenuTrigger
                    title="Add a card"
                    className="hover:bg-accent focus-visible:ring-ring data-popup-open:bg-accent inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium outline-none focus-visible:ring-2 pointer-coarse:h-10"
                >
                    <SquarePlusIcon aria-hidden="true" className="size-4" />
                    Add
                </MenuTrigger>
            </div>
            <MenuPopup side="bottom" align="start" className="w-48">
                <MenuGroup>
                    <MenuGroupLabel>Add card</MenuGroupLabel>
                    {NEW_CARDS.map(({ kind, label }) => (
                        <KindItem
                            key={kind}
                            kind={kind}
                            label={label}
                            onClick={() => add(kind)}
                        />
                    ))}
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                    <MenuGroupLabel>By address</MenuGroupLabel>
                    {BY_ADDRESS.map(({ kind, label }) => (
                        <KindItem
                            key={kind}
                            kind={kind}
                            label={label}
                            onClick={() => add(kind)}
                        />
                    ))}
                </MenuGroup>
            </MenuPopup>
        </Menu>
    );
}

type KindItemProps = {
    kind: SurfaceItemKind;
    label: string;
    onClick: () => void;
};

export function KindItem({ kind, label, onClick }: KindItemProps) {
    const Icon = KIND_ICONS[kind];
    return (
        <MenuItem onClick={onClick}>
            <Icon aria-hidden="true" />
            {label}
        </MenuItem>
    );
}
