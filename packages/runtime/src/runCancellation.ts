import {
  cancelRunTreeSchema,
  type CancelRunTree,
  type JoinCancel as Why,
  type Run,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { BackgroundScripts } from './backgroundScripts.js';
import { type Cb, now, terminal } from './engineHelpers.js';
import type { RunChains } from './runChains.js';
import type { RunInspection } from './runInspection.js';
import type { Usage } from './usage.js';
import type { WorkHolds } from './workHolds.js';
import type { WorkResources } from './workResources.js';

/**
 * Cancels runs: one run, its attached descendants, a selected run tree or a
 * continue-as-new chain, ending their work, reservations and local jobs.
 */
export class RunCancellation {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly pump: () => void,
    private readonly inspect: (
      id: string,
    ) => ReturnType<RunInspection['inspect']>,
    private readonly localJobs: Map<string, AbortController>,
    private readonly backgroundScripts: BackgroundScripts,
    private readonly resources: WorkResources,
    private readonly usage: Usage,
    private readonly holds: WorkHolds,
    private readonly chains: RunChains,
    private readonly inspection: RunInspection,
  ) {}
  /** Records why on each run and unfinished step; joins cancel in their transaction. */
  cancelTree(id: string, afterCommit?: Cb, why?: Why) {
    const run = this.run(id);
    if (terminal(run.status)) return;
    for (const child of this.store.runScopes.attachedChildIds(id))
      this.cancelTree(child, afterCommit, why);
    this.cancelOne(run, afterCommit, why?.reason, why);
  }
  cancelOne(run: Run, afterCommit?: Cb, reason?: string, why?: Why) {
    const id = run.id;
    run.status = 'cancelled';
    if (reason) run.cancellationReason = reason;
    if (why?.join) run.cancellationKind = 'join';
    const execution = run.executions.at(-1);
    if (execution?.resourceActive)
      this.resources.endExecution(run.id, execution, true);
    if (execution && this.localJobs.has(execution.id))
      this.resources.uncertainExecution(
        run.id,
        execution,
        'Cancelled request may still be running remotely',
      );
    const stop = () => {
      if (
        execution?.background &&
        ['launching', 'running'].includes(execution.background.state)
      ) {
        try {
          this.backgroundScripts.stop(run.id, execution.id);
        } catch {
          execution.background.state = 'uncertain';
          execution.error =
            'Background stop could not verify the supervisor. Inspect processes and reconcile stopped.';
          if (afterCommit) this.save(run);
        }
      }
      if (execution) this.localJobs.get(execution.id)?.abort();
    };
    // Atomic task replacement must commit cancellation and its receipt before
    // requesting external stops. A rolled-back start leaves the old job alone.
    if (afterCommit) afterCommit.push(stop);
    else stop();
    if (execution && !terminal(execution.status)) {
      execution.status = 'cancelled';
      if (why) execution.error = why.reason;
    }
    for (const work of this.store
      .work(undefined, id)
      .filter((w) => ['available', 'claimed', 'held'].includes(w.status))) {
      this.resources.end(work, 'cancelled');
      this.usage.ended(work, 'cancelled');
      this.holds.close(work, now(), reason ?? 'run cancellation', 'cancelled');
      work.status = 'cancelled';
      work.endedAt = now();
      work.token = undefined;
      this.store.put('work', work);
    }
    this.save(run);
    this.event(
      run,
      'run.cancelled',
      reason ? `Run cancelled: ${reason}` : 'Run cancelled',
    );
  }
  cancelRunTree(input: CancelRunTree) {
    const query = cancelRunTreeSchema.parse(input);
    const afterCommit: (() => void)[] = [];
    const result = this.store.transaction(() => {
      const selected = this.inspection.cancellationSelection(
        query.id,
        query.includeDetached,
      );
      const active = selected.filter((run) => !terminal(run.status));
      for (const member of selected) {
        const run = this.run(member.id);
        if (run.chain) this.chains.cancel(run);
        if (!terminal(run.status))
          this.cancelOne(run, afterCommit, query.reason);
      }
      return {
        rootRunId: query.id,
        includeDetached: query.includeDetached,
        reason: query.reason,
        cancelled: {
          items: active.slice(0, query.limit).map((run) =>
            this.inspection.cancellationReference({
              ...run,
              status: 'cancelled',
            }),
          ),
          total: active.length,
          truncated: active.length > query.limit,
        },
      };
    });
    // Never stop external work until all cancellation state and lifecycle receipts commit.
    for (const effect of afterCommit) effect();
    this.pump();
    return result;
  }
  cancel(id: string, scope: 'run' | 'chain' = 'run') {
    this.store.transaction(() =>
      this.cancelTree(
        scope === 'chain' ? this.chains.cancel(this.run(id)) : id,
      ),
    );
    this.pump();
    return this.inspect(id);
  }
}
