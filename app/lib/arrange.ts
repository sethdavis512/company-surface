import {
    WINDOW_GAP,
    hangingUnder,
    parentIdOf,
    placeWindows,
    sizeOf,
    type SurfaceItem,
    type WindowPlacement,
} from './surface';

/**
 * Laying cards out on purpose (agents arranging a surface): pure geometry,
 * client-safe, so the store and tests share it.
 */

export type Spot = { x: number; y: number };

/** How arranged groups sit: side by side as columns, or stacked as rows. */
export const ARRANGE_DIRECTIONS = ['columns', 'rows'] as const;
export type ArrangeDirection = (typeof ARRANGE_DIRECTIONS)[number];

/** Between groups: wide enough that each reads as its own cluster. */
export const GROUP_GAP = WINDOW_GAP * 3;

/**
 * Where every card is now, as a fresh load draws it: its saved spot, else
 * the tidy layout's (`placeWindows`).
 */
export function currentLayout(
    items: SurfaceItem[],
    positions: Partial<Record<string, Spot>>,
): WindowPlacement[] {
    return placeWindows(items).map((spot) => ({
        ...spot,
        ...(positions[spot.id] ?? {}),
    }));
}

type Block = {
    id: string;
    width: number;
    height: number;
    /** The card and what hangs under it, offset from the block's corner. */
    members: { id: string; dx: number; dy: number }[];
};

/** A card with everything hanging under it stacked below, as one block. */
function blockOf(item: SurfaceItem, items: SurfaceItem[]): Block {
    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const stack = [
        item,
        ...hangingUnder(item.id, items).map((id) => byId.get(id)!),
    ];
    let dy = 0;
    const members = stack.map((member) => {
        const placed = { id: member.id, dx: 0, dy };
        dy += sizeOf(member).height + WINDOW_GAP;
        return placed;
    });
    return {
        id: item.id,
        width: Math.max(...stack.map((member) => sizeOf(member).width)),
        height: dy - WINDOW_GAP,
        members,
    };
}

export type ArrangeResult = {
    /** New spots for every card that moves, hanging cards included. */
    positions: Record<string, Spot>;
    /** Cards asked for that stay put, and why. */
    skipped: { id: string; reason: string }[];
    /** Each group's box, in order, for framing a view of it. */
    groups: { x: number; y: number; width: number; height: number }[];
};

/**
 * Lays out groups of cards: each group a column (cards top to bottom) with
 * the groups left to right, or each a row (cards left to right) with the
 * groups top to bottom. A card takes whatever hangs under it along
 * (charts, pull requests, pages under a chat), so naming a hanging card
 * on its own does nothing. Locked cards stay where they are pinned.
 * `rest: 'append'` puts every card no group names into a last group, so
 * nothing is left underneath the new layout.
 */
export function arrangeGroups(
    items: SurfaceItem[],
    groups: readonly (readonly string[])[],
    {
        direction,
        origin,
        gap = WINDOW_GAP,
        locked = new Set<string>(),
        rest = 'append',
    }: {
        direction: ArrangeDirection;
        origin: Spot;
        gap?: number;
        locked?: ReadonlySet<string>;
        rest?: 'append' | 'leave';
    },
): ArrangeResult {
    const byId = new Map(items.map((item) => [item.id, item]));
    const hangs = (item: SurfaceItem) => {
        const parentId = parentIdOf(item);
        return parentId !== undefined && byId.has(parentId);
    };
    const skipped: ArrangeResult['skipped'] = [];
    const seen = new Set<string>();

    const pick = (ids: readonly string[]) =>
        ids.flatMap((id) => {
            const item = byId.get(id);
            if (!item || seen.has(id)) return [];
            seen.add(id);
            if (hangs(item)) {
                skipped.push({
                    id,
                    reason: `hangs under ${parentIdOf(item)} and moves with it`,
                });
                return [];
            }
            if (locked.has(id)) {
                skipped.push({ id, reason: 'locked in place' });
                return [];
            }
            return [item];
        });

    const named = groups.map(pick).filter((group) => group.length > 0);
    if (rest === 'append') {
        const left = items.filter(
            (item) =>
                !seen.has(item.id) && !hangs(item) && !locked.has(item.id),
        );
        if (left.length > 0) named.push(left);
    }

    const positions: Record<string, Spot> = {};
    const boxes: ArrangeResult['groups'] = [];
    const place = (block: Block, at: Spot) => {
        for (const member of block.members) {
            positions[member.id] = { x: at.x + member.dx, y: at.y + member.dy };
        }
    };

    let cursor = { ...origin };
    for (const group of named) {
        const blocks = group.map((item) => blockOf(item, items));
        let along = 0;
        let across = 0;
        for (const block of blocks) {
            if (direction === 'columns') {
                place(block, { x: cursor.x, y: cursor.y + along });
                along += block.height + gap;
                across = Math.max(across, block.width);
            } else {
                place(block, { x: cursor.x + along, y: cursor.y });
                along += block.width + gap;
                across = Math.max(across, block.height);
            }
        }
        const length = along - gap;
        if (direction === 'columns') {
            boxes.push({ ...cursor, width: across, height: length });
            cursor = { x: cursor.x + across + GROUP_GAP, y: cursor.y };
        } else {
            boxes.push({ ...cursor, width: length, height: across });
            cursor = { x: cursor.x, y: cursor.y + across + GROUP_GAP };
        }
    }
    return { positions, skipped, groups: boxes };
}

/** The top-left corner of a set of placed cards (0, 0 for none). */
export function topLeftOf(spots: readonly Spot[]): Spot {
    if (spots.length === 0) return { x: 0, y: 0 };
    return {
        x: Math.min(...spots.map((spot) => spot.x)),
        y: Math.min(...spots.map((spot) => spot.y)),
    };
}
