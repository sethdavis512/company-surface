import type { CSSProperties } from 'react';
import { Handle } from '@sethdavis512/trellis';

/** How far the connect zone reaches outside a card, and into it, in px. */
const OUTSIDE = 10;
const INSIDE = 4;
const HOLE = OUTSIDE + INSIDE;

/**
 * The whole edge of a card is where links start (React Flow's "easy
 * connect"): a band just outside and along its border. Drag from it onto
 * another card to link the two (a "related" relation); it lights up under
 * the pointer. It's a ring (clip-path, which also limits where it can be
 * hit), so the card's own content and header drag are untouched. Links
 * arrive on the hidden `in` handle, though dropping anywhere on a card
 * is enough, and float to whichever sides face each other (`FloatingEdge`).
 */
const RING_STYLE = {
    inset: -OUTSIDE,
    top: -OUTSIDE,
    left: -OUTSIDE,
    width: 'auto',
    height: 'auto',
    transform: 'none',
    borderRadius: 18,
    zIndex: 0,
    clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${HOLE}px ${HOLE}px, ${HOLE}px calc(100% - ${HOLE}px), calc(100% - ${HOLE}px) calc(100% - ${HOLE}px), calc(100% - ${HOLE}px) ${HOLE}px, ${HOLE}px ${HOLE}px)`,
    '--trellis-handle-border': 'transparent',
    '--trellis-selected': 'color-mix(in oklab, var(--ring) 55%, transparent)',
} as CSSProperties;

export function LinkHandle() {
    return (
        <>
            <Handle
                id="in"
                type="target"
                position="left"
                className="opacity-0"
            />
            <Handle
                id="link"
                type="source"
                position="right"
                style={RING_STYLE}
                // A faint band while you're over the card says where to
                // grab; it lights up fully under the pointer.
                className="[--trellis-handle-bg:transparent] group-hover/window:[--trellis-handle-bg:color-mix(in_oklab,var(--ring)_18%,transparent)]"
            />
        </>
    );
}
