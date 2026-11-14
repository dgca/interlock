import { z } from 'zod';
import type { Json } from './index.js';

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

/** Groups without either setting keep the original all-branches join and output. */
export const isPartialJoin = (node: JoinSettings) =>
  node.joinAfter !== undefined || node.onBranchFailure !== undefined;

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
  | { kind: 'complete'; output: Json; reason: string };

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
        reason: '',
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
      reason: `${node.label} join satisfied after ${required} of ${count} branches`,
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
