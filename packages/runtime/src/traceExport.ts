import { createHash } from 'node:crypto';
import {
  selectedUsageReport,
  type ModelUsage,
  type NodeExecution,
  type Run,
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
 * on. One trace per run tree (a detached run starts its own, linked to its
 * caller); spans per run, node execution and Agent attempt. IDs derive from run
 * and execution IDs, so a restart re-creates the same trace. Exports metadata,
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

function sum(models: ModelUsage[], field: keyof ModelUsage) {
  const known = models
    .map((model) => model[field])
    .filter((n): n is number => typeof n === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) : undefined;
}

/** GenAI semantic convention usage attributes for one attempt's selected report. */
function usageAttributes(attempt: UsageAttempt) {
  const report = selectedUsageReport(attempt);
  if (!report) return {};
  const models = report.snapshot.models;
  const single = models.length === 1 ? models[0] : undefined;
  const currencies = [
    ...new Set(models.flatMap((m) => (m.cost ? [m.cost.currency] : []))),
  ];
  const micros =
    currencies.length === 1
      ? models.reduce((total, m) => total + (m.cost?.amountMicros ?? 0), 0)
      : undefined;
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
    'interlock.usage.cost.currency':
      currencies.length === 1 ? currencies[0] : undefined,
    'interlock.usage.cost.derived':
      models.some((m) => 'derivedCost' in m) || undefined,
    'interlock.usage.source': report.source,
    'interlock.usage.final': report.snapshot.final,
  };
}

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
  const sent = new Map<string, string>();
  const callers = new Map<string, string | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const fresh = (spanId: string, end: string, finished = end) => {
    if (Date.parse(finished) < since || sent.get(spanId) === end) return false;
    sent.delete(spanId);
    sent.set(spanId, end);
    if (sent.size > REMEMBERED_SPANS) sent.delete(sent.keys().next().value!);
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
  const callerExecution = (run: Run) => {
    if (!run.parentRunId) return undefined;
    if (run.parentExecutionId) return run.parentExecutionId;
    if (!callers.has(run.id)) {
      const parent = store.get<Run>('runs', run.parentRunId);
      callers.set(
        run.id,
        parent?.executions.find(
          (e) =>
            e.childRunIds.includes(run.id) ||
            e.retryChildRunIds?.includes(run.id),
        )?.id,
      );
      if (callers.size > REMEMBERED_SPANS)
        callers.delete(callers.keys().next().value!);
    }
    return callers.get(run.id);
  };

  const spansFor = (runId: string): OtlpSpan[] => {
    const run = store.get<Run>('runs', runId);
    if (!run) return [];
    const trace = traceId(traceRoot(run.id));
    const caller = callerExecution(run);
    const callerSpan =
      run.parentRunId &&
      (caller
        ? executionSpanId(run.parentRunId, caller)
        : runSpanId(run.parentRunId));
    const detached = run.parentMode === 'detached';
    const runEnd = terminal(run.status) ? run.updatedAt : undefined;
    const ids = new Set([run.id]);
    const work = new Map(
      store.forRuns<WorkRequest>('work', ids).map((w) => [w.id, w] as const),
    );
    // Tokens reported without a cost get the run's derived price-table cost.
    const attempts = pricing.price(
      store.forRuns<UsageAttempt>('usageAttempts', ids),
    ).attempts;
    const spans: OtlpSpan[] = [];
    const runSpan = runSpanId(run.id);

    const executionSpans = (execution: NodeExecution, end: string) => {
      const spanId = executionSpanId(run.id, execution.id);
      if (!fresh(spanId, end)) return;
      spans.push(
        span(
          { traceId: trace, spanId, parentSpanId: runSpan },
          `${execution.kind} ${execution.label}`,
          execution.startedAt,
          end,
          execution.status === 'failed',
          {
            'interlock.run.id': run.id,
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
        const attemptEnd = attempt.endedAt ?? end;
        if (!fresh(attemptSpanId(attempt.id), attemptEnd, end)) continue;
        spans.push(
          span(
            {
              traceId: trace,
              spanId: attemptSpanId(attempt.id),
              parentSpanId: spanId,
            },
            `invoke_agent ${attempt.label}`,
            attempt.claimedAt,
            attemptEnd,
            attempt.outcome === 'failed' || attempt.outcome === 'expired',
            {
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': attempt.label,
              'gen_ai.request.model': request.executorModel,
              ...usageAttributes(attempt),
              'interlock.run.id': run.id,
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

    for (const execution of run.executions) {
      const end =
        execution.completedAt ??
        (terminal(execution.status) ? runEnd : undefined);
      if (terminal(execution.status) && end) executionSpans(execution, end);
    }
    if (runEnd && fresh(runSpan, runEnd)) {
      const link =
        detached && callerSpan
          ? [
              {
                traceId: traceId(traceRoot(run.parentRunId!)),
                spanId: callerSpan,
                attributes: [],
              },
            ]
          : undefined;
      spans.push(
        span(
          {
            traceId: trace,
            spanId: runSpan,
            ...(callerSpan && !detached ? { parentSpanId: callerSpan } : {}),
            ...(link ? { links: link } : {}),
          },
          `invoke_workflow ${run.workflowName}`,
          run.createdAt,
          runEnd,
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
          },
        ),
      );
    }
    return spans;
  };

  const scan = () => {
    timer = undefined;
    try {
      for (;;) {
        const changed = store.runsChangedSince(cursor);
        cursor = changed.revision;
        for (const id of new Set(changed.runIds)) batcher.enqueue(spansFor(id));
        if (!changed.more) break;
      }
    } catch (error) {
      log(
        `Trace export skipped changes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
