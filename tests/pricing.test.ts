import { afterEach, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  blankDefinition,
  findModelPrice,
  priceTokens,
  type ModelUsage,
  type PricedModelUsage,
  type UsageAttempt,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';

const open: { engine: Engine; store: Store }[] = [];
afterEach(() => {
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
