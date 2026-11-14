import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { startTraceExport } from '@interlock/runtime/traceExport';
import { traceExportConfig } from '@interlock/runtime/traceExportConfig';
import { batchDefinition, itemAgent } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  links?: { traceId: string; spanId: string }[];
  attributes: { key: string; value: Record<string, unknown> }[];
}

let store: Store, engine: Engine, collector: Server, url: string;
let bodies: string[];
beforeEach(async () => {
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  bodies = [];
  collector = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      bodies.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, resolve));
  url = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
});
afterEach(async () => {
  engine.stop();
  store.close();
  await new Promise((resolve) => collector.close(resolve));
});

const exporter = (
  overrides: Record<string, string> = {},
  log: (message: string) => void = () => {},
) =>
  startTraceExport(
    store,
    traceExportConfig({
      INTERLOCK_OTEL_TRACES: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: url,
      OTEL_BSP_SCHEDULE_DELAY: '10',
      ...overrides,
    })!,
    { log },
  );
const spans = (): Span[] =>
  bodies.flatMap((body) =>
    (
      JSON.parse(body) as {
        resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
      }
    ).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
  );
const attr = (span: Span, key: string) => {
  const value = span.attributes.find((a) => a.key === key)?.value;
  return value && Object.values(value)[0];
};
function publish(name: string, definition = blankDefinition()) {
  const workflow = engine.create(name, '', definition);
  engine.publish(workflow.id);
  return workflow;
}
const worker = { workerId: 'w', freshContext: true, tools: [], skills: [] };
function completeAgent(runId: string) {
  const work = engine.available(runId).find((w) => w.runId === runId)!;
  const claim = engine.claim(work.id, worker);
  engine.usage.report({
    workId: work.id,
    attempt: claim.attempt,
    token: claim.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'anthropic',
          model: 'model-a',
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 40,
          cost: { amountMicros: 12_500, currency: 'USD', source: 'test' },
        },
      ],
    },
  });
  engine.submit(work.id, claim.token!, { answer: 'SECRET-OUTPUT' });
}

it('ignores a stray OTEL endpoint unless INTERLOCK_OTEL_TRACES is on', () => {
  expect(traceExportConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: url })).toBe(
    undefined,
  );
  expect(
    traceExportConfig({
      INTERLOCK_OTEL_TRACES: 'on',
      OTEL_EXPORTER_OTLP_ENDPOINT: `${url}/`,
      OTEL_EXPORTER_OTLP_HEADERS:
        'Authorization=Basic%20abc,x-langfuse-ingestion-version=4',
    }),
  ).toMatchObject({
    url: `${url}/v1/traces`,
    headers: {
      Authorization: 'Basic abc',
      'x-langfuse-ingestion-version': '4',
    },
  });
});

