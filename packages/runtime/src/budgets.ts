import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  evaluateBudget,
  setBudgetSchema,
  type BudgetPolicy,
  type BudgetRecord,
  type SetBudgetInput,
  type Run,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Usage } from './usage.js';

const collection = 'runBudgets';

export class Budgets {
  constructor(
    private store: Store,
    private usage: Usage,
    private notify: (runId: string, blocked: boolean) => void,
  ) {}

  private scope(id: string, policy: BudgetPolicy, runs: Run[]) {
    const anchor = runs.find((run) => run.id === id);
    // A rollover renews step history, never a budget allowance. Even a policy
    // installed on a later member counts the chain's retained earlier claims.
    const scope = new Set(
      anchor?.chain
        ? runs
            .filter((run) => run.chain?.rootRunId === anchor.chain!.rootRunId)
            .map((run) => run.id)
        : [id],
    );
    if (policy.scope === 'run') return scope;
    let changed = true;
    while (changed) {
      changed = false;
      for (const run of runs)
        if (
          run.parentRunId &&
          scope.has(run.parentRunId) &&
          !scope.has(run.id) &&
          (policy.scope === 'tree' || run.parentMode !== 'detached')
        ) {
          scope.add(run.id);
          changed = true;
        }
    }
    return scope;
  }
  private evaluations() {
    const records = this.store
      .list<BudgetRecord>(collection)
      .filter((record) => record.budget);
    if (!records.length) return [];
    const runs = this.store.runs();
    return records.map((record) => {
      const scope = this.scope(record.id, record.budget!, runs);
      return {
        record,
        scope,
        result: evaluateBudget(
          record.budget!,
          this.usage.attemptsForRuns(scope),
        ),
      };
    });
  }
  read(runId: string) {
    if (!this.store.get<Run>('runs', runId))
      throw new InterlockError('Run not found');
    const local = this.store.get<BudgetRecord>(collection, runId);
    return {
      runId,
      revision: local?.revision ?? 0,
      budget: local?.budget ?? null,
      governing: this.evaluations()
        .filter((evaluation) => evaluation.scope.has(runId))
        .map(({ record, scope, result }) => ({
          runId: record.id,
          revision: record.revision,
          budget: record.budget!,
          includedRuns: scope.size,
          ...result,
        })),
    };
  }
  set(input: SetBudgetInput) {
    const { runId, expectedRevision, budget } = setBudgetSchema.parse(input);
    return this.store.transaction(() => {
      const run = this.store.get<Run>('runs', runId);
      if (!run) throw new InterlockError('Run not found');
      const current = this.store.get<BudgetRecord>(collection, runId);
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new InterlockError(
          'Budget revision conflict; read the current budget before adjusting it',
        );
      this.store.put<BudgetRecord>(collection, {
        id: runId,
        revision: expectedRevision + 1,
        budget,
        updatedAt: new Date().toISOString(),
      });
      // Policy changes wake continuation readers even if admission does not change.
      run.budgetRevision = expectedRevision + 1;
      run.updatedAt = new Date().toISOString();
      this.store.put('runs', run);
      this.refresh();
      const result = this.read(runId);
      this.notify(
        runId,
        result.governing.some((gate) => gate.state === 'blocked'),
      );
      return result;
    });
  }
  assertClaim(runId: string) {
    const blocked = this.read(runId).governing.filter(
      (gate) => gate.state === 'blocked',
    );
    if (blocked.length)
      throw new InterlockError(
        `Budget blocked: inspect and adjust the budget for run ${blocked.map((gate) => gate.runId).join(', ')}. No claim was granted.`,
      );
  }
  refresh() {
    const evaluations = this.evaluations();
    for (const work of this.store.work()) {
      if (work.status !== 'available') continue;
      const runIds = evaluations
        .filter(
          ({ scope, result }) =>
            scope.has(work.runId) && result.state === 'blocked',
        )
        .map(({ record }) => record.id)
        .sort();
      if (runIds.length) {
        if (isDeepStrictEqual(work.budgetBlocked?.runIds, runIds)) continue;
        work.budgetBlocked = {
          runIds,
          since: work.budgetBlocked?.since ?? new Date().toISOString(),
          remainingMs:
            work.budgetBlocked?.remainingMs ??
            (work.availableUntil
              ? Math.max(0, Date.parse(work.availableUntil) - Date.now())
              : undefined),
        };
        work.availableUntil = undefined;
      } else {
        if (!work.budgetBlocked) continue;
        if (work.budgetBlocked.remainingMs !== undefined)
          work.availableUntil = new Date(
            Date.now() + work.budgetBlocked.remainingMs,
          ).toISOString();
        work.budgetBlocked = undefined;
      }
      this.store.put('work', work);
      this.notify(work.runId, runIds.length > 0);
    }
  }
  removeRuns(ids: Set<string>) {
    for (const id of ids) this.store.remove(collection, id);
  }
}
