import {
  reportFilterSchema,
  workflowReportSchema,
  calculateDistribution,
  formatCurrencyAmount,
  selectedUsageReport,
  type ReportFilter,
  type WorkflowReport,
  type Run,
  type WorkRequest,
  type UsageAttempt,
  type RunUsageReport,
  type StallRecord,
  type ContextEvent,
  type WorkHoldInterval,
  type WorkflowNode,
  type ExitNodeOutcome,
  type StageDurationMetric,
  type NodeDurationMetric,
  type UsageByRun,
  type UsageByNode,
  type UsageByModel,
  type UsageByProvider,
  type CostAmount,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Engine } from './index.js';

interface RecoveryEventRecord {
  workId: string;
  attempt: number;
  runId: string;
  recoveryEvents?: {
    action: string;
    errorClass: string;
    messageExcerpt: string;
    at: string;
  }[];
}

export function generateWorkflowReport(
  store: Store,
  engine: Engine,
  input: ReportFilter,
): WorkflowReport {
  const filter = reportFilterSchema.parse(input);
  const runs = store.runsForReport(filter);

  // If no runs found
  if (runs.length === 0) {
    const emptyDist = calculateDistribution([]);
    return {
      filter,
      generatedAt: new Date().toISOString(),
      window: {
        since: filter.since ?? null,
        until: filter.until ?? null,
      },
      summary: {
        totalRuns: 0,
        durationMs: emptyDist,
        admissionQueueWaitMs: emptyDist,
        humanWaitMs: emptyDist,
      },
      stages: [],
      nodes: [],
      claims: {
        newSession: emptyDist,
        continuingSession: emptyDist,
        totalAttempts: 0,
        leaseExpiries: 0,
        failures: 0,
        h7Recoveries: 0,
        h12Stalls: 0,
      },
      usage: {
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
        costs: [],
        coverage: {
          measuredPercentage: 0,
          unknownPercentage: 0,
          measuredAttempts: 0,
          unknownAttempts: 0,
          totalAttempts: 0,
        },
        byRun: [],
        byNode: [],
        byModel: [],
        byProvider: [],
      },
      terminalOutcomes: {
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        activeRuns: 0,
        exitNodes: [],
        unattendedCompletionRate: 0,
        humanEscalationRate: 0,
      },
    };
  }

  const runIds = new Set(runs.map((r) => r.id));
  const workList = store.forRuns<WorkRequest>('work', runIds);
  const attemptsList = store.forRuns<UsageAttempt>('usageAttempts', runIds);
  const runUsageList = store.forRuns<RunUsageReport>('runUsage', runIds);
  const stallsList = store.forRuns<StallRecord>('stalls', runIds);
  const contextEventsList = store.forRuns<ContextEvent>(
    'contextEvents',
    runIds,
  );
  const managedAttemptsList = store.forRuns<RecoveryEventRecord>(
    'managedExecutions',
    runIds,
  );
  const eventsList = store.eventTimesForRuns(runIds);
  const holdsList = store.forRuns<WorkHoldInterval>('workHolds', runIds);

  // Cache workflow node definitions: workflowId:version -> nodes
  const nodeDefCache = new Map<string, WorkflowNode[]>();
  function getWorkflowNodes(run: Run): WorkflowNode[] {
    const key = `${run.workflowId}:${run.version ?? 0}`;
    let nodes = nodeDefCache.get(key);
    if (!nodes) {
      const versionRecord = store.getVersion(run.workflowId, run.version);
      if (versionRecord) {
        nodes = versionRecord.definition?.nodes ?? [];
      } else {
        const wf = store.get<{ draft?: { nodes: WorkflowNode[] } }>(
          'workflows',
          run.workflowId,
        );
        nodes = wf?.draft?.nodes ?? [];
      }
      nodeDefCache.set(key, nodes);
    }
    return nodes;
  }

  // 1. Run durations, Admission Queue wait (H8), and Human wait
  const runDurations: number[] = [];
  const admissionQueueWaits: number[] = [];
  const humanWaits: number[] = [];
  const runHumanWaitMap = new Map<string, number>();

  const workIdsByRun = new Map<string, Set<string>>();
  for (const w of workList) {
    let set = workIdsByRun.get(w.runId);
    if (!set) {
      set = new Set();
      workIdsByRun.set(w.runId, set);
    }
    set.add(w.id);
  }

  for (const run of runs) {
    const createdAtMs = Date.parse(run.createdAt);

    // Run duration
    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      const terminalEvent = eventsList
        .filter((e) => e.runId === run.id)
        .findLast(
          (e) =>
            e.type === 'run.completed' ||
            e.type === 'node.failed' ||
            e.type === 'run.cancelled',
        );
      const endMs = terminalEvent?.at
        ? Date.parse(terminalEvent.at)
        : run.executions.findLast((e) => e.completedAt)?.completedAt
          ? Date.parse(
              run.executions.findLast((e) => e.completedAt)!.completedAt!,
            )
          : run.updatedAt
            ? Date.parse(run.updatedAt)
            : createdAtMs;
      runDurations.push(Math.max(0, endMs - createdAtMs));
    } else {
      runDurations.push(Math.max(0, Date.now() - createdAtMs));
    }

    // Admission queue wait (H8)
    if (run.admission?.queuedAt) {
      const queuedAtMs = Date.parse(run.admission.queuedAt);
      if (run.admission.admittedAt) {
        admissionQueueWaits.push(
          Math.max(0, Date.parse(run.admission.admittedAt) - queuedAtMs),
        );
      } else if (run.status === 'queued') {
        admissionQueueWaits.push(Math.max(0, Date.now() - queuedAtMs));
      } else {
        admissionQueueWaits.push(0);
      }
    } else {
      // Admitted immediately
      admissionQueueWaits.push(0);
    }

    // Human wait
    let humanWaitMs = 0;
    // (a) External input node executions
    for (const exec of run.executions) {
      if (exec.kind === 'input' && exec.startedAt) {
        const start = Date.parse(exec.startedAt);
        const end = exec.completedAt
          ? Date.parse(exec.completedAt)
          : run.updatedAt
            ? Date.parse(run.updatedAt)
            : Date.now();
        humanWaitMs += Math.max(0, end - start);
      }
    }
    // (b) Declared work holds (human intervention/holds)
    const runWorkIds = workIdsByRun.get(run.id);
    if (runWorkIds) {
      for (const hold of holdsList) {
        if (runWorkIds.has(hold.workId) && hold.heldAt) {
          const start = Date.parse(hold.heldAt);
          const end = hold.endedAt
            ? Date.parse(hold.endedAt)
            : run.updatedAt
              ? Date.parse(run.updatedAt)
              : Date.now();
          humanWaitMs += Math.max(0, end - start);
        }
      }
    }
    humanWaits.push(humanWaitMs);
    runHumanWaitMap.set(run.id, humanWaitMs);
  }

  // 2. Stage durations (H4) and Node durations
  const stageDurationsMap = new Map<string, number[]>();
  const stageRunCountMap = new Map<string, Set<string>>();

  const nodeDurationsMap = new Map<string, number[]>();
  const nodeMetaMap = new Map<
    string,
    { label: string; kind: string; stage?: string | null }
  >();

  for (const run of runs) {
    const nodes = getWorkflowNodes(run);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const perRunStageDuration = new Map<string, number>();

    for (const exec of run.executions) {
      const node = nodeMap.get(exec.nodeId);
      const stage = node?.stage ?? null;

      if (!nodeMetaMap.has(exec.nodeId)) {
        nodeMetaMap.set(exec.nodeId, {
          label: exec.label ?? node?.label ?? exec.nodeId,
          kind: exec.kind ?? node?.kind ?? 'unknown',
          stage,
        });
      }

      if (exec.startedAt && exec.completedAt) {
        const duration = Math.max(
          0,
          Date.parse(exec.completedAt) - Date.parse(exec.startedAt),
        );
        let list = nodeDurationsMap.get(exec.nodeId);
        if (!list) {
          list = [];
          nodeDurationsMap.set(exec.nodeId, list);
        }
        list.push(duration);

        if (stage) {
          perRunStageDuration.set(
            stage,
            (perRunStageDuration.get(stage) ?? 0) + duration,
          );
        }
      }
    }

    for (const [stage, duration] of perRunStageDuration) {
      let list = stageDurationsMap.get(stage);
      if (!list) {
        list = [];
        stageDurationsMap.set(stage, list);
      }
      list.push(duration);

      let runSet = stageRunCountMap.get(stage);
      if (!runSet) {
        runSet = new Set();
        stageRunCountMap.set(stage, runSet);
      }
      runSet.add(run.id);
    }
  }

  const stageMetrics: StageDurationMetric[] = Array.from(
    stageDurationsMap.entries(),
  ).map(([stage, durations]) => ({
    stage,
    durationMs: calculateDistribution(durations),
    runCount: stageRunCountMap.get(stage)?.size ?? 0,
  }));

  const nodeMetrics: NodeDurationMetric[] = Array.from(
    nodeDurationsMap.entries(),
  ).map(([nodeId, durations]) => {
    const meta = nodeMetaMap.get(nodeId);
    return {
      nodeId,
      label: meta?.label ?? nodeId,
      kind: meta?.kind ?? 'unknown',
      stage: meta?.stage,
      durationMs: calculateDistribution(durations),
      executionCount: durations.length,
    };
  });

  // Sort nodes by execution count descending
  nodeMetrics.sort((a, b) => b.executionCount - a.executionCount);

  // 3. Claims: claim wait (available -> claimed) split by new vs continuing session
  const newSessionWaits: number[] = [];
  const continuingSessionWaits: number[] = [];

  const workMap = new Map(workList.map((w) => [w.id, w]));

  for (const attempt of attemptsList) {
    if (!attempt.claimedAt) continue;
    const work = workMap.get(attempt.workId);
    if (!work) continue;

    let waitMs = 0;
    if (attempt.attempt === 1) {
      waitMs = Math.max(
        0,
        Date.parse(attempt.claimedAt) - Date.parse(work.createdAt),
      );
    } else {
      const prevAttempt = attemptsList.find(
        (a) => a.workId === attempt.workId && a.attempt === attempt.attempt - 1,
      );
      if (prevAttempt?.endedAt) {
        waitMs = Math.max(
          0,
          Date.parse(attempt.claimedAt) - Date.parse(prevAttempt.endedAt),
        );
      } else {
        waitMs = Math.max(
          0,
          Date.parse(attempt.claimedAt) - Date.parse(work.createdAt),
        );
      }
    }

    const isContinuing = Boolean(
      work.context?.continuityGroup &&
      contextEventsList.some(
        (e) =>
          e.kind === 'claim' &&
          (e as any).workId === attempt.workId &&
          (e as any).attempt === attempt.attempt &&
          e.revision > 1,
      ),
    );

    if (isContinuing) {
      continuingSessionWaits.push(waitMs);
    } else {
      newSessionWaits.push(waitMs);
    }
  }

  // Count lease expiries, failures, H7 recoveries, and H12 stalls
  const leaseExpiries =
    eventsList.filter((e) => e.type === 'work.lease_expired').length ||
    workList.reduce((sum, w) => sum + (w.leaseExpiryCount ?? 0), 0) ||
    attemptsList.filter((a) => a.outcome === 'expired').length;

  const failures =
    eventsList.filter((e) => e.type === 'node.failed').length ||
    workList.reduce((sum, w) => sum + (w.failureCount ?? 0), 0) ||
    attemptsList.filter((a) => a.outcome === 'failed').length;

  let h7Recoveries = 0;
  for (const m of managedAttemptsList) {
    if (m.recoveryEvents) {
      for (const r of m.recoveryEvents) {
        if (
          r.action === 'continue' ||
          r.action === 'retry' ||
          r.action === 'nudge' ||
          r.action === 'relaunch'
        ) {
          h7Recoveries++;
        }
      }
    }
  }

  const h12Stalls = stallsList.length;

  // 4. Usage and Attributed Cost
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalReasoningOutputTokens = 0;

  const costByCurrency = new Map<string, number>();

  let measuredAttempts = 0;
  const totalAttempts = attemptsList.length;

  const runTokens = new Map<
    string,
    {
      input: number;
      output: number;
      costMicros: number | null;
      currency?: string;
      measured: boolean;
      workflowId: string;
    }
  >();
  for (const run of runs) {
    runTokens.set(run.id, {
      input: 0,
      output: 0,
      costMicros: null,
      measured: false,
      workflowId: run.workflowId,
    });
  }

  const nodeUsageMap = new Map<
    string,
    {
      label: string;
      input: number;
      output: number;
      costMicros: number | null;
      currency?: string;
      attempts: number;
      measured: number;
    }
  >();

  const modelUsageMap = new Map<
    string,
    {
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      costMicros: number | null;
      currency?: string;
      count: number;
    }
  >();

  const providerUsageMap = new Map<
    string,
    {
      provider: string;
      inputTokens: number;
      outputTokens: number;
      costMicros: number | null;
      currency?: string;
      count: number;
    }
  >();

  for (const attempt of attemptsList) {
    const report = selectedUsageReport(attempt);
    const models = report?.snapshot.models ?? [];
    const isMeasured = models.length > 0;
    if (isMeasured) measuredAttempts++;

    const runEntry = runTokens.get(attempt.runId);
    if (runEntry && isMeasured) runEntry.measured = true;

    const nodeMeta = nodeMetaMap.get(attempt.nodeId);
    let nodeEntry = nodeUsageMap.get(attempt.nodeId);
    if (!nodeEntry) {
      nodeEntry = {
        label: nodeMeta?.label ?? attempt.label ?? attempt.nodeId,
        input: 0,
        output: 0,
        costMicros: null,
        attempts: 0,
        measured: 0,
      };
      nodeUsageMap.set(attempt.nodeId, nodeEntry);
    }
    nodeEntry.attempts++;
    if (isMeasured) nodeEntry.measured++;

    for (const m of models) {
      const inTok = m.inputTokens ?? 0;
      const outTok = m.outputTokens ?? 0;
      const cached = m.cachedInputTokens ?? 0;
      const reasoning = m.reasoningOutputTokens ?? 0;

      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalCachedInputTokens += cached;
      totalReasoningOutputTokens += reasoning;

      if (runEntry) {
        runEntry.input += inTok;
        runEntry.output += outTok;
      }
      nodeEntry.input += inTok;
      nodeEntry.output += outTok;

      if (m.cost) {
        const cur = m.cost.currency;
        const amt = m.cost.amountMicros;
        costByCurrency.set(cur, (costByCurrency.get(cur) ?? 0) + amt);

        if (runEntry) {
          runEntry.costMicros = (runEntry.costMicros ?? 0) + amt;
          runEntry.currency = cur;
        }
        nodeEntry.costMicros = (nodeEntry.costMicros ?? 0) + amt;
        nodeEntry.currency = cur;
      }

      // Group by Model
      const modelKey = `${m.provider}:${m.model}`;
      let modelEntry = modelUsageMap.get(modelKey);
      if (!modelEntry) {
        modelEntry = {
          model: m.model,
          provider: m.provider,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: null,
          count: 0,
        };
        modelUsageMap.set(modelKey, modelEntry);
      }
      modelEntry.inputTokens += inTok;
      modelEntry.outputTokens += outTok;
      modelEntry.count++;
      if (m.cost) {
        modelEntry.costMicros =
          (modelEntry.costMicros ?? 0) + m.cost.amountMicros;
        modelEntry.currency = m.cost.currency;
      }

      // Group by Provider
      let providerEntry = providerUsageMap.get(m.provider);
      if (!providerEntry) {
        providerEntry = {
          provider: m.provider,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: null,
          count: 0,
        };
        providerUsageMap.set(m.provider, providerEntry);
      }
      providerEntry.inputTokens += inTok;
      providerEntry.outputTokens += outTok;
      providerEntry.count++;
      if (m.cost) {
        providerEntry.costMicros =
          (providerEntry.costMicros ?? 0) + m.cost.amountMicros;
        providerEntry.currency = m.cost.currency;
      }
    }
  }

  // Also fold in run-level observer reports (runUsageList)
  for (const ru of runUsageList) {
    const models = ru.snapshot.models ?? [];
    const runEntry = runTokens.get(ru.runId);
    if (runEntry && models.length > 0) runEntry.measured = true;

    for (const m of models) {
      const inTok = m.inputTokens ?? 0;
      const outTok = m.outputTokens ?? 0;
      const cached = m.cachedInputTokens ?? 0;
      const reasoning = m.reasoningOutputTokens ?? 0;

      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalCachedInputTokens += cached;
      totalReasoningOutputTokens += reasoning;

      if (runEntry) {
        runEntry.input += inTok;
        runEntry.output += outTok;
      }

      if (m.cost) {
        const cur = m.cost.currency;
        const amt = m.cost.amountMicros;
        costByCurrency.set(cur, (costByCurrency.get(cur) ?? 0) + amt);

        if (runEntry) {
          runEntry.costMicros = (runEntry.costMicros ?? 0) + amt;
          runEntry.currency = cur;
        }
      }

      const modelKey = `${m.provider}:${m.model}`;
      let modelEntry = modelUsageMap.get(modelKey);
      if (!modelEntry) {
        modelEntry = {
          model: m.model,
          provider: m.provider,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: null,
          count: 0,
        };
        modelUsageMap.set(modelKey, modelEntry);
      }
      modelEntry.inputTokens += inTok;
      modelEntry.outputTokens += outTok;
      modelEntry.count++;
      if (m.cost) {
        modelEntry.costMicros =
          (modelEntry.costMicros ?? 0) + m.cost.amountMicros;
        modelEntry.currency = m.cost.currency;
      }

      let providerEntry = providerUsageMap.get(m.provider);
      if (!providerEntry) {
        providerEntry = {
          provider: m.provider,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: null,
          count: 0,
        };
        providerUsageMap.set(m.provider, providerEntry);
      }
      providerEntry.inputTokens += inTok;
      providerEntry.outputTokens += outTok;
      providerEntry.count++;
      if (m.cost) {
        providerEntry.costMicros =
          (providerEntry.costMicros ?? 0) + m.cost.amountMicros;
        providerEntry.currency = m.cost.currency;
      }
    }
  }

  const unknownAttempts = totalAttempts - measuredAttempts;
  const measuredPercentage =
    totalAttempts > 0
      ? Math.round((measuredAttempts / totalAttempts) * 1000) / 10
      : 0;
  const unknownPercentage =
    totalAttempts > 0
      ? Math.round((unknownAttempts / totalAttempts) * 1000) / 10
      : 0;

  const costAmounts: CostAmount[] = Array.from(costByCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMicros]) => ({
      currency,
      amountMicros,
      formatted: formatCurrencyAmount(amountMicros, currency),
    }));

  const byRun: UsageByRun[] = Array.from(runTokens.entries()).map(
    ([runId, data]) => ({
      runId,
      workflowId: data.workflowId,
      inputTokens: data.input,
      outputTokens: data.output,
      costMicros: data.costMicros,
      currency: data.currency,
      measured: data.measured,
    }),
  );

  const byNode: UsageByNode[] = Array.from(nodeUsageMap.entries()).map(
    ([nodeId, data]) => ({
      nodeId,
      label: data.label,
      inputTokens: data.input,
      outputTokens: data.output,
      costMicros: data.costMicros,
      currency: data.currency,
      attempts: data.attempts,
      measuredPercentage:
        data.attempts > 0
          ? Math.round((data.measured / data.attempts) * 1000) / 10
          : 0,
    }),
  );

  const byModel: UsageByModel[] = Array.from(modelUsageMap.values()).sort(
    (a, b) => b.count - a.count,
  );
  const byProvider: UsageByProvider[] = Array.from(
    providerUsageMap.values(),
  ).sort((a, b) => b.count - a.count);

  // 5. Terminal Outcomes Grouped by Exit Node
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const failedRuns = runs.filter((r) => r.status === 'failed').length;
  const cancelledRuns = runs.filter((r) => r.status === 'cancelled').length;
  const activeRuns = runs.filter(
    (r) =>
      r.status === 'running' || r.status === 'waiting' || r.status === 'queued',
  ).length;

  const exitNodeCounts = new Map<string, { label: string; count: number }>();

  let unattendedCount = 0;
  let escalatedCount = 0;

  for (const run of runs) {
    const isCompleted = run.status === 'completed';
    const nodes = getWorkflowNodes(run);
    const exitNodes = nodes.filter((n) => n.kind === 'exit');
    const exitNodeIdSet = new Set(exitNodes.map((n) => n.id));

    // Determine exit node if completed
    let exitNodeId: string | null = null;
    let exitNodeLabel: string = 'Completed';

    if (isCompleted) {
      const exitExecution = run.executions
        .slice()
        .reverse()
        .find((e) => exitNodeIdSet.has(e.nodeId));
      if (exitExecution) {
        exitNodeId = exitExecution.nodeId;
        const matched = exitNodes.find((n) => n.id === exitNodeId);
        exitNodeLabel = matched?.label ?? exitExecution.label ?? exitNodeId;
      } else if (exitNodeIdSet.has(run.cursor)) {
        exitNodeId = run.cursor;
        const matched = exitNodes.find((n) => n.id === exitNodeId);
        exitNodeLabel = matched?.label ?? exitNodeId;
      } else if (exitNodes.length === 1) {
        exitNodeId = exitNodes[0].id;
        exitNodeLabel = exitNodes[0].label;
      } else {
        exitNodeId = 'completed';
        exitNodeLabel = 'Completed';
      }

      const existing = exitNodeCounts.get(exitNodeId) ?? {
        label: exitNodeLabel,
        count: 0,
      };
      existing.count++;
      exitNodeCounts.set(exitNodeId, existing);
    }

    // Determine unattended vs escalated
    const humanWait = runHumanWaitMap.get(run.id) ?? 0;
    const isEscalationExit =
      exitNodeLabel.toLowerCase().includes('escalat') ||
      exitNodeLabel.toLowerCase().includes('human') ||
      exitNodeLabel.toLowerCase().includes('manual');

    if (isCompleted && humanWait === 0 && !isEscalationExit) {
      unattendedCount++;
    }

    if (humanWait > 0 || isEscalationExit) {
      escalatedCount++;
    }
  }

  const exitNodesOutcomes: ExitNodeOutcome[] = Array.from(
    exitNodeCounts.entries(),
  ).map(([nodeId, { label, count }]) => ({
    nodeId,
    label,
    count,
    percentage:
      completedRuns > 0 ? Math.round((count / completedRuns) * 1000) / 10 : 0,
  }));
  exitNodesOutcomes.sort((a, b) => b.count - a.count);

  const totalRunsCount = runs.length;
  const unattendedCompletionRate =
    totalRunsCount > 0
      ? Math.round((unattendedCount / totalRunsCount) * 1000) / 10
      : 0;
  const humanEscalationRate =
    totalRunsCount > 0
      ? Math.round((escalatedCount / totalRunsCount) * 1000) / 10
      : 0;

  return {
    filter,
    generatedAt: new Date().toISOString(),
    window: {
      since: filter.since ?? null,
      until: filter.until ?? null,
    },
    summary: {
      totalRuns: totalRunsCount,
      durationMs: calculateDistribution(runDurations),
      admissionQueueWaitMs: calculateDistribution(admissionQueueWaits),
      humanWaitMs: calculateDistribution(humanWaits),
    },
    stages: stageMetrics,
    nodes: nodeMetrics,
    claims: {
      newSession: calculateDistribution(newSessionWaits),
      continuingSession: calculateDistribution(continuingSessionWaits),
      totalAttempts,
      leaseExpiries,
      failures,
      h7Recoveries,
      h12Stalls,
    },
    usage: {
      tokens: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cachedInputTokens: totalCachedInputTokens,
        reasoningOutputTokens: totalReasoningOutputTokens,
      },
      costs: costAmounts,
      coverage: {
        measuredPercentage,
        unknownPercentage,
        measuredAttempts,
        unknownAttempts,
        totalAttempts,
      },
      byRun,
      byNode,
      byModel,
      byProvider,
    },
    terminalOutcomes: {
      totalRuns: totalRunsCount,
      completedRuns,
      failedRuns,
      cancelledRuns,
      activeRuns,
      exitNodes: exitNodesOutcomes,
      unattendedCompletionRate,
      humanEscalationRate,
    },
  };
}
