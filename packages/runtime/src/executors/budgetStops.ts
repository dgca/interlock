import {
  budgetWaitMessage,
  modelKey,
  tokenFields,
  type ManagedExecution,
  type ModelUsage,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import {
  attemptsCollection,
  now,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';

/** Unknown resumed history stays unknown rather than charging an old session twice. */
export function usageDelta(
  current: ModelUsage[],
  before: ModelUsage[] | null,
): ModelUsage[] | undefined {
  if (!before) return;
  return current.map((value) => {
    // A streamed baseline may name another provider for the same model.
    const prior =
      before.find(
        (v) => v.provider === value.provider && v.model === value.model,
      ) ?? before.find((v) => v.model === value.model);
    const result: ModelUsage = { provider: value.provider, model: value.model };
    for (const field of tokenFields)
      if (
        value[field] !== undefined &&
        (!prior || prior[field] !== undefined) &&
        value[field] >= (prior?.[field] ?? 0)
      )
        result[field] = value[field] - (prior?.[field] ?? 0);
    if (
      value.cost &&
      (!prior ||
        (prior.cost?.source === value.cost.source &&
          prior.cost.currency === value.cost.currency)) &&
      value.cost.amountMicros >= (prior?.cost?.amountMicros ?? 0)
    )
      result.cost = {
        ...value.cost,
        amountMicros:
          value.cost.amountMicros - (prior?.cost?.amountMicros ?? 0),
      };
    return result;
  });
}

/** Add attempt usage of finished turns to the current turn's; gaps stay unknown. */
function addUsage(earlier: ModelUsage[], turn: ModelUsage[]) {
  const sum = new Map(earlier.map((model) => [modelKey(model), model]));
  for (const model of turn) {
    const prior = sum.get(modelKey(model));
    if (!prior) {
      sum.set(modelKey(model), model);
      continue;
    }
    const total: ModelUsage = { provider: model.provider, model: model.model };
    for (const field of tokenFields)
      if (prior[field] !== undefined && model[field] !== undefined)
        total[field] = prior[field] + model[field];
    if (
      prior.cost &&
      model.cost &&
      prior.cost.currency === model.cost.currency &&
      prior.cost.source === model.cost.source
    )
      total.cost = {
        ...model.cost,
        amountMicros: prior.cost.amountMicros + model.cost.amountMicros,
      };
    sum.set(modelKey(model), total);
  }
  return [...sum.values()];
}

/**
 * Accumulates the 'assistant' message usage Claude Code streams. Each API
 * response can arrive as several messages with the same id, so the latest
 * figures per id replace earlier ones. The provider is not streamed; figures
 * are attributed to anthropic until the final result replaces them.
 */
export function anthropicStreamUsage() {
  const responses = new Map<string, ModelUsage>();
  return (message: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number | null;
      output_tokens?: number | null;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    } | null;
  }): ModelUsage[] | undefined => {
    const u = message.usage;
    if (!message.id || !message.model || !u) return;
    const cached = u.cache_read_input_tokens ?? 0,
      written = u.cache_creation_input_tokens ?? 0;
    if (
      !Number.isSafeInteger(u.input_tokens) ||
      !Number.isSafeInteger(u.output_tokens)
    )
      return;
    responses.set(message.id, {
      provider: 'anthropic',
      model: message.model,
      inputTokens: u.input_tokens! + cached + written,
      outputTokens: u.output_tokens!,
      cachedInputTokens: cached,
      cacheWriteInputTokens: written,
    });
    return [...responses.values()].reduce<ModelUsage[]>(
      (sum, model) => addUsage(sum, [model]),
      [],
    );
  };
}

/**
 * One managed attempt's streamed usage. Live figures stay in memory, where
 * budget checks read them, and are persisted only when the attempt ends
 * without a final report while a budget governs its run.
 */
export class AttemptBudget {
  private halt = new AbortController();
  private earlier: ModelUsage[] = [];
  private current?: ModelUsage[];
  /** Latest native session totals, from a harness that streams those. */
  sessionTotals?: ModelUsage[];
  reason?: string;
  private settled = false;
  constructor(
    private stops: BudgetStops,
    readonly work: WorkRequest,
    private baseline: ModelUsage[] | null,
    private job: AbortSignal,
  ) {}
  get id() {
    return `${this.work.id}:${this.work.attempt}`;
  }
  get stopped() {
    return this.halt.signal.aborted;
  }
  /** Start a native turn; returns the signal that also carries a budget stop. */
  turn() {
    this.earlier = this.current ?? [];
    return AbortSignal.any([this.job, this.halt.signal]);
  }
  /** Cumulative figures for the turn ('attempt') or the native session. */
  observe = (models: ModelUsage[], scope?: 'attempt') => {
    if (this.settled || !models.length) return;
    if (scope === 'attempt') this.current = addUsage(this.earlier, models);
    else {
      this.sessionTotals = models;
      const delta = usageDelta(models, this.baseline);
      if (!delta) return; // Unknown resumed history: no attributable figures.
      this.current = delta;
    }
    this.stops.live.set(this.id, {
      sequence: 1,
      final: false,
      models: this.current,
    });
    const reason = !this.stopped && this.stops.limitReached(this.work.runId);
    if (reason) {
      this.reason = reason;
      this.halt.abort(new Error(reason));
    }
  };
  /**
   * The native session's usage after a stop, as the next attempt's baseline:
   * the streamed session totals, or the prior baseline plus this attempt's
   * streamed figures. Unknown when neither is known.
   */
  sessionBaseline(): ModelUsage[] | null {
    if (this.sessionTotals) return this.sessionTotals;
    return this.baseline && this.current
      ? addUsage(this.baseline, this.current)
      : null;
  }
  /** Record final usage as before, or the live figures when none arrived. */
  complete(final?: ModelUsage[]) {
    if (this.settled) return;
    this.settled = true;
    this.stops.live.delete(this.id);
    const models = final?.length ? final : this.current;
    if (!models?.length || (!final?.length && !this.stops.governed(this.work)))
      return;
    try {
      this.stops.engine.usage.report({
        workId: this.work.id,
        attempt: this.work.attempt,
        token: this.work.token,
        snapshot: { sequence: 1, final: Boolean(final?.length), models },
      });
    } catch {
      // The claim already ended; budgets then count what the attempt retained.
    }
  }
}

