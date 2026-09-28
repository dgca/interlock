import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
export type LoopEdgeData = { laneY: number };
const STUB = 24;
/** Route a backward edge around the graph: out of the source, down to its lane, left, and up into the target. */
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
  const path = [
    `M ${sourceX} ${sourceY}`,
    `H ${sourceX + STUB}`,
    `V ${laneY}`,
    `H ${targetX - STUB}`,
    `V ${targetY}`,
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
