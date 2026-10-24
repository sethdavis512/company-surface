import type { PathInput, Position, Rect, XY } from '@sethdavis512/trellis';

/** How far outside a card a link stops, so its arrowhead shows. */
const STANDOFF = 3;

function centerOf(box: Rect): XY {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where the line from a card's center toward a point leaves the card, and
 * which side that is.
 */
export function borderPoint(
    box: Rect,
    toward: XY,
): { x: number; y: number; side: Position } {
    const center = centerOf(box);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    if (dx === 0 && dy === 0) return { x: center.x, y: box.y, side: 'top' };
    const halfW = box.width / 2 + STANDOFF;
    const halfH = box.height / 2 + STANDOFF;
    // How far along the line each pair of sides is; the nearer one wins.
    const alongX = dx === 0 ? Infinity : halfW / Math.abs(dx);
    const alongY = dy === 0 ? Infinity : halfH / Math.abs(dy);
    const along = Math.min(alongX, alongY);
    const side: Position =
        alongX < alongY
            ? dx > 0
                ? 'right'
                : 'left'
            : dy > 0
              ? 'bottom'
              : 'top';
    return { x: center.x + dx * along, y: center.y + dy * along, side };
}

/** How far apart two links between the same cards (one each way) run. */
export const BOTH_WAYS_GAP = 14;

/**
 * Moves a link's ends to its left (seen from source to target), so a link
 * and one going back the other way run side by side instead of on top of
 * each other.
 */
export function offsetEnds(ends: PathInput, by: number): PathInput {
    const dx = ends.targetX - ends.sourceX;
    const dy = ends.targetY - ends.sourceY;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (dy / length) * by;
    const ny = (-dx / length) * by;
    return {
        ...ends,
        sourceX: ends.sourceX + nx,
        sourceY: ends.sourceY + ny,
        targetX: ends.targetX + nx,
        targetY: ends.targetY + ny,
    };
}

/**
 * A link's ends when it floats: each leaves its card where the cards face
 * each other, rather than from a fixed handle, so links take the short way
 * however the cards are arranged (React Flow's "floating edges").
 */
export function floatingEnds(source: Rect, target: Rect): PathInput {
    const from = borderPoint(source, centerOf(target));
    const to = borderPoint(target, centerOf(source));
    return {
        sourceX: from.x,
        sourceY: from.y,
        sourcePosition: from.side,
        targetX: to.x,
        targetY: to.y,
        targetPosition: to.side,
    };
}
