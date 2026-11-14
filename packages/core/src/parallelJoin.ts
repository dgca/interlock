import { z } from 'zod';
import type { Json, WorkflowDefinition } from './index.js';
import { bindingLeaves } from './valueBindings.js';

type ParallelBranchStatus = 'completed' | 'failed' | 'cancelled';

export const parallelFields = {
  branches: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        key: z.string().max(64),
      }),
    )
    .max(50)
    .describe(
      'Publish with 2–50 unique branch IDs and nonblank result keys. Members set parallelId and parallelBranchId. Wire branch:<id> in, join back and complete out.',
    ),
  concurrency: z.number().int().min(1).max(50).default(5),
  /** Successful branches that satisfy the join. Omission waits for every branch. */
  joinAfter: z.number().int().min(1).max(50).optional(),
  /** continue keeps going while joinAfter can still be reached. Omission fails the group. */
  onBranchFailure: z.enum(['fail', 'continue']).optional(),
};

type JoinSettings = {
  label: string;
  branches: { id: string; key: string }[];
  joinAfter?: number;
  onBranchFailure?: 'fail' | 'continue';
};

/**
 * Only a setting that changes behaviour makes a partial join. Explicit
 * defaults (joinAfter equal to the branch count, onBranchFailure "fail") keep
 * the original all-branches join and output. Publication rejects "continue"
 * without a smaller joinAfter.
 */
const isPartialJoin = (node: JoinSettings) =>
  (node.joinAfter ?? node.branches.length) < node.branches.length;

/** Output shape of a partial join, for hints and contract checks. */
export function joinOutputSchema(node: JoinSettings) {
  if (!isPartialJoin(node)) return;
  const keyed = (schema: object) => ({
    type: 'object',
    properties: Object.fromEntries(
      node.branches.map(({ key }) => [key, schema]),
    ),
  });
  return {
    type: 'object',
    properties: {
      results: keyed({}),
      branches: keyed({
        type: 'string',
        enum: ['completed', 'failed', 'cancelled'],
      }),
    },
    required: ['results', 'branches'],
  };
}

const topFields = (schema: Record<string, unknown>) => [
  ...Object.keys(schema.properties ?? {}),
  ...(Array.isArray(schema.required) ? (schema.required as string[]) : []),
];

/**
 * A contract, binding or next-step input written for the all-branches result
 * object reads branch keys at the top level, which a partial join moves.
 */
export function partialJoinShapeError(
  definition: WorkflowDefinition,
): string | undefined {
  for (const group of definition.nodes) {
    if (group.kind !== 'parallel' || !isPartialJoin(group)) continue;
    const keys = new Set(group.branches.map(({ key }) => key));
    keys.delete('results');
    keys.delete('branches');
    const stale = (field: string) => keys.has(field);
    const advice = `${group.label} continues before every branch finishes, so results are under results.<branch> and statuses under branches.<branch>`;
    const field = topFields(group.outputSchema).find(stale);
    if (field)
      return `${group.label}: output contract reads "${field}". ${advice}.`;
    const next = definition.edges
      .filter((edge) => edge.source === group.id && edge.port === 'complete')
      .map((edge) => definition.nodes.find((node) => node.id === edge.target));
    for (const node of definition.nodes) {
      const binding = [
        ...bindingLeaves(node.inputBindings ?? {}),
        ...bindingLeaves(node.outputBindings ?? {}),
      ].find(
        (leaf) =>
          leaf.source === 'node' &&
          leaf.nodeId === group.id &&
          stale(leaf.path.split('.')[0]),
      );
      if (binding)
        return `${node.label}: binding reads "${binding.path}" from ${group.label}. ${advice}.`;
      const input =
        !node.inputBindings && next.includes(node)
          ? topFields(node.inputSchema).find(stale)
          : undefined;
      if (input)
        return `${node.label}: input contract expects "${input}" from ${group.label}. ${advice}.`;
    }
  }
}

export function parallelJoinError(node: JoinSettings): string | undefined {
  const count = node.branches.length;
  if (node.joinAfter !== undefined && node.joinAfter > count)
    return `${node.label}: continue after 1 to ${count} branches`;
  if (node.onBranchFailure === 'continue' && (node.joinAfter ?? count) >= count)
    return `${node.label}: continuing after a branch failure needs fewer required branches than the ${count} branches`;
}

type Branch = { status: string; output?: Json; error?: string; id: string };

export type JoinDecision =
  | { kind: 'wait' }
  | { kind: 'fail'; error: string }
  | { kind: 'complete'; output: Json; cancel: JoinCancel };
/** Recorded on branch runs a join cancels. join marks a satisfied join. */
export type JoinCancel = { reason: string; join?: true };

/**
 * Decide a group visit from its branch runs, ordered by branch. Retried
 * branches count as still able to succeed. Satisfaction wins over a failure
 * recorded in the same pass.
 */
export function decideJoin(
  node: JoinSettings,
  children: (Branch & { parallelBranch?: { key: string } })[],
  retrying: string[] = [],
): JoinDecision {
  const count = node.branches.length,
    required = node.joinAfter ?? count;
  const completed = children.filter((child) => child.status === 'completed');
  if (completed.length >= required) {
    if (!isPartialJoin(node))
      return {
        kind: 'complete',
        output: Object.fromEntries(
          children.map((child) => [child.parallelBranch!.key, child.output!]),
        ),
        cancel: { reason: '' },
      };
    const status = new Map<string, ParallelBranchStatus>(
      children.map((child) => [
        child.parallelBranch!.key,
        child.status === 'completed' || child.status === 'failed'
          ? child.status
          : 'cancelled',
      ]),
    );
    return {
      kind: 'complete',
      output: {
        results: Object.fromEntries(
          completed.map((child) => [child.parallelBranch!.key, child.output!]),
        ),
        branches: Object.fromEntries(
          node.branches.map(({ key }) => [key, status.get(key) ?? 'cancelled']),
        ),
      },
      cancel: {
        reason: `${node.label} join satisfied after ${required} of ${count} branches`,
        join: true,
      },
    };
  }
  const unsuccessful = children.filter(
    (child) =>
      (child.status === 'failed' || child.status === 'cancelled') &&
      !retrying.includes(child.id),
  );
  const failed = unsuccessful[0];
  if (!failed) return { kind: 'wait' };
  const message = `Parallel branch "${failed.parallelBranch?.key}" ${failed.status}: ${failed.error ?? failed.id}`;
  if (node.onBranchFailure !== 'continue')
    return { kind: 'fail', error: message };
  if (count - unsuccessful.length < required)
    return {
      kind: 'fail',
      error: `${message}; ${unsuccessful.length} of ${count} branches did not complete, so ${required} cannot succeed`,
    };
  return { kind: 'wait' };
}
