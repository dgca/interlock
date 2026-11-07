import { elapsedExcludingPausesMs } from '@interlock/core';
import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  RUN_USAGE_GRACE_MS,
  modelKey,
  reportUsageSchema,
  selectedUsageReport,
  summarizeUsage,
  tokenFields,
  usageQuerySchema,
  type Run,
  type RunUsageReport,
  type UsageAttempt,
  type UsageGroup,
  type UsageOutcome,
  type UsageQuery,
  type UsageReportInput,
  type UsageSnapshot,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { claimTokenHash } from './leases.js';

const collection = 'usageAttempts';
const runUsageCollection = 'runUsage';
const key = (workId: string, attempt: number) => `${workId}:${attempt}`;
const runStreamKey = (runId: string, streamId: string) =>
  `${runId}:${streamId}`;
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
    const parsed = reportUsageSchema.parse(input);
    const { snapshot, source } = parsed;
    snapshot.models.sort((a, b) =>
      modelKey(a) < modelKey(b) ? -1 : modelKey(a) > modelKey(b) ? 1 : 0,
    );
    if (parsed.runId !== undefined) {
      const runId = parsed.runId;
      const streamId =
        parsed.streamId ??
        (parsed.session
          ? `${parsed.session.executorId}:${parsed.session.sessionId}`
          : 'default');
      return this.store.transaction(() => {
        const run = this.store.get<Run>('runs', runId);
        if (!run) throw new InterlockError('Run not found');
        if (
          run.status === 'completed' ||
          run.status === 'failed' ||
          run.status === 'cancelled'
        ) {
          const endedAtMs = Date.parse(run.updatedAt);
          if (Date.now() - endedAtMs > RUN_USAGE_GRACE_MS)
            throw new InterlockError(
              'Run-level usage reports are only accepted while the run is active or within 1 hour after it ends',
            );
        }
        const id = runStreamKey(runId, streamId);
        const existing = this.store.get<RunUsageReport>(runUsageCollection, id);
        if (existing) {
          const previous = existing.snapshot;
          if (snapshot.sequence === previous.sequence) {
            if (!isDeepStrictEqual(snapshot, previous))
              throw new InterlockError(
                'A different usage snapshot already uses this sequence',
              );
            return {
              runId,
              streamId,
              source: 'observer' as const,
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
        const record: RunUsageReport = {
          id,
          runId,
          streamId,
          ...(parsed.session ? { session: parsed.session } : {}),
          source: 'observer',
          snapshot,
          reportedAt: now(),
        };
        this.store.put(runUsageCollection, record);
        this.notify(runId);
        return {
          runId,
          streamId,
          source: 'observer' as const,
          sequence: snapshot.sequence,
          applied: true,
        };
      });
    }
    const { workId, attempt, token } = parsed;
    return this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', workId!);
      if (!work) throw new InterlockError('Assignment not found');
      const id = key(workId!, attempt!);
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
            workId: workId!,
            attempt: attempt!,
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
        workId: workId!,
        attempt: attempt!,
        source,
        sequence: snapshot.sequence,
        applied: true,
      };
    });
  }

  removeRuns(runIds: Set<string>) {
    for (const attempt of this.store.list<UsageAttempt>(collection))
      if (runIds.has(attempt.runId)) this.store.remove(collection, attempt.id);
    for (const report of this.store.list<RunUsageReport>(runUsageCollection))
      if (runIds.has(report.runId))
        this.store.remove(runUsageCollection, report.id);
  }

  runReportsForRuns(scope: Set<string>): RunUsageReport[] {
    return this.store.forRuns<RunUsageReport>(runUsageCollection, scope);
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

  private attemptTime(attempt: UsageAttempt): {
    wallMs: number | null;
    pausedMs: number | null;
    activeMs: number | null;
  } {
    if (!attempt.claimedAt)
      return { wallMs: null, pausedMs: null, activeMs: null };
    return elapsedExcludingPausesMs(
      Date.parse(attempt.claimedAt),
      Date.parse(attempt.endedAt ?? new Date().toISOString()),
      this.store.pauseHolds(
        this.store.get<Run>('runs', attempt.runId)!.workflowId,
        true,
      ),
    );
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
    const runReports = this.runReportsForRuns(scope);

    let entries: UsageGroup[] = [];
    if (query.groupBy === 'run') {
      const runBuckets = new Map<
        string,
        { attempts: UsageAttempt[]; runReports: RunUsageReport[] }
      >();
      for (const attempt of attempts) {
        const bucket = runBuckets.get(attempt.runId) ?? {
          attempts: [],
          runReports: [],
        };
        bucket.attempts.push(attempt);
        runBuckets.set(attempt.runId, bucket);
      }
      for (const report of runReports) {
        const bucket = runBuckets.get(report.runId) ?? {
          attempts: [],
          runReports: [],
        };
        bucket.runReports.push(report);
        runBuckets.set(report.runId, bucket);
      }
      entries = [...runBuckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([runId, bucket]) => ({
          key: runId,
          runId,
          totals: summarizeUsage(bucket.attempts, bucket.runReports),
        }));
    } else if (query.groupBy === 'node') {
      const nodeGroups = new Map<string, UsageAttempt[]>();
      for (const attempt of attempts) {
        const groupKey = JSON.stringify([attempt.runId, attempt.nodeId]);
        const group = nodeGroups.get(groupKey) ?? [];
        group.push(attempt);
        nodeGroups.set(groupKey, group);
      }
      const attemptEntries = [...nodeGroups.entries()].map(([key, group]) => {
        const first = group[0];
        return {
          key,
          runId: first.runId,
          nodeId: first.nodeId,
          label: first.label,
          totals: summarizeUsage(group),
        };
      });
      const runEntries = runReports.map((report) => ({
        key: JSON.stringify([
          report.runId,
          report.streamId === 'default'
            ? '__run__'
            : `__run__:${report.streamId}`,
        ]),
        runId: report.runId,
        nodeId: null,
        label:
          report.streamId === 'default'
            ? 'Run-level usage'
            : `Run-level usage (${report.streamId})`,
        totals: summarizeUsage([], [report]),
      }));
      entries = [...attemptEntries, ...runEntries].sort((a, b) =>
        a.key.localeCompare(b.key),
      );
    } else if (query.groupBy === 'worker') {
      const workerBuckets = new Map<
        string,
        {
          workerId: string | null;
          attempts: UsageAttempt[];
          runReports: RunUsageReport[];
        }
      >();
      for (const attempt of attempts) {
        const key = JSON.stringify(attempt.workerId);
        const bucket = workerBuckets.get(key) ?? {
          workerId: attempt.workerId,
          attempts: [],
          runReports: [],
        };
        bucket.attempts.push(attempt);
        workerBuckets.set(key, bucket);
      }
      for (const report of runReports) {
        const workerId = report.session?.executorId ?? null;
        const key = JSON.stringify(workerId);
        const bucket = workerBuckets.get(key) ?? {
          workerId,
          attempts: [],
          runReports: [],
        };
        bucket.runReports.push(report);
        workerBuckets.set(key, bucket);
      }
      entries = [...workerBuckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, bucket]) => ({
          key,
          workerId: bucket.workerId,
          totals: summarizeUsage(bucket.attempts, bucket.runReports),
        }));
    } else {
      const attemptEntries = attempts.map((first) => {
        const selected = selectedUsageReport(first);
        return {
          key: first.id,
          runId: first.runId,
          nodeId: first.nodeId,
          label: first.label,
          workerId: first.workerId,
          workId: first.workId,
          attempt: first.attempt,
          outcome: first.outcome,
          claimedAt: first.claimedAt,
          endedAt: first.endedAt ?? null,
          ...this.attemptTime(first),
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
          totals: summarizeUsage([first]),
        };
      });
      const runEntries = runReports.map((report) => ({
        key: `run:${report.runId}:${report.streamId}`,
        runId: report.runId,
        nodeId: null,
        label:
          report.streamId === 'default'
            ? 'Run-level usage'
            : `Run-level usage (${report.streamId})`,
        workerId: report.session?.executorId ?? null,
        workId: null,
        attempt: null,
        streamId: report.streamId,
        outcome: 'unknown' as const,
        claimedAt: null,
        endedAt: null,
        wallMs: null,
        pausedMs: null,
        activeMs: null,
        source: 'observer' as const,
        reportedAt: report.reportedAt,
        snapshot: report.snapshot,
        ...(query.includeReports
          ? {
              reports: {
                executor: null,
                observer: {
                  snapshot: report.snapshot,
                  reportedAt: report.reportedAt,
                },
              },
            }
          : {}),
        modelSelection: null,
        totals: summarizeUsage([], [report]),
      }));
      entries = [...attemptEntries, ...runEntries].sort((a, b) =>
        a.key.localeCompare(b.key),
      );
    }
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
      totals: summarizeUsage(attempts, runReports),
      groups: entries.slice(query.offset, query.offset + query.limit),
      offset: query.offset,
      limit: query.limit,
      totalGroups: entries.length,
      nextOffset:
        query.offset + query.limit < entries.length
          ? query.offset + query.limit
          : null,
    };
  }
}
