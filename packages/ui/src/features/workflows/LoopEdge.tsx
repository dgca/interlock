import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
export type LoopEdgeData = {
  laneY: number;
  outOffset: number;
  inOffset: number;
};
const STUB = 24;
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
  const laneY = data?.laneY ?? Math.max(sourceY, targetY) + STUB;
  const outOffset = data?.outOffset ?? STUB;
  const inOffset = data?.inOffset ?? STUB;
  const outX = sourceX + outOffset;
  const inX = targetX - inOffset;
  const r = Math.min(RADIUS, outOffset / 2, inOffset / 2);
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
