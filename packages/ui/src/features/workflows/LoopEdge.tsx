import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
export type LoopEdgeData = { laneY: number; lane: number };
const STUB = 24;
const LANE_GAP = 12;
const RADIUS = 8;
/** Route a loop around the graph: out of the source, down to its lane, left, and up into the target. */
export function LoopEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<Edge<LoopEdgeData, 'loop'>>) {
  const lane = data?.lane ?? 0;
  const laneY = data?.laneY ?? Math.max(sourceY, targetY) + STUB;
  // Each loop also gets its own x offsets, so verticals don't stack on one line.
  const outX = sourceX + STUB + lane * LANE_GAP;
  const inX = targetX - STUB - lane * LANE_GAP;
  const r = RADIUS;
  const down = laneY > sourceY;
  const up = targetY < laneY;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `H ${outX - r}`,
    `Q ${outX} ${sourceY} ${outX} ${sourceY + (down ? r : -r)}`,
    `V ${laneY - (down ? r : -r)}`,
    `Q ${outX} ${laneY} ${outX - r} ${laneY}`,
    `H ${inX + r}`,
    `Q ${inX} ${laneY} ${inX} ${laneY - (up ? r : -r)}`,
    `V ${targetY + (up ? r : -r)}`,
    `Q ${inX} ${targetY} ${inX + r} ${targetY}`,
    `H ${targetX}`,
  ].join(' ');
  return (
    <BaseEdge
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}
