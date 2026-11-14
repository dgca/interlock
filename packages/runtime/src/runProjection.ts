import {
  budgetWaitMessage,
  type Run,
  type RunProjection,
  type RunWaiting,
} from '@interlock/core';
import type { ProjectionState, Store } from '@interlock/storage';
import { approvalSubject, waitingApprovalContent } from './scriptApprovals.js';

const active = (status: string) =>
  status === 'queued' || status === 'running' || status === 'waiting';
type Branch = {
  runId: string;
  nodeId: string;
  depth: number;
  at: string;
  stage?: string;
  actor: RunProjection['actor'];
  waiting: RunWaiting | null;
  working: boolean;
};
const order = (a: Branch, b: Branch) =>
  b.depth - a.depth ||
  b.at.localeCompare(a.at) ||
  a.runId.localeCompare(b.runId) ||
  a.nodeId.localeCompare(b.nodeId);

/** One read-only projection for all callers. Detached and inactive branches never roll up. */
export function createRunProjector(
  store: Store,
  state: ProjectionState,
  override?: Run,
): (id: string) => RunProjection {
  const runs = new Map(state.runs.map((r) => [r.id, r]));
  if (override) runs.set(override.id, override);
  const executions = new Map(state.executions.map((e) => [e.runId, e]));
  const workByRun = new Map<string, ProjectionState['work'][number]>();
  for (const work of state.work)
    if (
      !workByRun.has(work.runId) &&
      executions.get(work.runId)?.id === work.executionId
    )
      workByRun.set(work.runId, work);
  const versions = new Map<string, ReturnType<Store['getVersion']>>();
  const holds = new Map<string, ReturnType<Store['pauseHolds']>>();
  return (id) => {
    const empty: RunProjection = {
      stage: null,
      waiting: null,
      actor: 'engine',
    };
    const root = runs.get(id);
    if (!root) return empty;
    if (root.status === 'queued')
      return {
        stage: null,
        actor: 'engine',
        waiting: {
          kind: 'admission_queue',
          since: root.admission?.queuedAt ?? root.createdAt,
          detail: {
            runId: root.id,
            nodeId: root.cursor,
            position: root.admission?.position ?? 1,
            priority: root.admission?.priority ?? 0,
            blockers: root.admission?.blockers ?? [],
            message:
              `Queue position ${root.admission?.position ?? 1}${root.admission?.blockers.length ? ': ' + root.admission.blockers.join('; ') : ''}`.slice(
                0,
                500,
              ),
          },
        },
      };
    if (!active(root.status)) return empty;
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
          : executions.get(runId);
      const current =
        execution && active(execution.status) ? execution : undefined;
      const nodeId = current?.nodeId ?? run.cursor;
      const versionKey = JSON.stringify([run.workflowId, run.version]);
      if (!versions.has(versionKey))
        versions.set(versionKey, store.getVersion(run.workflowId, run.version));
      const node = versions
        .get(versionKey)
        ?.definition.nodes.find((n) => n.id === nodeId);
      const assignment = workByRun.get(runId);
      const work =
        assignment?.executionId === current?.id ? assignment : undefined;
      const at = current?.startedAt ?? run.createdAt;
      const branch: Branch = {
        runId,
        nodeId,
        depth,
        at,
        stage: node?.stage,
        actor: 'engine',
        waiting: null,
        working: false,
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
      let pauses = holds.get(run.workflowId);
      if (!pauses) {
        pauses = store.pauseHolds(run.workflowId);
        holds.set(run.workflowId, pauses);
      }
      const pollCheckRunning =
        current?.kind === 'wait' &&
        executions.get(runId)?.id === current.id &&
        executions.get(runId)?.pollCheckRunning;
      const inFlight =
        pollCheckRunning ||
        work?.status === 'claimed' ||
        ((current?.kind === 'script' || current?.kind === 'fetch') &&
          current.status === 'running');
      if (run.status === 'queued') {
        wait(
          'admission_queue',
          'engine',
          `Queue position ${run.admission?.position ?? 1}: ${run.admission?.blockers.join('; ') ?? ''}`,
          run.admission?.queuedAt ?? at,
        );
        branch.stage = undefined;
        branch.waiting!.detail.position = run.admission?.position ?? 1;
        branch.waiting!.detail.priority = run.admission?.priority ?? 0;
        branch.waiting!.detail.blockers = run.admission?.blockers ?? [];
      } else if (pauses.length && !inFlight) {
        wait(
          'pause',
          'person',
          `${pauses.length} pause hold${pauses.length === 1 ? '' : 's'}: ${pauses.map((h) => h.reason).join('; ')}`,
          pauses[0].createdAt,
        );
        branch.waiting!.detail.pauseCount = pauses.length;
      } else if (work?.cwdBlocked)
        wait(
          'human_request',
          'person',
          work.cwdBlocked.reason,
          work.createdAt ?? at,
        );
      else if (
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
          budgetWaitMessage(work.budgetBlocked, work.attempt),
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
      else if (current?.resourceBlocked)
        wait(
          'resource',
          current.resourceBlocked.owners.some((o) => o.state === 'uncertain')
            ? 'person'
            : 'engine',
          'Step waiting for a shared resource',
          current.resourceBlocked.since ?? at,
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
      else if (current?.scriptApproval)
        wait(
          'human_request',
          'person',
          `Waiting for ${approvalSubject(waitingApprovalContent(versions.get(versionKey)?.definition, current))} approval`,
          current.scriptApproval.since,
        );
      else if (current?.kind === 'input') {
        const held = store.externalInputHold(runId);
        wait(
          held ? 'hold' : current.humanInput ? 'human_request' : 'input_node',
          held || current.humanInput ? 'person' : 'agent',
          held
            ? 'External input acceptance on hold'
            : current.externalInput?.submittedAt
              ? 'Waiting for external input acceptance'
              : current.humanInput
                ? 'Waiting for a human answer'
                : 'Waiting for external input',
          held?.heldAt ?? at,
        );
      } else if (current?.kind === 'wait') {
        wait(
          current.nextCheckAt ||
            (node?.kind === 'wait' && node.timing.kind === 'poll')
            ? 'poll'
            : 'timer',
          'engine',
          pollCheckRunning
            ? 'Polling check running'
            : current.nextCheckAt
              ? 'Waiting for polling check'
              : 'Waiting for timer',
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
      branch.working = inFlight && branch.waiting === null;
      branches.push(branch);
      const children =
        current?.childRunIds.filter((childId) => {
          const child = runs.get(childId);
          return (
            child && active(child.status) && child.parentMode !== 'detached'
          );
        }) ?? [];
      if (children.length) children.forEach((child) => visit(child, depth + 1));
      else leaves.push(branch);
    };
    visit(id, 0);
    const stage = branches.filter((b) => b.stage).sort(order)[0]?.stage ?? null;
    const rank = { agent: 0, engine: 1, person: 2 };
    const selected = leaves.sort(
      (a, b) =>
        Number(b.working) - Number(a.working) ||
        rank[a.actor] - rank[b.actor] ||
        order(a, b),
    )[0];
    return {
      stage,
      waiting: selected?.waiting ?? null,
      actor: selected?.actor ?? 'engine',
    };
  };
}
