import { createHash } from 'node:crypto';
import {
  selectedUsageReport,
  type ModelUsage,
  type NodeExecution,
  type UsageAttempt,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import {
  attributes,
  OtlpBatcher,
  type AttributeValue,
  type OtlpSpan,
} from './otlpTransport.js';
import { Pricing } from './pricing.js';
import type { TraceExportConfig } from './traceExportConfig.js';

/**
 * Opt-in OpenTelemetry trace export. Loaded only when INTERLOCK_OTEL_TRACES is
 * on. One trace per run tree (a detached run or continue-as-new successor
 * starts its own, linked to its caller or predecessor); spans per run, node
 * execution and Agent attempt. IDs derive from run, execution and attempt IDs,
 * so a restart re-creates the same trace. Exports metadata,
 * timings, model, usage and cost; never inputs, outputs, prompts, errors,
 * paths, variables or tokens.
 */
export interface TraceExport {
  /** Exports finished work now, waiting at most `deadlineMs` for the collector. */
  flush(deadlineMs?: number): Promise<void>;
  /** Stops observing, then flushes with a short deadline. */
  stop(deadlineMs?: number): Promise<void>;
}

const SCAN_DELAY_MS = 200;
const REMEMBERED_SPANS = 50_000;
const terminal = (status: string) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';
const hex = (input: string, bytes: number) =>
  createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, bytes * 2);
const traceId = (rootRunId: string) => hex(`interlock/trace/${rootRunId}`, 16);
const runSpanId = (runId: string) => hex(`interlock/run/${runId}`, 8);
const executionSpanId = (runId: string, executionId: string) =>
  hex(`interlock/execution/${runId}/${executionId}`, 8);
const attemptSpanId = (attemptId: string) =>
  hex(`interlock/attempt/${attemptId}`, 8);
const nanos = (iso: string) => `${BigInt(Date.parse(iso)) * 1_000_000n}`;

function span(
  ids: Pick<OtlpSpan, 'traceId' | 'spanId' | 'parentSpanId' | 'links'>,
  name: string,
  start: string,
  end: string,
  failed: boolean,
  record: Record<string, AttributeValue>,
): OtlpSpan {
  return {
    ...ids,
    name,
    kind: 1,
    startTimeUnixNano: nanos(start),
    endTimeUnixNano: nanos(end < start ? start : end),
    attributes: attributes(
      failed ? { ...record, 'error.type': 'failed' } : record,
    ),
    status: { code: failed ? 2 : 0 },
  };
}

/** Sum of one field across models; unknown when any model omits it. */
function sum(models: ModelUsage[], field: keyof ModelUsage) {
  let total = 0;
  for (const model of models) {
    const value = model[field];
    if (typeof value !== 'number') return undefined;
    total += value;
  }
  return total;
}

/** GenAI semantic convention usage attributes for one attempt's selected report. */
function usageAttributes(attempt: UsageAttempt) {
  const report = selectedUsageReport(attempt);
  if (!report) return {};
  const models = report.snapshot.models;
  const single = models.length === 1 ? models[0] : undefined;
  const currencies = new Set(models.map((m) => m.cost?.currency));
  // Cost is exported only when every model is priced in one currency.
  const currency = currencies.size === 1 ? [...currencies][0] : undefined;
  const micros =
    currency === undefined
      ? undefined
      : models.reduce((total, m) => total + m.cost!.amountMicros, 0);
  return {
    'gen_ai.provider.name': single?.provider,
    'gen_ai.response.model': single?.model,
    'interlock.usage.models':
      models.length > 1
        ? models.map((m) => `${m.provider}/${m.model}`)
        : undefined,
    'gen_ai.usage.input_tokens': sum(models, 'inputTokens'),
    'gen_ai.usage.output_tokens': sum(models, 'outputTokens'),
    'gen_ai.usage.cache_read.input_tokens': sum(models, 'cachedInputTokens'),
    'gen_ai.usage.cache_write.input_tokens': sum(
      models,
      'cacheWriteInputTokens',
    ),
    'gen_ai.usage.reasoning.output_tokens': sum(
      models,
      'reasoningOutputTokens',
    ),
    'gen_ai.usage.cost': micros === undefined ? undefined : micros / 1e6,
    'interlock.usage.cost.currency': currency,
    'interlock.usage.cost.derived':
      (currency && models.some((m) => 'derivedCost' in m)) || undefined,
    'interlock.usage.source': report.source,
    'interlock.usage.final': report.snapshot.final,
  };
}

/** Bounded insertion-ordered memory; the oldest entries go first. */
function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > REMEMBERED_SPANS) map.delete(map.keys().next().value!);
}

const RETRIES = 3;

