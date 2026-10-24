import type { ReactElement } from 'react';
import { Link, useFetcher, useSubmit } from 'react-router';
import { useFlow } from '@sethdavis512/trellis';
import {
    BringToFrontIcon,
    CopyPlusIcon,
    ListPlusIcon,
    LockIcon,
    LockOpenIcon,
    Maximize2Icon,
    PaletteIcon,
    SendToBackIcon,
    Trash2Icon,
    ShapesIcon,
} from 'lucide-react';
import { cx } from 'cva.config';
import { Button } from '~/components/ui/button';
import {
    Menu,
    MenuGroup,
    MenuGroupLabel,
    MenuPopup,
    MenuRadioGroup,
    MenuRadioItem,
    MenuTrigger,
} from '~/components/ui/menu';
import {
    SHAPE_TYPES,
    WINDOW_COLOR_NAMES,
    type SurfaceItemKind,
    type WindowColor,
} from '~/lib/surface';
import { useAddCard } from './AddCard';
import { useDeleteCard } from './DeleteCard';
import { ShapePreview } from './ShapeTray';
import { shapeFetcherKey } from './ShapeWindow';
import { KindItem } from './AddCardMenu';
import {
    useStacking,
    useSurfaceItems,
    useWindowColors,
    useSurfaceLinks,
} from './surface-context';
import { WINDOW_COLORS } from './window-colors';

type Props = {
    itemId: string;
    title: string;
    focused: boolean;
    /** The window is selected (also how a tap reveals them on touch). */
    selected: boolean;
};

/**
 * A column of buttons floating off a window's right edge, near the top:
 * Focus (opens the window's own route, which fills the canvas with it),
 * Bring to front, Send to back, Duplicate (not for pull requests), Add to
 * (chats and documents: a chart, a pull request, or a video, page, or
 * image hanging under them), and a border color.
 *
 * They show only while you're working with the window: hovering it (the
 * window's root is `group/window`), focus inside it, the window selected
 * (a tap selects, which covers touch screens), or the color menu open.
 * Hidden, they ignore the pointer so they can't catch clicks meant for the
 * canvas. The column's left padding bridges the gap to the window, so the
 * pointer can travel to them without them fading on the way. Gone entirely
 * on the focused window, which fills the canvas; "Back to canvas" takes
 * over there.
 */
export function WindowControls({ itemId, title, focused, selected }: Props) {
    const links = useSurfaceLinks();
    const { bringToFront, sendToBack, isLocked, toggleLock } = useStacking();
    const locked = isLocked(itemId);
    const { kindOf } = useSurfaceItems();
    const duplicate = useDuplicate();
    const { confirmDelete } = useDeleteCard();
    if (focused) return null;

    return (
        <div
            className={cx(
                'nodrag absolute top-6 left-full flex flex-col gap-2 ps-3 motion-safe:transition-opacity motion-safe:duration-150',
                selected
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0 group-focus-within/window:pointer-events-auto group-focus-within/window:opacity-100 group-hover/window:pointer-events-auto group-hover/window:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100',
            )}
        >
            <ControlButton
                label={`Focus ${title}`}
                tip="Focus"
                render={<Link to={links.item(itemId)} prefetch="intent" />}
            >
                <Maximize2Icon aria-hidden="true" />
            </ControlButton>
            <ControlButton
                label={`${locked ? 'Unlock' : 'Lock'} ${title} in place`}
                tip={locked ? 'Unlock' : 'Lock in place'}
                pressed={locked}
                onClick={() => toggleLock(itemId)}
            >
                {locked ? (
                    <LockIcon aria-hidden="true" />
                ) : (
                    <LockOpenIcon aria-hidden="true" />
                )}
            </ControlButton>
            <ControlButton
                label={`Bring ${title} to front`}
                tip="Bring to front"
                onClick={() => bringToFront(itemId)}
            >
                <BringToFrontIcon aria-hidden="true" />
            </ControlButton>
            <ControlButton
                label={`Send ${title} to back`}
                tip="Send to back"
                onClick={() => sendToBack(itemId)}
            >
                <SendToBackIcon aria-hidden="true" />
            </ControlButton>
            {kindOf(itemId) !== 'pull-request' && (
                <ControlButton
                    label={`Duplicate ${title}`}
                    tip="Duplicate"
                    onClick={() => duplicate(itemId)}
                >
                    <CopyPlusIcon aria-hidden="true" />
                </ControlButton>
            )}
            {(kindOf(itemId) === 'chat' || kindOf(itemId) === 'document') && (
                <AddToMenu
                    itemId={itemId}
                    title={title}
                    chat={kindOf(itemId) === 'chat'}
                />
            )}
            {kindOf(itemId) === 'shape' && (
                <ShapeMenu itemId={itemId} title={title} />
            )}
            <ColorPicker itemId={itemId} title={title} />
            <ControlButton
                label={`Delete ${title}`}
                tip="Delete"
                destructive
                onClick={() => confirmDelete(itemId)}
            >
                <Trash2Icon aria-hidden="true" />
            </ControlButton>
        </div>
    );
}

/** How far down and right of the original a copy opens. */
const COPY_OFFSET = 48;

/**
 * Copies an item (`duplicate` intent). The copy opens a little down and
 * right of the original, where it is now on this canvas, and joins the
 * stack on top.
 */
function useDuplicate() {
    const links = useSurfaceLinks();
    const flow = useFlow();
    const submit = useSubmit();
    return (itemId: string) => {
        const position = flow.getNode(itemId)?.position;
        void submit(
            {
                intent: 'duplicate',
                itemId,
                ...(position
                    ? {
                          x: String(position.x + COPY_OFFSET),
                          y: String(position.y + COPY_OFFSET),
                      }
                    : {}),
            },
            {
                method: 'post',
                action: links.action,
                navigate: false,
                fetcherKey: `duplicate:${itemId}:${crypto.randomUUID()}`,
            },
        );
    };
}

