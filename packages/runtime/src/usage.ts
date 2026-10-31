import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  modelKey,
  reportUsageSchema,
  selectedUsageReport,
  summarizeUsage,
  tokenFields,
  usageQuerySchema,
  type UsageAttempt,
  type UsageOutcome,
  type UsageQuery,
  type UsageReportInput,
  type UsageSnapshot,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { claimTokenHash } from './leases.js';

const collection = 'usageAttempts';
const key = (workId: string, attempt: number) => `${workId}:${attempt}`;
const now = () => new Date().toISOString();

function assertCumulative(before: UsageSnapshot, after: UsageSnapshot) {
  for (const previous of before.models) {
    const model = after.models.find(
      (item) => modelKey(item) === modelKey(previous),
    );
    if (!model)
      throw new InterlockError('Cumulative usage cannot remove a model');
    for (const field of tokenFields)
      if (
        previous[field] !== undefined &&
        (model[field] === undefined || model[field]! < previous[field]!)
      )
        throw new InterlockError(
          `Cumulative usage cannot remove or decrease ${field}`,
        );
    if (
      previous.cost &&
      (!model.cost ||
        model.cost.currency !== previous.cost.currency ||
        model.cost.source !== previous.cost.source ||
        model.cost.amountMicros < previous.cost.amountMicros)
    )
      throw new InterlockError(
        'Cumulative usage cannot remove or decrease cost, or change its currency/source',
      );
  }
}

export class Usage {
  constructor(
    private store: Store,
    private notify: (runId: string) => void,
  ) {}

