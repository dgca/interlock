import { z } from 'zod';
import type { WorkflowDefinition } from './index.js';

export type WorkflowPositions = Record<string, { x: number; y: number }>;
const positionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
// Zod 3's record parser drops literal __proto__ keys. Node IDs stay literal.
export const workflowPositionsSchema = z
  .custom<WorkflowPositions>(
    (value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value),
    'Expected a map of node IDs to positions.',
  )
  .superRefine((positions, ctx) => {
    if (!positions || typeof positions !== 'object' || Array.isArray(positions))
      return;
    const entries = Object.entries(positions);
    for (const [id, position] of entries) {
      if (!id.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [id],
          message: 'Node IDs must not be empty.',
        });
      const parsed = positionSchema.safeParse(position);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: [id, ...issue.path] });
    }
  });

export const workflowLayoutInputSchema = z
  .object({
    id: z.string().min(1),
    expectedRevision: z.number().int().min(0),
    positions: workflowPositionsSchema,
  })
  .strict();

export interface WorkflowLayout {
  id: string;
  revision: number;
  positions: WorkflowPositions;
}

export const workflowPositions = (
  definition: WorkflowDefinition,
): WorkflowPositions =>
  Object.fromEntries(
    definition.nodes.map((node) => [node.id, { ...node.position }]),
  );

export function applyWorkflowPositions(
  definition: WorkflowDefinition,
  positions: WorkflowPositions,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      Object.hasOwn(positions, node.id)
        ? { ...node, position: { ...positions[node.id] } }
        : node,
    ),
  };
}

/** Presentation coordinates are the direct node field, never nested user data. */
export function withoutWorkflowPositions(definition: WorkflowDefinition) {
  return {
    ...definition,
    nodes: definition.nodes.map(({ position: _position, ...node }) => node),
  };
}

const contentKey = (definition: WorkflowDefinition) =>
  JSON.stringify(withoutWorkflowPositions(definition), (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );

export const sameWorkflowContent = (
  a: WorkflowDefinition,
  b: WorkflowDefinition,
) => contentKey(a) === contentKey(b);
