import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  blankDefinition,
  findModelPrice,
  nodeSchema,
  priceTokens,
  type ModelUsage,
  type PricedModelUsage,
  type UsageAttempt,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';

const open: { engine: Engine; store: Store }[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const { engine, store } of open.splice(0)) {
    engine.stop();
    store.close();
  }
});
const worker = { workerId: 'w', freshContext: false, tools: [], skills: [] };
const opus: ModelUsage = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  inputTokens: 1_000_000,
  cachedInputTokens: 600_000,
  cacheWriteInputTokens: 100_000,
  outputTokens: 10_001,
};

it('prices each token class once, rounds once and matches reported model IDs', () => {
  const price = findModelPrice(DEFAULT_PRICE_TABLE, 'anthropic', opus.model)!;
  // 300k uncached × $4 + 600k cached × $0.20 + 100k writes × $5 + 10,001 × $20
  // = 1.2 + 0.12 + 0.5 + 0.20002 dollars.
  expect(priceTokens(opus, price)).toBe(2_020_020);
  expect(
    priceTokens(
      { inputTokens: 1, outputTokens: 0 },
      { ...price, inputMicros: 500_000 },
    ),
  ).toBe(1);
  expect(priceTokens({ outputTokens: 5 }, price)).toBeNull();
  const haiku = findModelPrice(
    DEFAULT_PRICE_TABLE,
    'anthropic',
    'claude-haiku-4-5',
  );
  for (const reported of [
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5@20251001',
  ])
    expect(findModelPrice(DEFAULT_PRICE_TABLE, 'anthropic', reported)).toBe(
      haiku,
    );
  expect(
    findModelPrice(DEFAULT_PRICE_TABLE, 'anthropic', 'claude-opus-4-7[1m]')
      ?.model,
  ).toBe('claude-opus-4-7');
  expect(findModelPrice(DEFAULT_PRICE_TABLE, 'bedrock', opus.model)).toBeNull();
  const pinned = {
    ...DEFAULT_PRICE_TABLE,
    models: [
      { ...price, model: 'claude-opus-5-5-20990101', inputMicros: 1 },
      price,
    ],
  };
  expect(
    findModelPrice(pinned, 'anthropic', 'claude-opus-5-5-20990101')
      ?.inputMicros,
  ).toBe(1);
});

it('derives cost from the table a run captured, keeps reported cost and names gaps', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  open.push({ store, engine });
  const workflow = engine.create('Priced', '', blankDefinition());
  engine.publish(workflow.id);
  const attempt = (models: ModelUsage[]) => {
    const run = engine.start(workflow.id, {}).run;
    const work = engine.claim(engine.available(run.id)[0].id, worker, 10);
    engine.usage.report({
      workId: work.id,
      attempt: work.attempt,
      token: work.token!,
      snapshot: { sequence: 1, final: true, models },
    });
    return { run, work };
  };
  const reported = {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    inputTokens: 10,
    outputTokens: 10,
    cost: { amountMicros: 7, currency: 'USD', source: 'executor' },
  };
  const unknown = {
    provider: 'anthropic',
    model: 'claude-next',
    inputTokens: 5,
    outputTokens: 5,
  };
  const first = attempt([opus, reported, unknown]);
  // Failed attempts still cost money.
  engine.reportFailure(first.work.id, first.work.token!, 'boom');
  const read = (runId: string) =>
    engine.usage.read({ runId, groupBy: 'attempt' });
  const before = read(first.run.id);
  expect(before.totals.costs).toEqual([
    {
      currency: 'USD',
      amountMicros: { value: 2_020_027, coverage: 'partial', overflow: false },
    },
  ]);
  const models = before.groups[0].snapshot!.models as PricedModelUsage[];
  expect(models.find((m) => m.model === reported.model)).toEqual(reported);
  expect(models.find((m) => m.model === opus.model)?.derivedCost).toMatchObject(
    {
      priceTable: { version: DEFAULT_PRICE_TABLE.version, custom: false },
    },
  );
  expect(before.totals.pricing).toMatchObject({
    derivedModels: 1,
    unpriced: [{ model: 'claude-next', reason: 'no_price' }],
  });

  const current = engine.usage.prices.read();
  engine.usage.prices.set({
    expectedId: current.id,
    table: {
      ...current.table,
      version: 'local',
      models: [
        {
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          inputMicros: 0,
          outputMicros: 1_000_000,
        },
      ],
    },
  });
  expect(() =>
    engine.usage.prices.set({ expectedId: current.id, table: null }),
  ).toThrow('Price table changed');
  // History keeps the prices it captured; new runs use the edited table.
  expect(read(first.run.id).totals).toEqual(before.totals);
  const second = attempt([opus]);
  expect(read(second.run.id).totals.costs[0].amountMicros.value).toBe(10_001);
  const report = engine.report({ workflowId: workflow.id });
  expect(report.usage.costs[0].amountMicros).toBe(2_020_027 + 10_001);
  expect(report.usage.pricing?.tables.map((t) => t.version).sort()).toEqual([
    DEFAULT_PRICE_TABLE.version,
    'local',
  ]);

  // Usage recorded before price capture existed stays unpriced.
  const legacy = engine.start(workflow.id, {}).run;
  store.remove('runPricing', legacy.id);
  const work = engine.claim(engine.available(legacy.id)[0].id, worker, 10);
  const receipt = store.get<UsageAttempt>(
    'usageAttempts',
    `${work.id}:${work.attempt}`,
  )!;
  store.put('usageAttempts', {
    ...receipt,
    snapshot: { sequence: 1, final: true, models: [opus] },
  });
  expect(read(legacy.id).totals).toMatchObject({
    costs: [],
    pricing: { unpriced: [{ reason: 'no_table' }] },
  });
});

