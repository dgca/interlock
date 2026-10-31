import { randomUUID } from 'node:crypto';
import { fingerprint } from './versionIdentity.js';
import {
  InterlockError,
  readPath,
  type Run,
  type NodeExecution,
  type RunAncestry,
} from '@interlock/core';
import {
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  mutationSummarySchema,
} from '@interlock/core';
import type {
  BriefingQuery,
  WaitQuery,
  ResultQuery,
} from '../../core/src/continuation.js';
import type { Store } from '@interlock/storage';

const counts = (statuses: string[]) =>
  Object.fromEntries(
    ['running', 'waiting', 'completed', 'failed', 'cancelled'].map((status) => [
      status,
      statuses.filter((s) => s === status).length,
    ]),
  );
const bounded = <T>(items: T[], limit: number) => ({
  items: items.slice(0, limit),
  total: items.length,
  truncated: items.length > limit,
});

/** Read-only continuation protocol. Sequencing and timers remain with Engine. */
export class Continuation {
  private incarnation = randomUUID();
  private stopped = new AbortController();
  constructor(private store: Store) {}
  stop() {
    this.stopped.abort(
      new InterlockError('Engine stopped; reconnect for a new snapshot'),
    );
  }

  summary(id: string, limit: number) {
    const snapshot = this.briefing({ id, limit });
    return mutationSummarySchema.parse({
      ok: true,
      runId: snapshot.run.id,
      runStatus: snapshot.run.status,
      cursor: snapshot.cursor,
      nextWork: snapshot.available,
      next: snapshot.next,
      ...(snapshot.run.chain ? { chain: snapshot.run.chain } : {}),
      nextDeadline: snapshot.nextDeadline,
      ...(snapshot.held.total ? { heldWork: snapshot.held } : {}),
      ...(snapshot.budgetBlocked.total
        ? { budgetBlocked: snapshot.budgetBlocked }
        : {}),
    });
  }