/** Stops managed attempts that cross a run budget, as a recoverable block. */
export class BudgetStops {
  constructor(
    readonly engine: Engine,
    private deps: {
      write: (record: ManagedExecution) => void;
      interrupt: (job: Job, reason: string) => void;
    },
  ) {}
  get live() {
    return this.engine.usage.streamed;
  }
  attempt(job: Job, session: Session) {
    return new AttemptBudget(
      this,
      job.work,
      session.nativeId && session.usageUncertain ? null : (session.usage ?? []),
      job.abort.signal,
    );
  }
  // Reads run inside harness callbacks; a removed run has no budget.
  private gates(runId: string) {
    try {
      return this.engine.budgets.read(runId).governing;
    } catch {
      return [];
    }
  }
  governed(work: WorkRequest) {
    return this.gates(work.runId).length > 0;
  }
  /** A reached token or cost maximum, as text; claim counts gate claims only. */
  limitReached(runId: string) {
    const reached = this.gates(runId).flatMap((gate) =>
      gate.checks
        .filter(
          (check) =>
            check.metric !== 'claims' &&
            check.reasons.includes('limit_reached'),
        )
        .map((check) => {
          const value =
            check.value === null
              ? 'over'
              : 'currency' in check && check.currency
                ? `${check.currency} ${(check.value / 1e6).toFixed(2)} of ${(check.max / 1e6).toFixed(2)}`
                : `${check.value} of ${check.max}`;
          return `${check.metric} ${value} (budget on run ${gate.runId})`;
        }),
    );
    return reached.length ? reached.join('; ').slice(0, 500) : undefined;
  }
  /** The stopped attempt's session, so the next claim resumes it. */
  resumeKey(work: WorkRequest) {
    const record = this.engine.store
      .forWork<ManagedExecution>(attemptsCollection, work.id)
      .find((r) => r.attempt === work.attempt);
    return record?.budgetStop?.sessionKey;
  }
  /**
   * The harness has stopped. Keep the attempt's live usage, release the claim
   * without spending a failure, and let the budget gate hold the assignment
   * until the budget allows it again.
   */
  release(job: Job, session: Session, budget: AttemptBudget) {
    const record = job.record;
    const detail = budget.reason ?? 'limit reached';
    const reason = budgetWaitMessage(
      {
        runIds: [],
        since: '',
        reasons: this.gates(job.work.runId).some(
          (gate) => gate.budget.unknownUsage === 'block',
        )
          ? ['limit_reached', 'usage_incomplete']
          : ['limit_reached'],
        stopped: { attempt: record.attempt, reason: detail },
      },
      record.attempt,
    ).slice(0, 1000);
    try {
      this.engine.store.transaction(() => {
        const work = this.engine.store.get<WorkRequest>('work', job.work.id);
        if (
          work?.status !== 'claimed' ||
          work.token !== job.work.token ||
          work.attempt !== record.attempt
        )
          return;
        budget.complete();
        const change = {
          workId: work.id,
          expectedAttempt: work.attempt,
          actor: 'managed-budget',
        };
        this.engine.manageWorkHold({
          ...change,
          action: 'hold',
          expectedRevision: work.holdRevision ?? 0,
          token: work.token,
          category: 'other',
          reason,
          checkpointRef: `budget:${record.id}`,
        });
        this.engine.manageWorkResources({
          ...change,
          action: 'release',
          confirmStopped: true,
        });
        this.engine.manageWorkHold({
          ...change,
          action: 'resume',
          expectedRevision: (work.holdRevision ?? 0) + 1,
        });
        const released = this.engine.store.get<WorkRequest>('work', work.id)!;
        if (released.budgetBlocked) {
          released.budgetBlocked.stopped = {
            attempt: work.attempt,
            reason: detail,
          };
          this.engine.store.put('work', released);
        }
        // The next attempt's final report is differenced against this.
        const baseline = budget.sessionBaseline();
        if (baseline) session.usage = baseline;
        session.usageUncertain = !baseline;
        this.engine.store.put(sessionsCollection, session);
        record.state = 'failed';
        record.endedAt = now();
        record.error = reason;
        record.budgetStop = { sessionKey: job.sessionKey };
        this.deps.write(record);
      });
    } catch (error) {
      this.deps.interrupt(
        job,
        `Could not release the assignment at the budget limit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
