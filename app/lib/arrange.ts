import {
    WINDOW_GAP,
    hangingUnder,
    parentIdOf,
    placeWindows,
    sizeOf,
    type Relation,
    type SurfaceItem,
    type SurfaceItemKind,
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

/** Roughly a screen's shape: what packed rows aim for. */
const PACK_ASPECT = 16 / 9;

/** Which card a cluster centers on when link counts tie. */
const HUB_RANK: Partial<Record<SurfaceItemKind, number>> = {
    chat: 0,
    document: 1,
    board: 2,
};

type Box = { width: number; height: number };

/**
 * Shelf packing: boxes left to right in rows, a new row when the next one
 * would pass the target width (about `PACK_ASPECT` of their total area, and
 * never narrower than the widest box). Returns each box's corner and the
 * whole thing's size.
 */
function packRows(boxes: readonly Box[], gap: number) {
    const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
    const target = Math.max(
        ...boxes.map((box) => box.width),
        Math.sqrt(area * PACK_ASPECT),
    );
    const corners: Spot[] = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let width = 0;
    for (const box of boxes) {
        if (x > 0 && x + box.width > target) {
            y += rowHeight + gap;
            x = 0;
            rowHeight = 0;
        }
        corners.push({ x, y });
        width = Math.max(width, x + box.width);
        rowHeight = Math.max(rowHeight, box.height);
        x += box.width + gap;
    }
    return { corners, width, height: boxes.length > 0 ? y + rowHeight : 0 };
}

/** A laid-out cluster: card spots from its corner, and its size. */
type Cluster = Box & { members: { id: string; dx: number; dy: number }[] };

function clusterOf(blocks: Block[], hubId: string | null, gap: number) {
    const hub = blocks.find((block) => block.id === hubId);
    const rest = blocks.filter((block) => block !== hub);
    const packed = packRows(rest, gap);
    const left = hub ? hub.width + gap : 0;
    const members = [
        ...(hub?.members ?? []),
        ...rest.flatMap((block, index) =>
            block.members.map((member) => ({
                id: member.id,
                dx: left + packed.corners[index]!.x + member.dx,
                dy: packed.corners[index]!.y + member.dy,
            })),
        ),
    ];
    return {
        members,
        width: rest.length > 0 ? left + packed.width : (hub?.width ?? 0),
        height: Math.max(hub?.height ?? 0, packed.height),
    } satisfies Cluster;
}

/**
 * Arrange by links: cards joined by links (or hanging under one another)
 * form a cluster, laid out around its hub (the card with the most links,
 * a chat or document when that ties) with the hub on the left, what hangs
 * under it below, and the rest packed in rows beside it, tallest first.
 * Clusters pack into rows, biggest first; cards linked to nothing share a
 * last cluster, chats first. Locked cards stay put and link nothing
 * together. Returns a spot for every card that moves.
 */
export function clusterLayout(
    items: SurfaceItem[],
    relations: readonly Relation[],
    {
        locked = new Set<string>(),
        gap = WINDOW_GAP,
    }: { locked?: ReadonlySet<string>; gap?: number } = {},
): Record<string, Spot> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const topOf = (id: string) => {
        const parentId = parentIdOf(byId.get(id)!);
        return parentId !== undefined && byId.has(parentId) ? parentId : id;
    };
    const tops = items.filter(
        (item) => topOf(item.id) === item.id && !locked.has(item.id),
    );
    const order = new Map(tops.map((item, index) => [item.id, index]));

    // Links between top cards (a link to a hanging card counts for its
    // parent), each pair once.
    const neighbors = new Map(tops.map((item) => [item.id, new Set<string>()]));
    for (const { from, to } of relations) {
        if (!byId.has(from) || !byId.has(to)) continue;
        const a = topOf(from);
        const b = topOf(to);
        if (a === b || !neighbors.has(a) || !neighbors.has(b)) continue;
        neighbors.get(a)!.add(b);
        neighbors.get(b)!.add(a);
    }

    // Connected clusters, each in the order a walk from its hub meets them.
    const hubFirst = (a: SurfaceItem, b: SurfaceItem) =>
        neighbors.get(b.id)!.size - neighbors.get(a.id)!.size ||
        (HUB_RANK[a.kind] ?? 9) - (HUB_RANK[b.kind] ?? 9) ||
        order.get(a.id)! - order.get(b.id)!;
    const seen = new Set<string>();
    const linked: { hubId: string; ids: string[] }[] = [];
    const loose: SurfaceItem[] = [];
    for (const start of tops) {
        if (seen.has(start.id)) continue;
        if (neighbors.get(start.id)!.size === 0) {
            seen.add(start.id);
            loose.push(start);
            continue;
        }
        const component: SurfaceItem[] = [];
        const queue = [start.id];
        seen.add(start.id);
        while (queue.length > 0) {
            const id = queue.shift()!;
            component.push(byId.get(id)!);
            for (const next of neighbors.get(id)!) {
                if (!seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        const hub = [...component].sort(hubFirst)[0]!;
        const walk: string[] = [hub.id];
        const met = new Set(walk);
        for (let i = 0; i < walk.length; i++) {
            for (const next of [...neighbors.get(walk[i]!)!].sort(
                (a, b) => order.get(a)! - order.get(b)!,
            )) {
                if (!met.has(next)) {
                    met.add(next);
                    walk.push(next);
                }
            }
        }
        linked.push({ hubId: hub.id, ids: walk });
    }

    const tallestFirst = (a: Block, b: Block) => b.height - a.height;
    const clusters: Cluster[] = linked
        .map(({ hubId, ids }) => {
            const blocks = ids.map((id) => blockOf(byId.get(id)!, items));
            const [hub, ...rest] = blocks;
            return clusterOf([hub!, ...rest.sort(tallestFirst)], hubId, gap);
        })
        .sort((a, b) => b.width * b.height - a.width * a.height);
    if (loose.length > 0) {
        const kindFirst = [...loose].sort(
            (a, b) =>
                (HUB_RANK[a.kind] ?? 9) - (HUB_RANK[b.kind] ?? 9) ||
                order.get(a.id)! - order.get(b.id)!,
        );
        clusters.push(
            clusterOf(
                kindFirst.map((item) => blockOf(item, items)),
                null,
                gap,
            ),
        );
    }

    const packed = packRows(clusters, GROUP_GAP);
    const positions: Record<string, Spot> = {};
    clusters.forEach((cluster, index) => {
        const corner = packed.corners[index]!;
        for (const member of cluster.members) {
            positions[member.id] = {
                x: corner.x + member.dx,
                y: corner.y + member.dy,
            };
        }
    });
    return positions;
}

/** The top-left corner of a set of placed cards (0, 0 for none). */
export function topLeftOf(spots: readonly Spot[]): Spot {
    if (spots.length === 0) return { x: 0, y: 0 };
    return {
        x: Math.min(...spots.map((spot) => spot.x)),
        y: Math.min(...spots.map((spot) => spot.y)),
    };
}
