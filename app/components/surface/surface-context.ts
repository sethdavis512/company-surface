import { createContext, useContext } from 'react';
import { useParams } from 'react-router';
import type {
    Person,
    PullRequestItem,
    SurfaceItem,
    SurfaceItemKind,
    WindowColor,
} from '~/lib/surface';
import { itemPath, surfacePath, viewPath } from '~/lib/surface';

type SurfacePeople = {
    meId: string;
    /** Everyone on the surface, "me" first. */
    people: Person[];
    personById: (id: string) => Person | undefined;
};

export const SurfacePeopleContext = createContext<SurfacePeople | null>(null);

export function useSurfacePeople(): SurfacePeople {
    const value = useContext(SurfacePeopleContext);
    if (!value) {
        throw new Error('useSurfacePeople needs a SurfacePeopleContext');
    }
    return value;
}

/** The item the URL focuses (`/cards/:itemId`), if any. */
export const FocusedItemContext = createContext<string | undefined>(undefined);

type Stacking = {
    bringToFront: (itemId: string) => void;
    sendToBack: (itemId: string) => void;
    /** Locked cards can't be dragged, and Arrange leaves them. */
    isLocked: (itemId: string) => boolean;
    toggleLock: (itemId: string) => void;
};

/** Reorders windows front to back. */
export const StackingContext = createContext<Stacking | null>(null);

export function useStacking(): Stacking {
    const value = useContext(StackingContext);
    if (!value) throw new Error('useStacking needs a StackingContext');
    return value;
}

type WindowColors = {
    colorOf: (itemId: string) => WindowColor | undefined;
    /** `null` goes back to the default border. */
    setColor: (itemId: string, color: WindowColor | null) => void;
};

/** Each window's chosen border color. */
export const WindowColorContext = createContext<WindowColors | null>(null);

export function useWindowColors(): WindowColors {
    const value = useContext(WindowColorContext);
    if (!value) throw new Error('useWindowColors needs a WindowColorContext');
    return value;
}

type SurfaceItems = {
    items: SurfaceItem[];
    itemOf: (itemId: string) => SurfaceItem | undefined;
    titleOf: (itemId: string) => string | undefined;
    kindOf: (itemId: string) => SurfaceItemKind | undefined;
    /** Pull requests a chat opened, newest first. */
    pullRequestsFrom: (chatId: string) => PullRequestItem[];
};

/** Lookups windows use to link to each other. */
export const SurfaceItemsContext = createContext<SurfaceItems | null>(null);

export function useSurfaceItems(): SurfaceItems {
    const value = useContext(SurfaceItemsContext);
    if (!value) throw new Error('useSurfaceItems needs a SurfaceItemsContext');
    return value;
}

/**
 * Where things on the open surface live: the route actions post to
 * (`action`), a card's focused route, a saved view's route. Use inside the
 * surface route (it reads `:surfaceId`).
 */
export function useSurfaceLinks() {
    const { surfaceId } = useParams();
    if (!surfaceId) throw new Error('useSurfaceLinks needs a surface route');
    return {
        surfaceId,
        action: surfacePath(surfaceId),
        item: (itemId: string) => itemPath(surfaceId, itemId),
        view: (viewId: string) => viewPath(surfaceId, viewId),
    };
}

type Renaming = {
    /** The card whose title is being edited, if any. */
    renamingId: string | null;
    startRename: (itemId: string) => void;
    stopRename: () => void;
};

/** Which card's title is open for editing (`CardTitle`, the card menu). */
export const RenamingContext = createContext<Renaming | null>(null);

export function useRenaming(): Renaming {
    const value = useContext(RenamingContext);
    if (!value) throw new Error('useRenaming needs a RenamingContext');
    return value;
}

type Resizing = {
    /** Resizes a card on the canvas while its grip is dragged. */
    resize: (itemId: string, size: { width: number; height: number }) => void;
    /** Saves the size it was dropped at (`resize-card`). */
    commitResize: (
        itemId: string,
        size: { width: number; height: number },
    ) => void;
};

/** Resizing cards that keep their own size (shapes). */
export const ResizingContext = createContext<Resizing | null>(null);

export function useResizing(): Resizing {
    const value = useContext(ResizingContext);
    if (!value) throw new Error('useResizing needs a ResizingContext');
    return value;
}
