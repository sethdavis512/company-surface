import {
    BaseEdge,
    getBezierPath,
    useFlow,
    type EdgeProps,
} from '@sethdavis512/trellis';
import { BOTH_WAYS_GAP, floatingEnds, offsetEnds } from '~/lib/floating-edge';

/**
 * A link between two cards that leaves and enters wherever the cards face
 * each other (`floatingEnds`), not at a fixed handle, so it takes the short
 * way however the cards sit. It redraws as either card moves or resizes,
 * since its handle coordinates change with them. When a link also runs
 * back the other way (`data.bothWays`), each keeps to its own side.
 */
/** Where a two-way link's label sits, from its source (0) to target (1). */
const LABEL_AT = 0.3;

export function FloatingEdge({
    source,
    target,
    data,
    label,
    markerStart,
    markerEnd,
    style,
}: EdgeProps) {
    const flow = useFlow();
    const from = flow.getNodeBox(source);
    const to = flow.getNodeBox(target);
    if (!from || !to) return null;
    const bothWays = Boolean(data?.bothWays);
    const ends = bothWays
        ? offsetEnds(floatingEnds(from, to), BOTH_WAYS_GAP / 2)
        : floatingEnds(from, to);
    const curve = getBezierPath(ends);
    // Side by side, the two labels would sit on top of each other in the
    // middle, so each moves toward the card its link leaves from.
    const labelX = bothWays
        ? ends.sourceX + (ends.targetX - ends.sourceX) * LABEL_AT
        : curve.labelX;
    const labelY = bothWays
        ? ends.sourceY + (ends.targetY - ends.sourceY) * LABEL_AT
        : curve.labelY;
    const { path } = curve;
    return (
        <BaseEdge
            path={path}
            labelX={labelX}
            labelY={labelY}
            label={label}
            markerStart={markerStart}
            markerEnd={markerEnd}
            style={style}
        />
    );
}