type ControlButtonProps = {
    label: string;
    tip: string;
    /** A toggle that's on (the lock). */
    pressed?: boolean;
    children: ReactElement;
    onClick?: () => void;
    render?: ReactElement;
    /** Red on hover: it deletes. */
    destructive?: boolean;
};

function ControlButton({
    label,
    tip,
    children,
    onClick,
    render,
    pressed,
    destructive,
}: ControlButtonProps) {
    return (
        <Button
            variant="outline"
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            title={tip}
            onClick={onClick}
            render={render}
            className={cx(
                'bg-card rounded-full shadow-md',
                pressed && 'border-ring text-foreground bg-accent',
                destructive &&
                    'hover:text-destructive hover:border-destructive/60',
            )}
        >
            {children}
        </Button>
    );
}

type AddToMenuProps = {
    itemId: string;
    title: string;
    /** Chats also take pull requests. */
    chat: boolean;
};

/**
 * Adds a card that hangs under this chat or document: a chart (sample
 * numbers to start), a draft pull request (chats only), or a video, web
 * page, or image by address.
 */
function AddToMenu({ itemId, title, chat }: AddToMenuProps) {
    const { add } = useAddCard();
    const kinds: { kind: SurfaceItemKind; label: string }[] = [
        { kind: 'chart', label: 'Chart' },
        ...(chat
            ? [{ kind: 'pull-request' as const, label: 'Pull request' }]
            : []),
        { kind: 'video', label: 'Video…' },
        { kind: 'web', label: 'Web page…' },
        { kind: 'image', label: 'Image…' },
    ];
    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Add to ${title}`}
                        title="Add to this card"
                        className="bg-card rounded-full shadow-md"
                    />
                }
            >
                <ListPlusIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup side="right" align="start" className="w-44">
                <MenuGroup>
                    <MenuGroupLabel>Add to {title}</MenuGroupLabel>
                    {kinds.map(({ kind, label }) => (
                        <KindItem
                            key={kind}
                            kind={kind}
                            label={label}
                            onClick={() => add(kind, { attachedTo: itemId })}
                        />
                    ))}
                </MenuGroup>
            </MenuPopup>
        </Menu>
    );
}

const DEFAULT_COLOR = 'default';

type ColorPickerProps = {
    itemId: string;
    title: string;
};

/** Picks the window's border color from the six-color palette, or none. */
/** Changes a shape's outline (`set-shape`), shown at once. */
function ShapeMenu({ itemId, title }: { itemId: string; title: string }) {
    const links = useSurfaceLinks();
    const fetcher = useFetcher({ key: shapeFetcherKey(itemId) });
    const { itemOf } = useSurfaceItems();
    const item = itemOf(itemId);
    const pending = fetcher.formData?.get('shape');
    const current =
        typeof pending === 'string'
            ? pending
            : item?.kind === 'shape'
              ? item.shape
              : 'rectangle';

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Shape of ${title}`}
                        title="Shape"
                        className="bg-card rounded-full shadow-md"
                    />
                }
            >
                <ShapesIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup side="right" align="start" className="w-44">
                <MenuRadioGroup
                    value={current}
                    onValueChange={(shape: string) =>
                        void fetcher.submit(
                            { intent: 'set-shape', itemId, shape },
                            { method: 'post', action: links.action },
                        )
                    }
                >
                    {SHAPE_TYPES.map((shape) => (
                        <MenuRadioItem key={shape} value={shape} closeOnClick>
                            <span className="flex items-center gap-2 capitalize">
                                <ShapePreview shape={shape} />
                                {shape}
                            </span>
                        </MenuRadioItem>
                    ))}
                </MenuRadioGroup>
            </MenuPopup>
        </Menu>
    );
}

function ColorPicker({ itemId, title }: ColorPickerProps) {
    const { colorOf, setColor } = useWindowColors();
    const color = colorOf(itemId);

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Border color for ${title}`}
                        title="Border color"
                        className="bg-card relative rounded-full shadow-md"
                    />
                }
            >
                <PaletteIcon aria-hidden="true" />
                {color && (
                    <span
                        aria-hidden="true"
                        className={cx(
                            'ring-card absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2',
                            WINDOW_COLORS[color].swatch,
                        )}
                    />
                )}
            </MenuTrigger>
            <MenuPopup side="right" align="start" className="w-40">
                <MenuRadioGroup
                    value={color ?? DEFAULT_COLOR}
                    onValueChange={(value: string) =>
                        setColor(
                            itemId,
                            value === DEFAULT_COLOR
                                ? null
                                : (value as WindowColor),
                        )
                    }
                >
                    <MenuRadioItem value={DEFAULT_COLOR} closeOnClick>
                        <span className="flex items-center gap-2">
                            <span
                                aria-hidden="true"
                                className="border-border size-3.5 rounded-full border"
                            />
                            Default
                        </span>
                    </MenuRadioItem>
                    {WINDOW_COLOR_NAMES.map((name) => (
                        <MenuRadioItem key={name} value={name} closeOnClick>
                            <span className="flex items-center gap-2">
                                <span
                                    aria-hidden="true"
                                    className={cx(
                                        'size-3.5 rounded-full',
                                        WINDOW_COLORS[name].swatch,
                                    )}
                                />
                                {WINDOW_COLORS[name].label}
                            </span>
                        </MenuRadioItem>
                    ))}
                </MenuRadioGroup>
            </MenuPopup>
        </Menu>
    );
}
