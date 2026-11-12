import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  elapsedExcludingPausesMs,
  stallSettingsUpdateSchema,
  type ActiveClockHold,
  type StallPolicy,
  type StallKind,
  type StallRecord,
  type Run,
  type WorkRequest,
  type WorkHoldInterval,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

type ClockHold = ActiveClockHold & { source: string };
const iso = () => new Date().toISOString();
/** Observational policies and clocks; assignment ownership remains in Engine. */
export class Stalls {
  constructor(
    private store: Store,
    private emit: (run: Run, type: string, message: string) => void,
  ) {}
  settings() {
    return (
      this.store.get<{ id: string; revision: number; policy: StallPolicy }>(
        'stallSettings',
        'library',
      ) ?? { id: 'library', revision: 0, policy: {} }
    );
  }
  configure(input: unknown) {
    const q = stallSettingsUpdateSchema.parse(input);
    return this.store.transaction(() => {
      if (q.expectedRevision !== this.settings().revision)
        throw new InterlockError(
          'Stall settings changed; reload before saving',
        );
      const result = {
        id: 'library',
        revision: q.expectedRevision + 1,
        policy: q.policy,
      };
      this.store.put('stallSettings', result);
      return result;
    });
  }
  policy(
    definition: WorkflowDefinition,
    node: WorkflowNode,
    library = this.settings().policy,
  ): StallPolicy {
    const result: StallPolicy = { ...library };
    for (const level of [definition, node])
      for (const key of [
        'unclaimedStallMs',
        'claimedIdleStallMs',
        'humanWaitStallMs',
        'runStallMs',
        'idleRecovery',
      ] as const)
        if ((level as StallPolicy)[key] !== undefined)
          Object.assign(result, { [key]: (level as StallPolicy)[key] });
    return result;
  }
  hold(source: string, runId: string, held: boolean, workId?: string) {
    const current = this.store
      .forRuns<ClockHold>('activeClockHolds', new Set([runId]))
      .filter((h) => h.source === source && !h.releasedAt);
    if (held && !current.length)
      this.store.put('activeClockHolds', {
        id: randomUUID(),
        source,
        runId,
        workId,
        createdAt: iso(),
      });
    if (!held)
      for (const h of current)
        this.store.put('activeClockHolds', { ...h, releasedAt: iso() });
  }
  elapsed(
    run: Pick<Run, 'id' | 'parentRunId' | 'parentMode' | 'workflowId'>,
    since: string,
    workId?: string,
  ) {
    // Input acceptance holds inherit through ordinary ancestors; work holds are local.
    const ids = new Set([run.id]);
    let ancestor = run;
    while (
      ancestor.parentRunId &&
      ancestor.parentMode !== 'detached' &&
      !ids.has(ancestor.parentRunId)
    ) {
      ids.add(ancestor.parentRunId);
      const parent = this.store.currentRun(ancestor.parentRunId);
      if (!parent) break;
      ancestor = parent;
    }
    const holds = this.store
      .forRuns<ClockHold>('activeClockHolds', ids)
      .filter((h) => (h.workId ? h.workId === workId : true));
    const declared = this.store
      .forRuns<WorkHoldInterval>('workHolds', new Set([run.id]))
      .filter((h) => !workId || h.workId === workId)
      .map((h) => ({ ...h, createdAt: h.heldAt, releasedAt: h.endedAt }));
    return elapsedExcludingPausesMs(
      Date.parse(since),
      Date.now(),
      [
        ...this.store.pauseHolds(run.workflowId, true),
        ...holds,
        ...declared,
      ].map((h) => ({
        ...h,
        scope: 'library' as const,
        actor: '',
        reason: '',
      })),
    );
  }
  deadlineExpired(
    work: Pick<
      WorkRequest,
      'status' | 'runId' | 'id' | 'maxExecutionMs' | 'claimedAt'
    >,
  ) {
    if (work.status !== 'claimed' || !work.maxExecutionMs || !work.claimedAt)
      return false;
    const run = this.store.currentRun(work.runId);
    return (
      !!run &&
      this.elapsed(run, work.claimedAt, work.id).activeMs >= work.maxExecutionMs
    );
  }
  activity(workId: string, attempt: number, token: string | undefined) {
    const work = this.store.get<WorkRequest>('work', workId);
    if (
      !work ||
      work.status !== 'claimed' ||
      work.attempt !== attempt ||
      work.token !== token
    )
      return;
    work.lastActivityAt = iso();
    work.idleNudge = undefined;
    this.store.put('work', work);
  }
  inspect(runId: string, offset = 0, limit = 20) {
    const records = this.store
      .currentStalls(runId)
      .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    return {
      items: records.slice(offset, offset + limit),
      total: records.length,
      nextOffset: offset + limit < records.length ? offset + limit : null,
    };
  }
  tick() {
    const existing = this.store.currentStalls();
    const unresolved = new Set(existing.map((record) => record.id));
    const current = new Set<string>();
    const library = this.settings().policy;
    const definitions = new Map<string, WorkflowDefinition | undefined>();
    for (const { run, execution } of this.store.activeRunState()) {
      if (run.status === 'queued') continue;
      if (!execution || !['running', 'waiting'].includes(execution.status))
        continue;
      const key = JSON.stringify([run.workflowId, run.version]);
      if (!definitions.has(key))
        definitions.set(
          key,
          this.store.getVersion(run.workflowId, run.version)?.definition,
        );
      const definition = definitions.get(key);
      const node = definition?.nodes.find((n) => n.id === execution.nodeId);
      if (!definition || !node) continue;
      const policy = this.policy(definition, node, library);
      if (
        !policy.unclaimedStallMs &&
        !policy.claimedIdleStallMs &&
        !policy.humanWaitStallMs &&
        !policy.runStallMs
      )
        continue;
      const work = this.store.workForExecution(run.id, execution.id);
      const held =
        this.store.pauseHolds(run.workflowId).length > 0 ||
        work?.status === 'held' ||
        work?.managedExecution?.state === 'needs_human' ||
        !!this.store.externalInputHoldOwner(run.id);
      const candidate = (kind: StallKind, since: string) => {
        const thresholdMs = policy[kind];
        if (!thresholdMs) return;
        const key = `${execution.id}:${kind}:${work?.attempt ?? 0}:${since}`;
        const activeMs = this.elapsed(run, since, work?.id).activeMs;
        if (activeMs < thresholdMs) return;
        current.add(key);
        if (held || unresolved.has(key)) return;
        const record: StallRecord = {
          id: key,
          runId: run.id,
          executionId: execution.id,
          nodeId: node.id,
          ...(work ? { workId: work.id, attempt: work.attempt } : {}),
          kind,
          since,
          detectedAt: iso(),
          thresholdMs,
          activeMs,
        };
        this.store.put('stalls', record);
        const full = this.store.get<Run>('runs', run.id);
        if (full)
          this.emit(
            full,
            'stalled',
            `${node.label.slice(0, 200)}: ${kind} reached ${thresholdMs} active ms`,
          );
      };
      if (work?.status === 'available')
        candidate('unclaimedStallMs', work.availableSince ?? work.createdAt);
      if (work?.status === 'claimed')
        candidate(
          'claimedIdleStallMs',
          work.lastActivityAt ?? work.claimedAt ?? execution.startedAt,
        );
      if (node.kind === 'input')
        candidate('humanWaitStallMs', execution.startedAt);
      if (
        policy.runStallMs &&
        node.kind !== 'wait' &&
        !execution.childRunIds.some((id) => {
          const r = this.store.currentRun(id);
          return r && ['queued', 'running', 'waiting'].includes(r.status);
        })
      )
        candidate(
          'runStallMs',
          work?.lastActivityAt ??
            work?.availableSince ??
            execution.externalInput?.submittedAt ??
            execution.startedAt,
        );
    }
    for (const record of existing)
      if (!current.has(record.id)) {
        this.store.put('stalls', { ...record, resolvedAt: iso() });
        this.store.touchRun(record.runId);
      }
  }
}
