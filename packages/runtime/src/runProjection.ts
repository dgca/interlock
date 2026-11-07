import type { Run, RunProjection, RunWaiting } from '@interlock/core';
import type { Store } from '@interlock/storage';

const active = (status: string) => status === 'running' || status === 'waiting';
type Branch = {
  runId: string;
  nodeId: string;
  depth: number;
  at: string;
  stage?: string;
  actor: RunProjection['actor'];
  waiting: RunWaiting | null;
};
const order = (a: Branch, b: Branch) =>
  b.depth - a.depth ||
  b.at.localeCompare(a.at) ||
  a.runId.localeCompare(b.runId) ||
  a.nodeId.localeCompare(b.nodeId);

/** One read-only projection for all callers. Detached and inactive branches never roll up. */
export function projectRun(
  store: Store,
  id: string,
  state = store.continuation(id),
  override?: Run,
): RunProjection {
  const empty: RunProjection = { stage: null, waiting: null, actor: 'engine' };
  const runs = new Map(state.runs.map((r) => [r.id, r]));
  if (override) runs.set(override.id, { ...override, lifecycleRunId: id });
  const root = runs.get(id);
  if (!root || !active(root.status)) return empty;
  const branches: Branch[] = [],
    leaves: Branch[] = [];
  const seen = new Set<string>();
  const visit = (runId: string, depth: number) => {
    const run = runs.get(runId);
    if (!run || !active(run.status) || seen.has(runId)) return;
    seen.add(runId);
    const execution =
      override?.id === runId
        ? override.executions.at(-1)
        : state.executions.findLast((e) => e.runId === runId);
    const current =
      execution && active(execution.status) ? execution : undefined;
    const nodeId = current?.nodeId ?? run.cursor;
    const node = store
      .getVersion(run.workflowId, run.version)
      ?.definition.nodes.find((n) => n.id === nodeId);
    const work = state.work.find(
      (w) => w.runId === runId && w.executionId === current?.id,
    );
    const at = current?.startedAt ?? run.createdAt;
    const branch: Branch = {
      runId,
      nodeId,
      depth,
      at,
      stage: node?.stage,
      actor: 'engine',
      waiting: null,
    };
    const wait = (
      kind: RunWaiting['kind'],
      actor: Branch['actor'],
      message: string,
      since = at,
    ) => {
      branch.actor = actor;
      branch.waiting = {
        kind,
        since,
        detail: {
          runId,
          nodeId,
          ...(current ? { executionId: current.id } : {}),
          ...(work ? { workId: work.id } : {}),
          message: message.slice(0, 500),
        },
      };
    };
    const managed = work?.managedExecution;
    if (
      managed &&
      ['needs_human', 'needs_model', 'interrupted', 'blocked'].includes(
        managed.state,
      )
    )
      wait(
        'human_request',
        'person',
        managed.reason ?? 'Managed execution needs attention',
        work?.hold?.heldAt ?? at,
      );
    else if (work?.status === 'held')
      wait('hold', 'person', 'Assignment on hold', work.hold?.heldAt ?? at);
    else if (work?.budgetBlocked)
      wait(
        'budget',
        'person',
        'Claim blocked by run budget',
        work.budgetBlocked.since,
      );
    else if (work?.resourceBlocked)
      wait(
        'resource',
        work.resourceBlocked.owners.some((o) => o.state === 'uncertain')
          ? 'person'
          : 'engine',
        'Claim waiting for a shared resource',
        work.createdAt ?? at,
      );
    else if (work?.status === 'available')
      wait(
        work.executor ? 'managed_launch' : 'claim_queue',
        work.executor ? 'engine' : 'agent',
        managed?.reason ??
          (work.executor
            ? 'Waiting for managed launch'
            : 'Waiting for an agent'),
        work.createdAt ?? at,
      );
    else if (work?.status === 'claimed')
      branch.actor = work.executor ? 'engine' : 'agent';
    else if (current?.kind === 'input') {
      const held = store.externalInputHoldOwner(runId);
      wait(
        held ? 'hold' : 'input_node',
        held ? 'person' : 'agent',
        held
          ? 'External input acceptance on hold'
          : current.externalInput?.submittedAt
            ? 'Waiting for external input acceptance'
            : 'Waiting for external input',
      );
    } else if (current?.kind === 'wait') {
      wait(
        current.nextCheckAt ||
          (node?.kind === 'wait' && node.timing.kind === 'poll')
          ? 'poll'
          : 'timer',
        'engine',
        current.nextCheckAt ? 'Waiting for polling check' : 'Waiting for timer',
      );
      const detail = branch.waiting!.detail;
      if (current.resumeAt) detail.resumeAt = current.resumeAt;
      if (current.nextCheckAt) detail.nextCheckAt = current.nextCheckAt;
      if (current.timeoutAt) detail.timeoutAt = current.timeoutAt;
      if (current.check) {
        const summary =
          'checkSummary' in current ? current.checkSummary : undefined;
        const output =
          'output' in current.check
            ? JSON.stringify(current.check.output)
            : undefined;
        detail.lastCheck = {
          count: current.check.count,
          at: current.check.at,
          ...(summary
            ? { output: summary.output.slice(0, 512) }
            : output === undefined
              ? {}
              : { output: output.slice(0, 512) }),
          truncated: Boolean(
            summary?.truncated ||
            (summary && summary.output.length > 512) ||
            (output && output.length > 512),
          ),
          ...(current.check.error
            ? { error: current.check.error.slice(0, 500) }
            : {}),
        };
      }
    }
    branches.push(branch);
    const children =
      current?.childRunIds.filter((childId) => {
        const child = runs.get(childId);
        return child && active(child.status) && child.parentMode !== 'detached';
      }) ?? [];
    if (children.length) children.forEach((child) => visit(child, depth + 1));
    else leaves.push(branch);
  };
  visit(id, 0);
  const stage = branches.filter((b) => b.stage).sort(order)[0]?.stage ?? null;
  const rank = { agent: 0, engine: 1, person: 2 };
  const selected = leaves.sort(
    (a, b) => rank[a.actor] - rank[b.actor] || order(a, b),
  )[0];
  return {
    stage,
    waiting: selected?.waiting ?? null,
    actor: selected?.actor ?? 'engine',
  };
}
