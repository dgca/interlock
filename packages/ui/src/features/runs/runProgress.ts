import {
  needsManagedAttention,
  managedAttentionLabel,
} from '../executors/managedStatus';
import {
  readPath,
  type NodeExecution,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkRequest,
} from '@interlock/core';
import { detachedBoundary } from './runScope';

export type ProgressState =
  | 'queued'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type VisibleWork = Omit<WorkRequest, 'token'>;
export type ItemExecution = {
  run: Run;
  execution?: NodeExecution;
  state: ProgressState;
  index: number;
};
export type NodeProgress = {
  state: ProgressState;
  label: string;
  items: ItemExecution[];
  total?: number;
  finished?: number;
};
const latest = (run: Run, nodeId: string) =>
  run.executions.filter((execution) => execution.nodeId === nodeId).at(-1);
const labels: Record<ProgressState, string> = {
  queued: 'Queued',
  pending: 'Not started',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Presentation of persisted executions; never guesses an agent's internal progress. */
export function runProgress(
  run: Run,
  definition: WorkflowDefinition | null,
  descendants: Run[],
  work: VisibleWork[],
) {
  const runs = new Map([run, ...descendants].map((value) => [value.id, value]));
  const stateOf = (owner: Run, execution?: NodeExecution): ProgressState => {
    if (!execution)
      return owner.status === 'cancelled' ? 'cancelled' : 'pending';
    if (
      execution.resourceBlocked &&
      ['running', 'waiting'].includes(execution.status)
    )
      return 'waiting';
    if (execution.status !== 'waiting') return execution.status;
    if (execution.kind === 'agent')
      return work.some(
        (assignment) =>
          assignment.executionId === execution.id &&
          assignment.status === 'claimed' &&
          !needsManagedAttention(assignment),
      )
        ? 'running'
        : 'waiting';
    const states = execution.childRunIds.flatMap((id) => {
      const child = runs.get(id);
      return child && ['queued', 'running', 'waiting'].includes(child.status)
        ? [stateOf(child, child.executions.at(-1))]
        : [];
    });
    return states.includes('running') ? 'running' : 'waiting';
  };
  const aggregate = (states: ProgressState[]): ProgressState => {
    for (const state of [
      'running',
      'waiting',
      'failed',
      'cancelled',
      'pending',
    ] as const)
      if (states.includes(state)) return state;
    return states.length ? 'completed' : 'pending';
  };
  const counts = (states: ProgressState[]) =>
    (
      [
        'running',
        'waiting',
        'completed',
        'failed',
        'cancelled',
        'pending',
      ] as const
    )
      .flatMap((state) => {
        const count = states.filter((value) => value === state).length;
        return count
          ? [
              `${count} ${state === 'completed' ? 'finished' : state === 'pending' ? 'queued' : state}`,
            ]
          : [];
      })
      .join(' · ');
  const scopeCache = new Map<string, Run[]>();
  const scopes = (node: WorkflowNode): Run[] => {
    if (node.batchId === run.batchNodeId) return [run];
    if (!node.batchId) return [];
    if (scopeCache.has(node.batchId)) return scopeCache.get(node.batchId)!;
    const parent = definition?.nodes.find((value) => value.id === node.batchId);
    const owners = parent ? scopes(parent) : [];
    const children = owners.flatMap((owner) =>
      (latest(owner, node.batchId!)?.childRunIds ?? []).flatMap((id) => {
        const child = runs.get(id);
        return child && child.batchNodeId === node.batchId ? [child] : [];
      }),
    );
    scopeCache.set(node.batchId, children);
    return children;
  };
  const nodes: Record<string, NodeProgress> = {};
  for (const node of definition?.nodes ?? []) {
    const items = scopes(node).map((owner, index) => {
      const execution = latest(owner, node.id);
      return {
        run: owner,
        execution,
        state: stateOf(owner, execution),
        index: owner.batchItemIndex ?? index,
      };
    });
    const states = items.map((item) => item.state);
    const state = aggregate(states);
    let label = node.batchId ? counts(states) || 'Not started' : labels[state];
    let total: number | undefined, finished: number | undefined;
    if (node.kind === 'agent' && !node.batchId && state === 'running')
      label = 'Agent working';
    if (node.kind === 'agent' && state === 'waiting')
      label = node.batchId
        ? label
        : work.some(
              (assignment) =>
                assignment.executionId === items[0]?.execution?.id &&
                assignment.status === 'held',
            )
          ? 'Held for external blocker'
          : work.some(
                (w) =>
                  w.executionId === items[0]?.execution?.id &&
                  w.resourceBlocked,
              )
            ? 'Waiting for a resource'
            : 'Waiting for an agent';
    if (node.kind === 'agent' && !node.batchId) {
      const assignment = work.find(
        (w) => w.executionId === items[0]?.execution?.id,
      );
      if (assignment && needsManagedAttention(assignment))
        label = managedAttentionLabel(assignment);
      else if (
        assignment?.executor &&
        assignment.status === 'available' &&
        !assignment.resourceBlocked &&
        !assignment.budgetBlocked
      )
        label = 'Queued for automatic execution';
    }
    if (node.kind === 'wait' && state === 'waiting' && !node.batchId)
      label = 'Waiting for timer';
    if (node.kind === 'input' && state === 'waiting' && !node.batchId)
      label = 'Waiting for external input';
    if (
      node.kind === 'agent' &&
      state === 'completed' &&
      !node.batchId &&
      items[0]?.execution?.port === 'timeout'
    )
      label = 'Timed out';
    if (node.kind === 'batch' && items.some((item) => item.execution)) {
      const childStates: ProgressState[] = [];
      total = 0;
      let validInput = false;
      for (const item of items) {
        if (!item.execution) continue;
        let selected;
        try {
          selected = readPath(item.execution.input, node.itemsPath);
        } catch {
          continue;
        }
        if (!Array.isArray(selected)) continue;
        validInput = true;
        total += selected.length;
        for (const id of item.execution.childRunIds) {
          const child = runs.get(id);
          if (child)
            childStates.push(
              child.status === 'running' || child.status === 'waiting'
                ? stateOf(child, child.executions.at(-1))
                : child.status,
            );
        }
      }
      finished = childStates.filter((value) => value === 'completed').length;
      const queued = Math.max(0, total - childStates.length);
      // Unscheduled items remain unstarted after a failure/cancellation, not active work.
      const remainder = queued
        ? `${queued} ${state === 'failed' || state === 'cancelled' ? 'not started' : 'queued'}`
        : '';
      if (validInput)
        label = [
          `${finished} of ${total} finished`,
          counts(childStates.filter((value) => value !== 'completed')),
          remainder,
        ]
          .filter(Boolean)
          .join(' · ');
    }
    if (
      !node.batchId &&
      items[0]?.execution?.resourceBlocked &&
      state === 'waiting'
    )
      label = 'Waiting for a resource';
    nodes[node.id] = { state, label, items, total, finished };
  }
  const current = run.executions.at(-1);
  const currentProgress = current && nodes[current.nodeId];
  let title =
    run.status === 'queued'
      ? 'Queued'
      : run.status === 'completed'
        ? 'Completed'
        : run.status === 'failed'
          ? 'Failed'
          : run.status === 'cancelled'
            ? 'Cancelled'
            : currentProgress?.state === 'running'
              ? current?.kind === 'agent'
                ? 'Agent working'
                : 'Running'
              : 'Waiting';
  const activeAssignments = work.filter(
    (assignment) =>
      assignment.status === 'available' &&
      !detachedBoundary(assignment.runId, run.id, runs) &&
      ['queued', 'running', 'waiting'].includes(
        runs.get(assignment.runId)?.status ?? '',
      ),
  );
  if (title === 'Waiting' && activeAssignments.length)
    title = activeAssignments.some(
      (w) => !w.budgetBlocked && !w.resourceBlocked,
    )
      ? 'Waiting for an agent'
      : activeAssignments.some((w) => !w.budgetBlocked && w.resourceBlocked)
        ? 'Waiting for a resource'
        : 'Budget blocked';
  if (
    title === 'Waiting' &&
    work.some(
      (assignment) =>
        assignment.status === 'held' &&
        !detachedBoundary(assignment.runId, run.id, runs),
    )
  )
    title = 'Held for external blocker';
  if (title === 'Waiting' && current?.resourceBlocked)
    title = 'Waiting for a resource';
  const attention = work.find(
    (w) => needsManagedAttention(w) && !detachedBoundary(w.runId, run.id, runs),
  );
  if (attention && ['queued', 'running', 'waiting'].includes(run.status))
    title = managedAttentionLabel(attention);
  if (!['completed', 'cancelled'].includes(run.status) && current)
    title += ` · ${attention && ['queued', 'running', 'waiting'].includes(run.status) ? attention.label : current.label}`;
  return {
    nodes,
    runStates: Object.fromEntries(
      [...runs.values()].map((owner) => [
        owner.id,
        ['queued', 'running', 'waiting'].includes(owner.status)
          ? stateOf(owner, owner.executions.at(-1))
          : owner.status,
      ]),
    ),
    title,
    detail:
      run.status === 'failed'
        ? run.error?.split('\n', 1)[0]?.slice(0, 240)
        : current?.kind === 'batch'
          ? currentProgress?.label
          : current?.kind === 'wait' &&
              current.status === 'waiting' &&
              current.resumeAt
            ? `${current.nextCheckAt ? 'Checks again at' : 'Resumes at'} ${new Date(current.resumeAt).toLocaleString()}`
            : undefined,
  };
}
