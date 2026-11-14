import { afterEach, expect, it, vi } from 'vitest';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { anthropicStreamUsage } from '../packages/runtime/src/executors/budgetStops';

const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
});
function create() {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'codex',
    enabled: true,
    expectedRevision: 0,
  });
  return e;
}
// A fake harness at the adapter boundary the real adapters implement.
function harness(e: Engine, run: HarnessAdapter['run']) {
  e.executors.start([
    {
      id: 'codex',
      detect: () =>
        Promise.resolve({
          command: '/fake/codex',
          status: 'detected',
          version: 'test',
        }),
      run,
    },
  ]);
}
// One USD per million input tokens: each streamed model turn costs USD 0.30.
const turnTokens = 300_000;
function budgetRun(
  e: Engine,
  unknownUsage: 'allow' | 'block' | null = 'allow',
) {
  const table = e.usage.prices.read();
  e.usage.prices.set({
    expectedId: table.id,
    table: {
      version: 'budget-fixture',
      currency: 'USD',
      sources: [],
      models: [
        {
          provider: 'fixture',
          model: 'm',
          inputMicros: 1_000_000,
          outputMicros: 0,
        },
      ],
    },
  });
  const definition = blankDefinition();
  definition.executor = 'codex';
  const w = e.create('Budgeted', '', definitionSchema.parse(definition));
  e.publish(w.id);
  return e.start(
    w.id,
    1,
    undefined,
    unknownUsage
      ? {
          scope: 'lifecycle',
          unknownUsage,
          limits: { cost: { currency: 'USD', threshold: { max: 1_000_000 } } },
        }
      : undefined,
  ).run;
}
// Cumulative usage after a number of turns; one model has no price.
const turnUsage = (turns: number) => [
  {
    provider: 'fixture',
    model: 'm',
    inputTokens: turns * turnTokens,
    outputTokens: 0,
  },
  { provider: 'fixture', model: 'unpriced', inputTokens: 1, outputTokens: 1 },
];

it('stops a managed attempt within one model turn of a 1 USD budget and resumes its session after a raise', async () => {
  const e = create();
  const calls: HarnessRun[] = [];
  let turnsAfterStop = 0;
  harness(e, async (i) => {
    calls.push(i);
    i.onSession('native-session');
    // The resumed native session reports its own cumulative totals.
    if (calls.length > 1)
      return {
        output: i.work.input,
        usage: [
          {
            provider: 'fixture',
            model: 'm',
            inputTokens: 4 * turnTokens + 100,
            outputTokens: 0,
          },
          { ...turnUsage(1)[1], inputTokens: 6, outputTokens: 6 },
        ],
      };
    for (let turn = 1; turn <= 10; turn++) {
      await new Promise((r) => setTimeout(r, 1));
      if (i.signal.aborted) throw new Error('Execution stopped');
      i.onUsage?.(turnUsage(turn), 'attempt');
      if (i.signal.aborted) turnsAfterStop++;
    }
    return { output: 'over budget', usageScope: 'attempt' };
  });
  const run = budgetRun(e);
  await vi.waitFor(() =>
    expect(e.projectRun(run.id).waiting?.kind).toBe('budget'),
  );
  // 0.30, 0.60, 0.90, then 1.20 crosses the limit: the harness stops there.
  expect(turnsAfterStop).toBe(1);
  expect(calls).toHaveLength(1);
  expect(e.projectRun(run.id).waiting?.detail.message).toMatch(
    /Stopped at the run budget limit: cost USD 1\.20 of 1\.00/,
  );
  const [gate] = e.budgets.read(run.id).governing;
  expect(gate.checks[0]).toMatchObject({
    value: 4 * turnTokens,
    coverage: 'partial',
    reasons: ['limit_reached'],
    pricing: { unpriced: [{ model: 'unpriced', reason: 'no_price' }] },
  });
  // Released without spending a failure, keeping the streamed usage.
  const work = e.store.work()[0];
  expect(work).toMatchObject({ status: 'available', heldClaimCount: 1 });
  expect(work.failureCount ?? 0).toBe(0);
  expect(work.budgetBlocked).toBeDefined();
  expect(
    e.usage.read({ runId: run.id, groupBy: 'attempt' }).groups[0],
  ).toMatchObject({
    outcome: 'held',
    snapshot: { final: false, models: [{ inputTokens: 4 * turnTokens }, {}] },
  });
  e.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: {
      ...gate.budget,
      limits: { cost: { currency: 'USD', threshold: { max: 5_000_000 } } },
    },
  });
  await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
  expect(calls).toHaveLength(2);
  expect(calls[1].sessionId).toBe('native-session');
  // Differenced against the stopped attempt's streamed usage, and final.
  expect(
    e.usage.read({ runId: run.id, groupBy: 'attempt' }).groups[1].snapshot,
  ).toMatchObject({
    final: true,
    models: [{ inputTokens: 100 }, { inputTokens: 5, outputTokens: 5 }],
  });
});