  private receipt(work: WorkRequest, claimedAt: string | null): UsageAttempt {
    return {
      id: key(work.id, work.attempt),
      workId: work.id,
      runId: work.runId,
      nodeId: work.nodeId,
      label: work.label,
      workerId: work.workerId ?? null,
      attempt: work.attempt,
      claimedAt,
      ...(claimedAt !== null
        ? {
            requestedTier: work.context.tier ?? null,
            ...(work.modelSelection
              ? { modelSelection: work.modelSelection }
              : {}),
          }
        : {}),
      outcome:
        work.status === 'claimed' ||
        work.status === 'completed' ||
        work.status === 'failed' ||
        work.status === 'cancelled'
          ? work.status
          : 'unknown',
      ...(work.token ? { tokenHash: claimTokenHash(work.token) } : {}),
    };
  }
  claimed(work: WorkRequest) {
    this.store.put(collection, this.receipt(work, now()));
  }
  ended(work: WorkRequest, outcome: UsageOutcome) {
    if (work.status !== 'claimed') return;
    const receipt =
      this.store.get<UsageAttempt>(collection, key(work.id, work.attempt)) ??
      this.receipt(work, null);
    this.store.put(collection, { ...receipt, outcome, endedAt: now() });
  }
  report(input: UsageReportInput) {
    const { workId, attempt, source, token, snapshot } =
      reportUsageSchema.parse(input);
    snapshot.models.sort((a, b) =>
      modelKey(a) < modelKey(b) ? -1 : modelKey(a) > modelKey(b) ? 1 : 0,
    );
    return this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', workId);
      if (!work) throw new InterlockError('Assignment not found');
      const id = key(workId, attempt);
      const receipt =
        this.store.get<UsageAttempt>(collection, id) ??
        (source === 'executor' &&
        work.attempt === attempt &&
        work.token === token
          ? this.receipt(work, null)
          : undefined);
      if (source === 'observer') {
        if (
          !receipt?.endedAt ||
          receipt.outcome === 'claimed' ||
          receipt.outcome === 'unknown'
        )
          throw new InterlockError(
            'Observer usage requires a retained ended attempt',
          );
      } else if (
        !receipt?.tokenHash ||
        receipt.tokenHash !== claimTokenHash(token!)
      )
        throw new InterlockError(
          'Usage claim token does not match this attempt',
        );
      // An observer cannot invent historical attempts. Executor legacy fallback
      // remains token-protected, and source streams never share sequences.
      if (!receipt) throw new InterlockError('Usage attempt not found');
      const previous =
        source === 'observer'
          ? receipt.observerReport?.snapshot
          : receipt.snapshot;
      if (previous) {
        if (snapshot.sequence === previous.sequence) {
          if (!isDeepStrictEqual(snapshot, previous))
            throw new InterlockError(
              'A different usage snapshot already uses this sequence',
            );
          return {
            workId,
            attempt,
            source,
            sequence: snapshot.sequence,
            applied: false,
          };
        }
        if (snapshot.sequence < previous.sequence)
          throw new InterlockError(
            'Usage sequence is stale; report current cumulative totals with a higher sequence',
          );
        if (previous.final)
          throw new InterlockError('Final usage cannot be changed');
        assertCumulative(previous, snapshot);
      }
      this.store.put(
        collection,
        source === 'observer'
          ? { ...receipt, observerReport: { snapshot, reportedAt: now() } }
          : { ...receipt, snapshot, reportedAt: now() },
      );
      this.notify(work.runId);
      return {
        workId,
        attempt,
        source,
        sequence: snapshot.sequence,
        applied: true,
      };
    });
  }

  removeRuns(runIds: Set<string>) {
    for (const attempt of this.store.list<UsageAttempt>(collection))
      if (runIds.has(attempt.runId)) this.store.remove(collection, attempt.id);
  }

  attemptsForRuns(scope: Set<string>) {
    const receipts = new Map(
      this.store
        .forRuns<UsageAttempt>(collection, scope)
        .map((record) => [record.id, record]),
    );
    const attempts: UsageAttempt[] = [];
    for (const work of this.store.forRuns<WorkRequest>('work', scope))
      for (let attempt = 1; attempt <= work.attempt; attempt++) {
        const id = key(work.id, attempt);
        const receipt = receipts.get(id);
        // Preserve unknown legacy history rather than assigning it to the latest worker.
        attempts.push(
          receipt ?? {
            ...this.receipt(work, null),
            id,
            attempt,
            tokenHash: undefined,
            workerId: attempt === work.attempt ? (work.workerId ?? null) : null,
            outcome:
              attempt === work.attempt
                ? this.receipt(work, null).outcome
                : 'unknown',
          },
        );
      }
    return attempts;
  }

  read(input: UsageQuery) {
    const query = usageQuerySchema.parse(input);
    const runs = this.store.runs();
    if (!runs.some((run) => run.id === query.runId))
      throw new InterlockError('Run not found');
    const scope = new Set([query.runId]);
    const requested = runs.find((run) => run.id === query.runId)!;
    if (query.includeChain && requested.chain)
      for (const run of runs)
        if (run.chain?.rootRunId === requested.chain.rootRunId)
          scope.add(run.id);
    if (query.includeDescendants) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const run of runs)
          if (
            run.parentRunId &&
            scope.has(run.parentRunId) &&
            !scope.has(run.id)
          ) {
            scope.add(run.id);
            changed = true;
          }
      }
    }
    const attempts = this.attemptsForRuns(scope);
    const groups = new Map<string, UsageAttempt[]>();
    for (const attempt of attempts) {
      const groupKey =
        query.groupBy === 'run'
          ? attempt.runId
          : query.groupBy === 'node'
            ? JSON.stringify([attempt.runId, attempt.nodeId])
            : query.groupBy === 'worker'
              ? JSON.stringify(attempt.workerId)
              : attempt.id;
      const group = groups.get(groupKey) ?? [];
      group.push(attempt);
      groups.set(groupKey, group);
    }
    const entries = [...groups].sort(([a], [b]) => a.localeCompare(b));
    return {
      runId: query.runId,
      includeDescendants: query.includeDescendants,
      includeChain: query.includeChain,
      includeReports: query.includeReports,
      includedRuns: scope.size,
      includedDetachedRuns: runs.filter(
        (run) =>
          scope.has(run.id) &&
          run.id !== query.runId &&
          run.parentMode === 'detached',
      ).length,
      groupBy: query.groupBy,
      totals: summarizeUsage(attempts),
      groups: entries
        .slice(query.offset, query.offset + query.limit)
        .map(([key, group]) => {
          const first = group[0];
          const selected = selectedUsageReport(first);
          return {
            key,
            ...(query.groupBy !== 'worker' ? { runId: first.runId } : {}),
            ...(query.groupBy === 'node' || query.groupBy === 'attempt'
              ? { nodeId: first.nodeId, label: first.label }
              : {}),
            ...(query.groupBy === 'worker' || query.groupBy === 'attempt'
              ? { workerId: first.workerId }
              : {}),
            ...(query.groupBy === 'attempt'
              ? {
                  workId: first.workId,
                  attempt: first.attempt,
                  outcome: first.outcome,
                  claimedAt: first.claimedAt,
                  endedAt: first.endedAt ?? null,
                  source: selected?.source ?? null,
                  reportedAt: selected?.reportedAt ?? null,
                  snapshot: selected?.snapshot ?? null,
                  ...(query.includeReports
                    ? {
                        reports: {
                          executor: first.snapshot
                            ? {
                                snapshot: first.snapshot,
                                reportedAt: first.reportedAt ?? null,
                              }
                            : null,
                          observer: first.observerReport ?? null,
                        },
                      }
                    : {}),
                  ...(first.requestedTier !== undefined
                    ? { requestedTier: first.requestedTier }
                    : {}),
                  modelSelection: first.modelSelection ?? null,
                }
              : {}),
            totals: summarizeUsage(group),
          };
        }),
      offset: query.offset,
      limit: query.limit,
      totalGroups: groups.size,
      nextOffset:
        query.offset + query.limit < groups.size
          ? query.offset + query.limit
          : null,
    };
  }
}