it('exports one trace per run tree nested through invoked workflows and Batch items, without content', async () => {
  const traces = exporter();
  const items = publish(
    'Items',
    batchDefinition(itemAgent(), { itemsPath: 'items' }),
  );
  const supervisor = publish('Supervisor', workflowCall(items.id, 'wait'));
  const started = engine.start(supervisor.id, {
    items: ['SECRET-INPUT-1', 'SECRET-INPUT-2'],
  });
  const itemsRun = started.children[0];
  for (const child of engine.inspect(itemsRun.id).children)
    if (child.batchNodeId) completeAgent(child.id);
  const notifier = publish('Notifier');
  const kickoff = engine.start(
    publish('Kickoff', workflowCall(notifier.id, 'detached')).id,
    {},
  );
  completeAgent(kickoff.children[0].id);
  await traces.stop();

  expect(engine.inspect(started.run.id).run.status).toBe('completed');
  const all = spans();
  const body = bodies.join('');
  expect(body).not.toContain('SECRET');
  expect(body).not.toContain('Research this item.');
  expect(new Set(all.map((s) => s.spanId)).size).toBe(all.length);
  const byId = new Map(all.map((s) => [s.spanId, s]));
  const chain = (span: Span): string[] => {
    const parent = span.parentSpanId && byId.get(span.parentSpanId);
    return parent ? [span.name, ...chain(parent)] : [span.name];
  };

  const attempts = all.filter((s) => s.name === 'invoke_agent Research item');
  expect(attempts).toHaveLength(2);
  expect(chain(attempts[0])).toEqual([
    'invoke_agent Research item',
    'agent Research item',
    'invoke_workflow Batch · item 1',
    'batch Batch',
    'invoke_workflow Items',
    'workflow Start investigation',
    'invoke_workflow Supervisor',
  ]);
  const supervisorTree = all.filter((s) => s.traceId === attempts[0].traceId);
  // Supervisor and Items runs with 3 steps each, and 2 items x (run, step, attempt).
  expect(supervisorTree).toHaveLength(14);
  expect(supervisorTree.filter((s) => !s.parentSpanId)).toHaveLength(1);
  expect(attr(attempts[0], 'gen_ai.operation.name')).toBe('invoke_agent');
  expect(attr(attempts[0], 'gen_ai.provider.name')).toBe('anthropic');
  expect(attr(attempts[0], 'gen_ai.response.model')).toBe('model-a');
  expect(attr(attempts[0], 'gen_ai.usage.input_tokens')).toBe('100');
  expect(attr(attempts[0], 'gen_ai.usage.cache_read.input_tokens')).toBe('40');
  expect(attr(attempts[0], 'gen_ai.usage.cost')).toBe(0.0125);

  const detached = all.find((s) => s.name === 'invoke_workflow Notifier')!;
  const caller = all.find(
    (s) =>
      s.name === 'workflow Start investigation' &&
      s.traceId !== attempts[0].traceId,
  )!;
  expect(detached.parentSpanId).toBeUndefined();
  expect(detached.traceId).not.toBe(caller.traceId);
  expect(detached.links).toEqual([
    { traceId: caller.traceId, spanId: caller.spanId, attributes: [] },
  ]);
});

it('re-creates the same trace after a restart without duplicating finished spans', async () => {
  const items = publish(
    'Items',
    batchDefinition(itemAgent(), { itemsPath: 'items' }),
  );
  const before = exporter();
  const run = engine.start(items.id, { items: [1, 2] }).run;
  const [first, second] = engine.inspect(run.id).children;
  completeAgent(first.id);
  await before.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const after = exporter();
  completeAgent(second.id);
  await after.stop();

  const all = spans();
  expect(new Set(all.map((s) => s.spanId)).size).toBe(all.length);
  expect(new Set(all.map((s) => s.traceId)).size).toBe(1);
  const ids = new Set(all.map((s) => s.spanId));
  expect(all.filter((s) => s.parentSpanId && !ids.has(s.parentSpanId))).toEqual(
    [],
  );
  // Items run, its Input, Batch and Output, plus 3 spans per item.
  expect(all).toHaveLength(10);
});

it('drops spans with a logged count when the collector is down, without delaying runs', async () => {
  await new Promise((resolve) => collector.close(resolve));
  collector = createServer().listen(0);
  const logs: string[] = [];
  const traces = exporter(
    { OTEL_BSP_MAX_QUEUE_SIZE: '2' },
    (message) => void logs.push(message),
  );
  const run = engine.start(publish('Solo').id, {}).run;
  completeAgent(run.id);
  expect(engine.inspect(run.id).run.status).toBe('completed');
  const stopping = Date.now();
  await traces.stop(500);
  expect(Date.now() - stopping).toBeLessThan(1500);
  expect(logs.join('\n')).toMatch(/dropped \d+ spans? \(queue full\)/);
  expect(logs.join('\n')).toMatch(
    /dropped 2 spans \((collector unreachable|timeout|shutdown deadline)\)/,
  );
});

it('sends a finished run span once, ending at completion, when the run is saved again later', async () => {
  const traces = exporter();
  const run = engine.start(publish('Solo').id, {}).run;
  completeAgent(run.id);
  await traces.flush(1000);
  const completed = engine
    .inspect(run.id)
    .events.findLast((e) => e.type === 'run.completed')!.at;
  await new Promise((resolve) => setTimeout(resolve, 20));
  engine.budgets.set({
    runId: run.id,
    expectedRevision: 0,
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { inputTokens: { max: 1000 } },
    },
  });
  await traces.stop();

  const runSpans = spans().filter((s) => s.name === 'invoke_workflow Solo');
  expect(runSpans).toHaveLength(1);
  expect(
    (runSpans[0] as Span & { endTimeUnixNano: string }).endTimeUnixNano,
  ).toBe(`${BigInt(Date.parse(completed)) * 1_000_000n}`);
});