export function startTraceExport(
  store: Store,
  config: TraceExportConfig,
  options: { log?: (message: string) => void } = {},
): TraceExport {
  const log = options.log ?? ((message: string) => console.warn(message));
  if (config.ignoredProtocol)
    log(
      `Trace export sends OTLP/HTTP JSON; ignoring protocol ${config.ignoredProtocol}.`,
    );
  const batcher = new OtlpBatcher(config, log);
  const pricing = new Pricing(store);
  // Work that finished before this process started was exported by the
  // previous one (or while export was off); only later endings are sent.
  const since = Date.now();
  let cursor = store.runsChangedSince().revision;
  /** Exported execution and attempt span IDs. */
  const sent = new Map<string, true>();
  /** Per run: first execution position not yet known to be exported. */
  const progress = new Map<string, number>();
  /** Finished runs whose span was handled, by their completion time. */
  const finished = new Map<string, string>();
  const callers = new Map<string, string | undefined>();
  /** Runs that failed to export, with attempts so far; retried next scan. */
  const failed = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const fresh = (spanId: string, finishedAt: string) => {
    if (Date.parse(finishedAt) < since || sent.has(spanId)) return false;
    remember(sent, spanId, true);
    return true;
  };

  /** Root of the run's trace: the nearest detached ancestor, or the tree root. */
  const traceRoot = (runId: string) => {
    let current = store.currentRun(runId);
    let id = runId;
    for (let depth = 0; current?.parentRunId && depth < 1000; depth++) {
      if (current.parentMode === 'detached') break;
      id = current.parentRunId;
      current = store.currentRun(id);
    }
    return id;
  };

  /** The caller execution of a child run; invoked workflows record it only in the parent. */
  const callerExecution = (runId: string, parentRunId: string) => {
    if (!callers.has(runId))
      remember(
        callers,
        runId,
        store
          .executionSteps(parentRunId)
          .find(
            (e) =>
              e.childRunIds.includes(runId) ||
              e.retryChildRunIds?.includes(runId),
          )?.id,
      );
    return callers.get(runId);
  };

  /**
   * When the run reached its terminal status: its last terminal event, else
   * its last execution's completion, never a later save of the run.
   */
  const completedAt = (runId: string, createdAt: string) => {
    const event = store
      .eventTimesForRuns(new Set([runId]))
      .findLast(
        (e) =>
          e.type === 'run.completed' ||
          e.type === 'run.cancelled' ||
          e.type === 'node.failed',
      );
    return (
      event?.at ??
      store.executionSteps(runId).findLast((e) => e.completedAt)?.completedAt ??
      createdAt
    );
  };

  const spansFor = (runId: string): OtlpSpan[] => {
    const run = store.currentRun(runId);
    if (!run) {
      progress.delete(runId);
      return [];
    }
    const done = terminal(run.status);
    // A finished run whose span was handled changes only on later saves.
    if (done && finished.has(runId)) return [];
    if (!done) finished.delete(runId);
    const runEnd = done ? completedAt(runId, run.createdAt) : undefined;
    const trace = traceId(traceRoot(runId));
    const runSpan = runSpanId(runId);
    const spans: OtlpSpan[] = [];

    // Only executions from the first one not yet exported.
    const steps = store.executionSteps(runId, progress.get(runId) ?? 0);
    const ending = steps.flatMap((execution) => {
      const end =
        execution.completedAt ??
        (terminal(execution.status) ? runEnd : undefined);
      return terminal(execution.status) && end ? [{ execution, end }] : [];
    });
    const next = steps.find((e) => !terminal(e.status))?.position;
    if (next !== undefined || steps.length)
      progress.set(runId, next ?? steps.at(-1)!.position + 1);

    const agentSteps = ending.filter(
      ({ execution, end }) =>
        execution.kind === 'agent' &&
        Date.parse(end) >= since &&
        !sent.has(executionSpanId(runId, execution.id)),
    );
    let attempts: UsageAttempt[] = [];
    let work = new Map<string, WorkRequest>();
    if (agentSteps.length) {
      const ids = new Set([runId]);
      const executions = new Set(agentSteps.map((s) => s.execution.id));
      work = new Map(
        store
          .forRuns<WorkRequest>('work', ids)
          .filter((w) => executions.has(w.executionId))
          .map((w) => [w.id, w] as const),
      );
      // Tokens reported without a cost get the run's derived price-table cost.
      attempts = pricing.price(
        store
          .forRuns<UsageAttempt>('usageAttempts', ids)
          .filter((a) => work.has(a.workId)),
      ).attempts;
    }

    const executionSpans = (execution: NodeExecution, end: string) => {
      const spanId = executionSpanId(runId, execution.id);
      if (!fresh(spanId, end)) return;
      spans.push(
        span(
          { traceId: trace, spanId, parentSpanId: runSpan },
          `${execution.kind} ${execution.label}`,
          execution.startedAt,
          end,
          execution.status === 'failed',
          {
            'interlock.run.id': runId,
            'interlock.execution.id': execution.id,
            'interlock.execution.status': execution.status,
            'interlock.execution.attempt': execution.attempt,
            'interlock.execution.route': execution.port,
            'interlock.node.id': execution.nodeId,
            'interlock.node.kind': execution.kind,
            'interlock.node.label': execution.label,
            'interlock.workflow.version': execution.version ?? run.version,
          },
        ),
      );
      for (const attempt of attempts) {
        const request = work.get(attempt.workId);
        if (request?.executionId !== execution.id || !attempt.claimedAt)
          continue;
        const attemptSpan = attemptSpanId(attempt.id);
        if (!fresh(attemptSpan, end)) continue;
        spans.push(
          span(
            { traceId: trace, spanId: attemptSpan, parentSpanId: spanId },
            `invoke_agent ${attempt.label}`,
            attempt.claimedAt,
            attempt.endedAt ?? end,
            attempt.outcome === 'failed' || attempt.outcome === 'expired',
            {
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': attempt.label,
              'gen_ai.request.model': request.executorModel,
              ...usageAttributes(attempt),
              'interlock.run.id': runId,
              'interlock.execution.id': execution.id,
              'interlock.work.id': attempt.workId,
              'interlock.attempt.number': attempt.attempt,
              'interlock.attempt.outcome': attempt.outcome,
              'interlock.executor': request.executor,
            },
          ),
        );
      }
    };
    for (const { execution, end } of ending) executionSpans(execution, end);

    if (runEnd) {
      remember(finished, runId, runEnd);
      progress.delete(runId);
      if (Date.parse(runEnd) >= since) spans.push(runSpanFor(run, runEnd));
    }
    return spans;
  };

  const runSpanFor = (
    run: NonNullable<ReturnType<Store['currentRun']>>,
    end: string,
  ) => {
    const detached = run.parentMode === 'detached';
    const caller =
      run.parentRunId &&
      (run.parentExecutionId ?? callerExecution(run.id, run.parentRunId));
    const callerSpan =
      run.parentRunId &&
      (caller
        ? executionSpanId(run.parentRunId, caller)
        : runSpanId(run.parentRunId));
    // A detached run links to its caller step; a continue-as-new successor to
    // its predecessor run. Each starts its own trace.
    const links = [
      ...(detached && callerSpan
        ? [
            {
              traceId: traceId(traceRoot(run.parentRunId!)),
              spanId: callerSpan,
              attributes: [],
            },
          ]
        : []),
      ...(run.chain?.previousRunId
        ? [
            {
              traceId: traceId(traceRoot(run.chain.previousRunId)),
              spanId: runSpanId(run.chain.previousRunId),
              attributes: attributes({ 'interlock.link': 'continued_from' }),
            },
          ]
        : []),
    ];
    return span(
      {
        traceId: traceId(traceRoot(run.id)),
        spanId: runSpanId(run.id),
        ...(callerSpan && !detached ? { parentSpanId: callerSpan } : {}),
        ...(links.length ? { links } : {}),
      },
      `invoke_workflow ${run.workflowName}`,
      run.createdAt,
      end,
      run.status === 'failed',
      {
        'gen_ai.operation.name': 'invoke_workflow',
        'gen_ai.agent.name': run.workflowName,
        'interlock.run.id': run.id,
        'interlock.run.status': run.status,
        'interlock.run.detached': detached || undefined,
        'interlock.parent_run.id': run.parentRunId,
        'interlock.workflow.id': run.workflowId,
        'interlock.workflow.version': run.version,
        'interlock.batch.item_index': run.batchItemIndex,
        'interlock.parallel.branch': run.parallelBranch?.key,
        'interlock.chain.root_run.id': run.chain?.rootRunId,
        'interlock.chain.index': run.chain?.index,
      },
    );
  };

  const exportRun = (runId: string) => {
    try {
      batcher.enqueue(spansFor(runId));
      failed.delete(runId);
    } catch (error) {
      const tries = (failed.get(runId) ?? 0) + 1;
      if (tries < RETRIES) failed.set(runId, tries);
      else failed.delete(runId);
      log(
        `Trace export skipped run ${runId}${tries < RETRIES ? ' (will retry)' : ''}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const scan = () => {
    timer = undefined;
    const retry = [...failed.keys()];
    try {
      for (;;) {
        const changed = store.runsChangedSince(cursor);
        const seen = new Set<string>();
        for (const { runId, revision } of changed.changes) {
          if (!seen.has(runId)) exportRun(runId);
          seen.add(runId);
          cursor = revision;
        }
        if (!changed.more) break;
      }
    } catch (error) {
      log(
        `Trace export could not read changes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const runId of retry) if (failed.has(runId)) exportRun(runId);
  };
  const unsubscribe = store.subscribe(() => {
    if (timer || stopped) return;
    timer = setTimeout(scan, SCAN_DELAY_MS);
    timer.unref?.();
  });

  return {
    async flush(deadlineMs = config.timeoutMs) {
      clearTimeout(timer);
      scan();
      await batcher.flush(deadlineMs);
    },
    async stop(deadlineMs = 2000) {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      clearTimeout(timer);
      scan();
      await batcher.stop(deadlineMs);
    },
  };
}