it('prices a run with the table current when it started, not when it first reports', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  open.push({ store, engine });
  const workflow = engine.create('Started', '', blankDefinition());
  engine.publish(workflow.id);
  const run = engine.start(workflow.id, {}).run;
  const current = engine.usage.prices.read();
  engine.usage.prices.set({
    expectedId: current.id,
    table: { ...current.table, version: 'edited', models: [] },
  });
  const work = engine.claim(engine.available(run.id)[0].id, worker, 10);
  engine.usage.report({
    workId: work.id,
    attempt: work.attempt,
    token: work.token!,
    snapshot: { sequence: 1, final: true, models: [opus] },
  });
  expect(engine.usage.read({ runId: run.id }).totals).toMatchObject({
    costs: [{ amountMicros: { value: 2_020_020 } }],
    pricing: { tables: [{ version: DEFAULT_PRICE_TABLE.version }] },
  });
});

it('prices an invoked child workflow with its caller table even after a table edit', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  open.push({ store, engine });
  const child = engine.create('Child', '', blankDefinition());
  engine.publish(child.id);
  // The parent's Agent step runs before its Workflow step starts the child.
  const definition = blankDefinition();
  definition.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'call',
      kind: 'workflow',
      label: 'Child',
      workflowId: child.id,
      version: 1,
    }),
  );
  definition.edges[1].target = 'call';
  definition.edges.push({
    id: 'e3',
    source: 'call',
    target: 'exit',
    port: 'default',
  });
  const parent = engine.create('Parent', '', definition);
  engine.publish(parent.id);
  const run = engine.start(parent.id, {}).run;
  const current = engine.usage.prices.read();
  engine.usage.prices.set({
    expectedId: current.id,
    table: { ...current.table, version: 'edited', models: [] },
  });
  const step = engine.claim(engine.available(run.id)[0].id, worker, 10);
  engine.submit(step.id, step.token!, {});
  const childRun = engine.store.runs().find((r) => r.parentRunId === run.id)!;
  const work = engine.claim(engine.available(childRun.id)[0].id, worker, 10);
  engine.usage.report({
    workId: work.id,
    attempt: work.attempt,
    token: work.token!,
    snapshot: { sequence: 1, final: true, models: [opus] },
  });
  expect(engine.usage.read({ runId: childRun.id }).totals).toMatchObject({
    costs: [{ amountMicros: { value: 2_020_020 } }],
    pricing: { tables: [{ version: DEFAULT_PRICE_TABLE.version }] },
  });
});

it('projects start cost from recent completed runs and never blocks a start', () => {
  vi.useFakeTimers();
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  open.push({ store, engine });
  const workflow = engine.create('Costly', '', blankDefinition());
  engine.publish(workflow.id);
  const finished = (amountMicros?: number) => {
    const run = engine.start(workflow.id, {}).run;
    const work = engine.claim(engine.available(run.id)[0].id, worker, 10);
    if (amountMicros !== undefined)
      engine.usage.report({
        workId: work.id,
        attempt: work.attempt,
        token: work.token!,
        snapshot: {
          sequence: 1,
          final: true,
          models: [
            {
              provider: 'p',
              model: 'm',
              cost: { amountMicros, currency: 'USD', source: 'fixture' },
            },
          ],
        },
      });
    engine.submit(work.id, work.token!, {});
  };
  finished(2_000_000);
  finished(2_000_000);
  // A run with unknown usage is not a cost of zero.
  finished();
  expect(engine.startCosts.project(workflow.id)).toBeNull();
  finished(500_000);
  // No threshold: nothing is computed or returned.
  expect(engine.start(workflow.id, {})).not.toHaveProperty('costProjection');
  engine.startCosts.configure({
    threshold: { currency: 'USD', amountMicros: 1_000_000 },
  });
  const started = engine.start(workflow.id, {});
  expect(engine.available(started.run.id)).toHaveLength(1);
  expect(started).toMatchObject({
    costProjection: {
      currency: 'USD',
      medianMicros: 2_000_000,
      sampleSize: 3,
      exceedsThreshold: true,
    },
  });
  // A schedule starts anyway and records why no one confirmed.
  const trigger = engine.triggers.mutate({
    action: 'create',
    workflowId: workflow.id,
    config: {
      name: 'Nightly',
      timing: { type: 'interval', intervalMs: 30000 },
    },
  }).trigger!;
  engine.triggers.mutate({
    action: 'enable',
    id: trigger.id,
    expectedRevision: trigger.revision,
  });
  vi.setSystemTime(Date.now() + 30000);
  engine.pump();
  const scheduled = store.runs().find((run) => run.schedule)!;
  expect(engine.available(scheduled.id)).toHaveLength(1);
  expect(
    store
      .list<{ runId: string; type: string; message: string }>('events')
      .find((e) => e.runId === scheduled.id && e.type === 'run.cost_warning')
      ?.message,
  ).toMatch(/median of USD 2\.00 \(3 runs\), above the USD 1\.00/);
});
