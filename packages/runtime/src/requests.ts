import {
  InterlockError,
  requestKey,
  runDisplayTitle,
  type ManagedExecution,
  type RequestList,
  type RequestSummary,
  type RequestTarget,
  type Run,
  type RunChain,
  type RunProjection,
  type StallRecord,
  type Workflow,
  type WorkRequest,
  describePolicyContent,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { ExternalInputs } from './externalInputs.js';
import { ScriptApprovals } from './scriptApprovals.js';
import { offlineLauncherWork } from './executors/pullLaunchers.js';

type Ancestor = ReturnType<Store['attentionAncestors']>[number];
type State =
  'open' | 'saved' | 'accepted' | 'cancelled' | 'superseded' | 'resolved';

function cardId(runs: Map<string, Ancestor>, runId: string) {
  let current = runs.get(runId);
  const seen = new Set<string>();
  while (
    current?.parentRunId &&
    current.parentMode !== 'detached' &&
    !seen.has(current.id)
  ) {
    seen.add(current.id);
    const parent = runs.get(current.parentRunId);
    if (!parent) break;
    current = parent;
  }
  return current?.chainRootRunId ?? current?.id ?? runId;
}

export class Requests {
  constructor(
    private store: Store,
    private inputs: ExternalInputs,
    private project: (runId: string) => RunProjection,
  ) {}

  current(): RequestSummary[] {
    const managed = this.store.attentionWork();
    const human = this.store.waitingHumanInputs();
    const stalls = this.store.currentStalls();
    const resources = this.store.uncertainResourceAttempts();
    const scripts = this.store.uncertainBackgroundSteps();
    const approvals = this.store.waitingScriptApprovals();
    const launchers = offlineLauncherWork(this.store);
    const runs = this.ancestors(
      [
        ...launchers,
        ...managed,
        ...human,
        ...stalls,
        ...resources,
        ...scripts,
        ...approvals,
      ].map((item) => item.runId),
    );
    const result: RequestSummary[] = [];
    const add = (
      target: RequestTarget,
      label: string,
      since: string,
      reason?: RequestSummary['reason'],
    ) => {
      if (runs.has(target.runId))
        result.push({
          cardId: cardId(runs, target.runId),
          target,
          label,
          since,
          ...(reason ? { reason } : {}),
        });
    };
    for (const { runId, executionId, since } of approvals)
      add(
        { kind: 'script', runId, executionId },
        'Approve imported Script',
        since,
        'approval',
      );
    for (const { runId, executionId, label, since } of human)
      add({ kind: 'human', runId, executionId }, label, since);
    const managedRecovery = new Set<string>();
    for (const work of managed) {
      const { runId, executionId, managedExecutionId } = work;
      const target = { runId, executionId, managedExecutionId };
      if (
        work.state === 'interrupted' ||
        (work.endedAt && !work.pending.length && work.state === 'needs_human')
      ) {
        managedRecovery.add(`${work.workId}:${work.attempt}`);
        add(
          { kind: 'recovery', ...target },
          'Reconcile interrupted session',
          work.endedAt ?? work.startedAt,
        );
      } else if (work.state === 'needs_model')
        add(
          { kind: 'model', ...target },
          'Select a replacement model',
          work.endedAt ?? work.startedAt,
        );
      else
        for (const request of work.pending)
          add(
            { kind: request.kind, ...target, requestId: request.id },
            request.label,
            request.since ?? work.startedAt,
          );
    }
    for (const { runId, executionId, workId, since } of launchers)
      add(
        { kind: 'launcher', runId, executionId, workId },
        'Launcher client offline',
        since,
      );
    const scriptRecovery = new Set(scripts.map((script) => script.executionId));
    for (const { runId, executionId, since } of scripts)
      add(
        { kind: 'script', runId, executionId },
        'Reconcile background Script',
        since,
      );
    for (const { runId, executionId, workId, attempt, since } of resources)
      if (
        !scriptRecovery.has(executionId) &&
        !managedRecovery.has(`${workId}:${attempt}`)
      )
        add(
          {
            kind: 'resource',
            runId,
            executionId,
            workId: workId ?? undefined,
            attempt,
          },
          'Confirm attempt stopped',
          since,
        );
    for (const stall of stalls)
      if (['running', 'waiting'].includes(runs.get(stall.runId)?.status ?? ''))
        add(
          {
            kind: 'stalled',
            runId: stall.runId,
            executionId: stall.executionId,
            stallId: stall.id,
          },
          'Investigate stalled work',
          stall.detectedAt,
        );
    return result.sort((a, b) => a.since.localeCompare(b.since));
  }

  byCard() {
    const groups = new Map<string, RequestSummary[]>();
    for (const request of this.current()) {
      const group = groups.get(request.cardId) ?? [];
      group.push(request);
      groups.set(request.cardId, group);
    }
    return groups;
  }

  list(query: RequestList) {
    const scopedCard = query.runId
      ? cardId(this.ancestors([query.runId]), query.runId)
      : undefined;
    const workflowIds = query.boardId
      ? new Set(
          this.store
            .workflows()
            .filter((workflow) => workflow.boardId === query.boardId)
            .map((workflow) => workflow.id),
        )
      : undefined;
    const current = this.current();
    const roots = workflowIds
      ? this.ancestors(current.map((request) => request.cardId))
      : undefined;
    const matches = current.filter(
      (request) =>
        (!scopedCard || scopedCard === request.cardId) &&
        (!workflowIds ||
          workflowIds.has(roots?.get(request.cardId)?.workflowId ?? '')),
    );
    return {
      items: matches.slice(query.offset, query.offset + query.limit),
      total: matches.length,
      nextOffset:
        query.offset + query.limit < matches.length
          ? query.offset + query.limit
          : null,
    };
  }

  get(target: RequestTarget) {
    const run = this.store.get<Run>('runs', target.runId);
    if (!run) throw new InterlockError('Request run not found');
    const execution = run.executions.find(
      (step) => step.id === target.executionId,
    );
    const id = cardId(this.ancestors([run.id]), run.id);
    const root = id === run.id ? run : (this.store.get<Run>('runs', id) ?? run);
    const card = {
      id,
      title: runDisplayTitle(root),
      workflowName: root.workflowName,
      externalTask: root.externalTask,
      boardId: this.store.get<Workflow>('workflows', root.workflowId)?.boardId,
    };
    const siblings = this.current().filter((request) => request.cardId === id);
    const active = siblings.some(
      (request) => requestKey(request.target) === requestKey(target),
    );
    const replacement =
      active || !execution
        ? undefined
        : siblings.find((request) => {
            if (request.target.kind !== target.kind) return false;
            const candidate =
              request.target.runId === run.id
                ? run
                : this.store.get<Run>('runs', request.target.runId);
            return (
              candidate &&
              this.sameRunPath(run, candidate) &&
              candidate.executions.some(
                (step) =>
                  step.id === request.target.executionId &&
                  step.nodeId === execution.nodeId,
              )
            );
          })?.target;
    const inactive: State = replacement ? 'superseded' : 'cancelled';
    const latestRunId = root.chain
      ? this.store.get<RunChain>('runChains', id)?.latestRunId
      : undefined;
    const base = {
      target,
      card,
      executionLabel: execution?.label ?? 'Request',
      replacement: active ? undefined : replacement,
      remainingBlocker:
        !active && siblings.length === 0
          ? this.project(latestRunId ?? root.id).waiting?.detail.message
          : undefined,
    };

    if (target.kind === 'human') {
      const capture = execution?.humanInput;
      if (!capture) throw new InterlockError('Human input request not found');
      const status = this.inputs.status({
        action: 'status',
        runId: run.id,
        executionId: execution.id,
        includeValue: true,
      });
      const { externalInput } = execution;
      const state: State = externalInput?.acceptedAt
        ? 'accepted'
        : active
          ? externalInput?.submittedAt
            ? 'saved'
            : 'open'
          : inactive;
      const heldByRunId = status.heldByRunId;
      const hold = heldByRunId
        ? this.store.get<Run>('runs', heldByRunId)?.externalInputHold
        : undefined;
      const holding =
        heldByRunId && hold
          ? { runId: heldByRunId, revision: hold.revision }
          : undefined;
      return {
        ...base,
        target,
        kind: target.kind,
        ...capture,
        state,
        status: {
          revision: externalInput?.revision ?? 0,
          submittedAt: externalInput?.submittedAt,
          acceptedAt: externalInput?.acceptedAt,
          heldByRunId,
          pauseCount: status.pauseCount,
        },
        holding,
        actions:
          state === 'open'
            ? ['answer']
            : state === 'saved' && holding
              ? ['release_hold']
              : state === 'saved' && !status.heldByRunId && !status.pauseCount
                ? ['accept']
                : [],
        value: externalInput?.acceptedAt
          ? (execution.result ?? execution.output)
          : 'value' in status
            ? status.value
            : undefined,
        source: externalInput?.source,
      };
    }
    if (target.kind === 'stalled') {
      const stall = this.store.get<StallRecord>('stalls', target.stallId);
      if (stall?.runId !== run.id || stall.executionId !== target.executionId)
        throw new InterlockError('Stall investigation not found');
      return {
        ...base,
        target,
        kind: target.kind,
        question: 'Investigate stalled work',
        state: (active ? 'open' : 'resolved') as State,
        stall,
        actions: [],
      };
    }
    if (target.kind === 'script' && execution && !execution.background) {
      const script = new ScriptApprovals(this.store).step(run, execution);
      if (!script?.record)
        throw new InterlockError('Script approval request not found');
      return {
        ...base,
        target,
        kind: 'scriptApproval' as const,
        ...(script.language === 'permission-policy'
          ? {
              question: 'Approve permission policy',
              context:
                'This policy came from an import or an agent. Once approved, managed Agent sessions in this workflow run the listed actions inside the run workspace without asking. Other actions still ask. Approval applies to this exact policy in this workflow.',
            }
          : {
              question: 'Approve imported Script',
              context:
                'This Script came from an imported workflow and runs as your user with your files and network access. Review the code before approving. Approval applies to this exact code in this workflow.',
            }),
        agentNote:
          'A person must approve this in the Interlock UI or CLI; agents cannot approve it.',
        state: (active
          ? 'open'
          : script.record.state === 'approved'
            ? 'accepted'
            : inactive) as State,
        script: {
          label: script.label,
          language: script.language ?? 'bash',
          // A policy reads as one allowed action per line, as in import review.
          command:
            script.language === 'permission-policy'
              ? describePolicyContent(script.command)
              : script.command,
        },
        actions: [],
      };
    }
    if (target.kind === 'launcher') {
      const work = this.store.get<WorkRequest>('work', target.workId);
      if (work?.runId !== run.id || work.executionId !== target.executionId)
        throw new InterlockError('Launcher assignment not found');
      return {
        ...base,
        target,
        kind: target.kind,
        state: (active ? 'open' : 'resolved') as State,
        question: 'Launcher client offline',
        context: `No launcher client for executor profile "${work.executor}" has polled recently (launcher_client_offline). The assignment stays unclaimed until the client polls again.`,
        actions: [],
      };
    }
    if (target.kind === 'resource' || target.kind === 'script') {
      const work =
        target.kind === 'resource' && target.workId
          ? this.store.get<WorkRequest>('work', target.workId)
          : undefined;
      if (
        !execution ||
        (target.kind === 'script' && !execution.background) ||
        (target.kind === 'resource' &&
          target.workId &&
          (work?.runId !== run.id || work.executionId !== execution.id))
      )
        throw new InterlockError('Recovery attempt not found');
      const state: State = active ? 'open' : 'resolved';
      return {
        ...base,
        target,
        kind: target.kind,
        state,
        question:
          target.kind === 'script'
            ? 'Reconcile background Script'
            : 'Confirm attempt stopped',
        context: execution.error,
        actions: active
          ? [
              target.kind === 'script'
                ? 'reconcile_script'
                : 'release_resources',
            ]
          : [],
      };
    }

    const record = this.store.get<ManagedExecution>(
      'managedExecutions',
      target.managedExecutionId,
    );
    const work = record && this.store.get<WorkRequest>('work', record.workId);
    if (
      !record ||
      !work ||
      work.runId !== run.id ||
      work.executionId !== target.executionId
    )
      throw new InterlockError('Managed request attempt not found');
    if (target.kind === 'permission' || target.kind === 'question') {
      const request = record.requests.find(
        (item) => item.id === target.requestId && item.kind === target.kind,
      );
      if (!request) throw new InterlockError('Managed request not found');
      const state: State =
        request.state === 'answered' ? 'accepted' : active ? 'open' : inactive;
      return {
        ...base,
        target,
        kind: target.kind,
        question: request.title,
        context: request.detail,
        state,
        request,
        actions: state === 'open' ? ['respond'] : [],
      };
    }
    const resolved =
      target.kind === 'model'
        ? record.modelRecovery?.replacementModel
        : record.reconciledAt;
    const state: State = active ? 'open' : resolved ? 'accepted' : inactive;
    return {
      ...base,
      target,
      kind: target.kind,
      question:
        target.kind === 'model'
          ? 'Select a replacement model'
          : 'Reconcile interrupted session',
      context: record.error,
      state,
      model: record.modelRecovery?.replacementModel,
      profileId: record.profile.id,
      actions:
        state === 'open'
          ? [target.kind === 'model' ? 'retry_model' : 'reconcile']
          : [],
    };
  }

  private ancestors(ids: string[]) {
    return new Map(
      this.store.attentionAncestors(new Set(ids)).map((run) => [run.id, run]),
    );
  }

  private sameRunPath(left: Run, right: Run) {
    if (left.id === right.id) return true;
    if (
      left.workflowId !== right.workflowId ||
      left.parentRunId !== right.parentRunId
    )
      return false;
    if (!left.parentRunId)
      return Boolean(
        left.chain && left.chain.rootRunId === right.chain?.rootRunId,
      );
    if (left.parallelBranch || right.parallelBranch)
      return (
        left.parallelBranch?.nodeId === right.parallelBranch?.nodeId &&
        left.parallelBranch?.id === right.parallelBranch?.id
      );
    if (left.batchNodeId || right.batchNodeId)
      return (
        left.batchNodeId === right.batchNodeId &&
        left.batchItemIndex === right.batchItemIndex
      );
    if (!left.parentExecutionId || !right.parentExecutionId) return false;
    const parent = this.store.get<Run>('runs', left.parentRunId);
    const caller = parent?.executions.find(
      (step) => step.id === left.parentExecutionId,
    );
    return Boolean(
      caller &&
      parent?.executions.some(
        (step) =>
          step.id === right.parentExecutionId && step.nodeId === caller.nodeId,
      ),
    );
  }
}
