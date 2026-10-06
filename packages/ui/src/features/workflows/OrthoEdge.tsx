import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
export type OrthoEdgeData = {
  /** Interior corners in flow coordinates; the handles supply the endpoints. */
  points: { x: number; y: number }[];
};
const RADIUS = 8;
/** Route a forward edge through column gaps: right out of the source, vertically inside a gap, and horizontally into the target. */
export function OrthoEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<Edge<OrthoEdgeData, 'ortho'>>) {
  // The first and last legs are horizontal: pin their y to the measured
  // handles so a sub-pixel layout difference never tilts them.
  const corners = (data?.points ?? []).map((point, i, all) => ({
    x: point.x,
    y: i === 0 ? sourceY : i === all.length - 1 ? targetY : point.y,
  }));
  const points = [
    { x: sourceX, y: sourceY },
    ...corners,
    { x: targetX, y: targetY },
  ].filter(
    (point, i, all) =>
      !i || point.x !== all[i - 1].x || point.y !== all[i - 1].y,
  );
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1],
      corner = points[i],
      next = points[i + 1];
    const before = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(RADIUS, before / 2, after / 2);
    const start = {
      x: corner.x + ((prev.x - corner.x) / before) * r,
      y: corner.y + ((prev.y - corner.y) / before) * r,
    };
    const end = {
      x: corner.x + ((next.x - corner.x) / after) * r,
      y: corner.y + ((next.y - corner.y) / after) * r,
    };
    path += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
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