  briefing(query: BriefingQuery) {
    const { id, limit } = briefingQuerySchema.parse(query);
    const state = this.store.continuation(id);
    const requested = state.runs.find((run) => run.id === id);
    if (!requested) throw new InterlockError('Run not found');
    const byId = new Map(state.runs.map((run) => [run.id, run]));
    const ancestry = new Map<string, RunAncestry>();
    const root = this.store.runAncestry(id, ancestry);
    const reference = (runId: string, executionId?: string) => ({
      runId,
      ...(executionId ? { executionId } : {}),
    });
    const latest = new Map<string, (typeof state.executions)[number]>();
    for (const execution of state.executions)
      latest.set(execution.runId, execution);
    const scoped = state.runs.filter((run) => run.lifecycleRunId === id);
    const independent = state.runs.filter((run) => run.lifecycleRunId !== id);
    const work = state.work.map((work) => ({
      id: work.id,
      ...reference(work.runId, work.executionId),
      ...this.store.runAncestry(work.runId, ancestry),
      lifecycleRunId: byId.get(work.runId)!.lifecycleRunId,
      nodeId: work.nodeId,
      label: work.label,
      status: work.status,
      context: work.context,
      ...(work.continuity ? { continuity: work.continuity } : {}),
      attempt: work.attempt,
      maxAttempts: work.maxAttempts,
      maxLeaseExpiries: work.maxLeaseExpiries,
      failureCount: work.failureCount,
      leaseExpiryCount: work.leaseExpiryCount,
      workerId: work.workerId,
      leaseSeconds: work.leaseSeconds,
      leaseUntil: work.leaseUntil,
      availableUntil: work.availableUntil,
      budgetBlocked: work.budgetBlocked,
      ...(work.holdRevision ? { holdRevision: work.holdRevision } : {}),
      ...(work.heldClaimCount ? { heldClaimCount: work.heldClaimCount } : {}),
      ...(work.hold
        ? {
            hold: {
              revision: work.hold.revision,
              category: work.hold.category,
              heldAt: work.hold.heldAt,
            },
          }
        : {}),
    }));
    const deadlines = [
      ...state.executions
        .filter((e) => e.kind === 'wait' && e.status === 'waiting')
        .flatMap((e) => {
          const deadlines: {
            runId: string;
            executionId?: string;
            kind: 'wait' | 'poll_check' | 'poll_timeout';
            at: string;
          }[] = [];
          if (e.nextCheckAt)
            deadlines.push({
              ...reference(e.runId, e.id),
              kind: 'poll_check',
              at: e.nextCheckAt,
            });
          else if (e.resumeAt)
            deadlines.push({
              ...reference(e.runId, e.id),
              kind: 'wait',
              at: e.resumeAt,
            });
          if (e.timeoutAt)
            deadlines.push({
              ...reference(e.runId, e.id),
              kind: 'poll_timeout',
              at: e.timeoutAt,
            });
          return deadlines;
        }),
      ...work
        .filter((w) => w.availableUntil || w.leaseUntil)
        .map((w) => ({
          ...reference(w.runId, w.executionId),
          workId: w.id,
          kind:
            w.status === 'claimed'
              ? ('claim_lease' as const)
              : ('unclaimed' as const),
          at: (w.leaseUntil ?? w.availableUntil)!,
        })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const blockers = state.runs
      .filter((run) => ['running', 'waiting', 'failed'].includes(run.status))
      .map((run) => {
        const execution = latest.get(run.id);
        const assignment = work.find((w) => w.runId === run.id);
        const reason =
          run.status === 'failed'
            ? 'failure'
            : assignment?.status === 'held'
              ? 'external_hold'
              : assignment?.status === 'claimed'
                ? 'claimed_work'
                : assignment?.budgetBlocked
                  ? 'budget_blocked'
                  : assignment
                    ? 'available_work'
                    : execution?.kind === 'wait'
                      ? 'wait'
                      : execution?.kind === 'batch' ||
                          execution?.kind === 'workflow'
                        ? 'children'
                        : 'executing';
        return {
          ...reference(run.id, execution?.id),
          lifecycleRunId: run.lifecycleRunId,
          reason,
          workId: assignment?.id,
          ...(assignment?.hold ? { hold: assignment.hold } : {}),
          ...(assignment?.budgetBlocked
            ? { budgetRunIds: assignment.budgetBlocked.runIds }
            : {}),
          error: run.error,
          resumeAt: execution?.resumeAt,
          nextCheckAt: execution?.nextCheckAt,
          timeoutAt: execution?.timeoutAt,
          check: execution?.check,
        };
      });
    const batches = state.executions
      .filter((e) => e.kind === 'batch')
      .map((e) => {
        const run = byId.get(e.runId)!;
        const definition = this.store.getVersion(
          run.workflowId,
          run.version,
        )?.definition;
        const node = definition?.nodes.find((n) => n.id === e.nodeId);
        const total =
          node?.kind === 'batch'
            ? this.store.batchSize(run.id, e.id, node.itemsPath)
            : null;
        const children = e.childRunIds
          .map((child) => byId.get(child))
          .filter((child) => child !== undefined);
        return {
          ...reference(run.id, e.id),
          nodeId: e.nodeId,
          status: e.status,
          total,
          dispatched: children.length,
          queued: total === null ? null : Math.max(0, total - e.nextItem),
          definitionAvailable: Boolean(definition),
          progress: counts(children.map((child) => child.status)),
        };
      });
    const summaries = state.runs.map((run) => ({
      ...run,
      definitionAvailable: Boolean(
        this.store.getVersion(run.workflowId, run.version),
      ),
      rootRunId: root.rootRunId,
      rootWorkflowId: root.rootWorkflowId,
      result: reference(run.id),
      currentExecution: latest.get(run.id)?.id,
    }));
    const results = state.executions
      .filter((e) => e.status === 'completed')
      .reverse()
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .map((e) => ({
        ...reference(e.runId, e.id),
        nodeId: e.nodeId,
        label: e.label,
        kind: e.kind,
        port: e.port,
        completedAt: e.completedAt,
        hasOutput: Boolean(e.hasOutput),
      }));
    return {
      run: summaries.find((run) => run.id === id)!,
      cursor: Buffer.from(
        JSON.stringify({
          v: 1,
          incarnation: this.incarnation,
          id,
          revision: state.revision,
        }),
      ).toString('base64url'),
      revision: state.revision,
      progress: {
        requested: counts(scoped.map((run) => run.status)),
        independent: counts(independent.map((run) => run.status)),
        executions: counts(
          state.executions
            .filter((e) => byId.get(e.runId)!.lifecycleRunId === id)
            .map((e) => e.status),
        ),
      },
      descendants: bounded(
        summaries.filter((run) => run.id !== id),
        limit,
      ),
      detached: bounded(
        summaries.filter((run) => run.parentMode === 'detached'),
        limit,
      ),
      available: bounded(
        work.filter((w) => w.status === 'available' && !w.budgetBlocked),
        limit,
      ),
      budgetBlocked: bounded(
        work
          .filter((w) => w.status === 'available' && w.budgetBlocked)
          .map((w) => ({
            workId: w.id,
            runId: w.runId,
            budgetRunIds: w.budgetBlocked!.runIds,
          })),
        limit,
      ),
      held: bounded(
        work
          .filter((w) => w.status === 'held')
          .map((w) => ({
            workId: w.id,
            runId: w.runId,
            lifecycleRunId: w.lifecycleRunId,
            attempt: w.attempt,
            holdRevision: w.holdRevision!,
            category: w.hold!.category,
            heldAt: w.hold!.heldAt,
          })),
        limit,
      ),
      claimed: bounded(
        work.filter((w) => w.status === 'claimed'),
        limit,
      ),
      blockers: bounded(blockers, limit),
      failures: bounded(
        state.runs
          .filter((run) => run.status === 'failed')
          .map((run) => ({
            ...reference(run.id, latest.get(run.id)?.id),
            error: run.error,
            lifecycleRunId: run.lifecycleRunId,
          })),
        limit,
      ),
      batches: bounded(batches, limit),
      deadlines: bounded(deadlines, limit),
      nextDeadline: deadlines[0] ?? null,
      recentResults: bounded(results, limit),
      next: requested.chain?.nextRunId
        ? 'continue_as_new'
        : requested.status === 'failed'
          ? 'inspect_failure'
          : work.some((w) => w.status === 'available' && !w.budgetBlocked)
            ? 'claim_work'
            : work.some((w) => w.status === 'available' && w.budgetBlocked)
              ? 'adjust_budget'
              : work.some((w) => w.status === 'claimed')
                ? 'wait_for_worker'
                : work.some((w) => w.status === 'held')
                  ? 'inspect_hold'
                  : ['completed', 'cancelled'].includes(requested.status)
                    ? 'inspect_result'
                    : 'wait_for_change',
    };
  }

  wait(query: WaitQuery, signal?: AbortSignal) {
    const parsed = waitQuerySchema.parse(query);
    const combined = signal
      ? AbortSignal.any([signal, this.stopped.signal])
      : this.stopped.signal;
    return new Promise<
      ReturnType<Continuation['briefing']> & {
        changed: boolean;
        timedOut: boolean;
        reset: boolean;
      }
    >((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      let settled = false;
      const cleanup = () => {
        settled = true;
        unsubscribe();
        if (timer) clearTimeout(timer);
        combined.removeEventListener('abort', abort);
      };
      const abort = () => {
        if (settled) return;
        cleanup();
        reject(combined.reason);
      };
      const check = (timedOut = false) => {
        if (settled) return;
        try {
          const snapshot = this.briefing(parsed);
          let reset = true;
          try {
            const cursor = JSON.parse(
              Buffer.from(parsed.cursor, 'base64url').toString(),
            );
            reset =
              cursor.v !== 1 ||
              cursor.incarnation !== this.incarnation ||
              cursor.id !== parsed.id ||
              !Number.isSafeInteger(cursor.revision) ||
              cursor.revision < 0 ||
              cursor.revision > snapshot.revision;
          } catch {
            /* Recover with a snapshot. */
          }
          const changed = reset || snapshot.cursor !== parsed.cursor;
          if (changed || timedOut) {
            cleanup();
            resolve({
              ...snapshot,
              changed,
              timedOut: timedOut && !changed,
              reset,
            });
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      // Subscribe first. Writes commit synchronously; their notifications run after the operation.
      unsubscribe = this.store.subscribe(() => check());
      combined.addEventListener('abort', abort, { once: true });
      if (combined.aborted) return abort();
      check(parsed.timeoutMs === 0);
      if (!settled) timer = setTimeout(() => check(true), parsed.timeoutMs);
    });
  }

  result(query: ResultQuery) {
    const parsed = resultQuerySchema.parse(query);
    const run = this.store.get<Run>('runs', parsed.id);
    if (!run) throw new InterlockError('Run not found');
    const source: Run | NodeExecution | undefined = parsed.executionId
      ? run.executions.find((e) => e.id === parsed.executionId)
      : run;
    if (!source)
      throw new InterlockError('Execution not found in requested run');
    if (parsed.field === 'result' && !parsed.executionId)
      throw new InterlockError('Raw result requires executionId');
    const field =
      parsed.field === 'result' && !Object.hasOwn(source, 'result')
        ? 'output'
        : parsed.field;
    const selected =
      field === 'result' ? (source as NodeExecution).result : source[field];
    if (selected === undefined)
      throw new InterlockError('Requested result is not available');
    const value = readPath(selected, parsed.path);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > parsed.maxBytes)
      throw new InterlockError(
        `Selected result is ${bytes} bytes; limit is ${parsed.maxBytes}. Select a narrower path.`,
      );
    return {
      runId: parsed.id,
      executionId: parsed.executionId,
      field: parsed.field,
      path: parsed.path,
      bytes,
      value,
      ...(parsed.includeHash ? { sha256: fingerprint(value) } : {}),
    };
  }
}