it('says how to leave a stop that incomplete usage still blocks', async () => {
  const e = create();
  harness(e, async (i) => {
    i.onSession('native-session');
    for (let turn = 1; turn <= 10; turn++) {
      await new Promise((r) => setTimeout(r, 1));
      if (i.signal.aborted) throw new Error('Execution stopped');
      i.onUsage?.(turnUsage(turn), 'attempt');
    }
    return { output: 'over budget', usageScope: 'attempt' };
  });
  const run = budgetRun(e, 'block');
  const message = () => e.projectRun(run.id).waiting?.detail.message;
  await vi.waitFor(() => expect(message()).toMatch(/Raise the budget/));
  expect(message()).toMatch(/set unknownUsage to allow/);
  const [gate] = e.budgets.read(run.id).governing;
  e.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: {
      ...gate.budget,
      limits: { cost: { currency: 'USD', threshold: { max: 5_000_000 } } },
    },
  });
  expect(e.projectRun(run.id).waiting?.kind).toBe('budget');
  expect(message()).not.toMatch(/Raise the budget/);
  expect(message()).toMatch(/report final figures.*set unknownUsage to allow/);
});

it('never stops a run without a budget while usage streams', async () => {
  const e = create();
  harness(e, (i) => {
    i.onSession('native-session');
    for (let turn = 1; turn <= 10; turn++)
      i.onUsage?.(turnUsage(turn), 'attempt');
    expect(i.signal.aborted).toBe(false);
    return Promise.resolve({ output: 'done', usageScope: 'attempt' });
  });
  const run = budgetRun(e, null);
  await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
});

it('keeps a result that arrives after a budget stop', async () => {
  const e = create();
  harness(e, (i) => {
    i.onSession('native-session');
    i.onUsage?.(turnUsage(4), 'attempt');
    expect(i.signal.aborted).toBe(true);
    return Promise.resolve({
      output: 'finished anyway',
      usageScope: 'attempt',
      usage: turnUsage(4),
    });
  });
  const run = budgetRun(e);
  await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
  expect(e.run(run.id).output).toBe('finished anyway');
  expect(e.budgets.read(run.id).governing[0].state).toBe('blocked');
});

it('counts each streamed Claude Code response once across its content blocks', () => {
  const stream = anthropicStreamUsage();
  const usage = (output_tokens: number) => ({
    input_tokens: 10,
    output_tokens,
    cache_read_input_tokens: 90,
    cache_creation_input_tokens: 0,
  });
  // One response arrives as several messages; later ones carry more output.
  stream({ id: 'a', model: 'claude-x', usage: usage(1) });
  stream({ id: 'a', model: 'claude-x', usage: usage(40) });
  expect(stream({ id: 'b', model: 'claude-x', usage: usage(5) })).toEqual([
    {
      provider: 'anthropic',
      model: 'claude-x',
      inputTokens: 200,
      outputTokens: 45,
      cachedInputTokens: 180,
      cacheWriteInputTokens: 0,
    },
  ]);
});
