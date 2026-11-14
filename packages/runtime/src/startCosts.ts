import {
  setStartCostWarningSchema,
  summarizeUsage,
  type Run,
  type SetStartCostWarningInput,
  type StartCostProjection,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Usage } from './usage.js';

const collection = 'startCostWarning';
/** Recent completed runs examined, and how many need a complete cost. */
const RECENT_RUNS = 20;
const MIN_SAMPLE = 3;
type Threshold = { currency: string; amountMicros: number };

/**
 * Projects a start's cost from the workflow's recent history and warns when
 * the median exceeds a library threshold. Nothing is computed, returned or
 * recorded until a threshold is configured.
 */
export class StartCosts {
  constructor(
    private store: Store,
    private usage: Usage,
    private note: (run: Run, text: string) => void,
  ) {}

  setting(): { threshold: Threshold | null } {
    return {
      threshold:
        this.store.get<{ id: string; threshold: Threshold }>(
          collection,
          'current',
        )?.threshold ?? null,
    };
  }
  configure(input: SetStartCostWarningInput) {
    const { threshold } = setStartCostWarningSchema.parse(input);
    if (threshold) this.store.put(collection, { id: 'current', threshold });
    else this.store.remove(collection, 'current');
    return this.setting();
  }
  /**
   * Median cost of the latest completed root runs, each with its ordinary
   * descendants (the lifecycle budget scope). Runs whose cost in the threshold
   * currency is not completely known are left out; fewer than three left
   * means no projection.
   */
  project(workflowId: string): StartCostProjection | null {
    const { threshold } = this.setting();
    if (!threshold) return null;
    const roots = this.store.findRuns({
      workflowId,
      status: 'completed',
      rootOnly: true,
      limit: RECENT_RUNS,
    });
    if (roots.length < MIN_SAMPLE) return null;
    const runs = this.store.runTrees(new Set(roots.map((run) => run.id)));
    const rootOf = new Map(roots.map((run) => [run.id, run.id]));
    for (let changed = true; changed;) {
      changed = false;
      for (const run of runs)
        if (
          run.parentRunId &&
          run.parentMode !== 'detached' &&
          rootOf.has(run.parentRunId) &&
          !rootOf.has(run.id)
        ) {
          rootOf.set(run.id, rootOf.get(run.parentRunId)!);
          changed = true;
        }
    }
    const scope = new Set(rootOf.keys());
    const { attempts, runReports } = this.usage.prices.price(
      this.usage.attemptsForRuns(scope),
      this.usage.runReportsForRuns(scope),
    );
    const costs = roots.flatMap((root) => {
      const mine = <T extends { runId: string }>(items: T[]) =>
        items.filter((item) => rootOf.get(item.runId) === root.id);
      const own = mine(attempts),
        streams = mine(runReports);
      if (!own.length && !streams.length) return [0];
      const totals = summarizeUsage(own, streams);
      const cost = totals.costs.find(
        (entry) => entry.currency === threshold.currency,
      )?.amountMicros;
      return cost?.coverage === 'complete' && cost.value !== null
        ? [cost.value]
        : [];
    });
    if (costs.length < MIN_SAMPLE) return null;
    costs.sort((a, b) => a - b);
    const middle = Math.floor(costs.length / 2);
    const medianMicros =
      costs.length % 2
        ? costs[middle]
        : Math.round((costs[middle - 1] + costs[middle]) / 2);
    return {
      currency: threshold.currency,
      medianMicros,
      sampleSize: costs.length,
      thresholdMicros: threshold.amountMicros,
      exceedsThreshold: medianMicros > threshold.amountMicros,
    };
  }
  /** Start responses carry the projection as information; nothing blocks. */
  attach<T extends object>(workflowId: string, response: T) {
    const costProjection = this.project(workflowId);
    return costProjection ? { ...response, costProjection } : response;
  }
  /**
   * Schedules and event triggers never wait for a confirmation. Their start
   * goes ahead and an over-threshold projection is recorded on the run.
   */
  automated(run: Run) {
    const projection = this.project(run.workflowId);
    if (projection?.exceedsThreshold)
      this.note(
        run,
        `Started without cost confirmation: recent runs cost a median of ${money(projection.medianMicros, projection.currency)} (${projection.sampleSize} runs), above the ${money(projection.thresholdMicros, projection.currency)} warning threshold.`,
      );
    return run;
  }
}
const money = (amount: number, currency: string) =>
  `${currency} ${(amount / 1e6).toFixed(2)}`;
