import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  definitionSchema,
  validateDefinition,
  modelSelectionSchema,
  type ModelTier,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const opened: { store: Store; engine: Engine }[] = [];
const worker = {
  workerId: 'tier-test',
  freshContext: false,
  tools: [],
  skills: [],
};
const selection = {
  tier: 'balanced' as const,
  provider: 'example',
  model: 'chosen',
};
function setup(
  tier?: ModelTier,
  mode: 'current' | 'fresh' = 'current',
  path = ':memory:',
) {
  const store = new Store(path),
    engine = new Engine(store, process.cwd());
  opened.push({ store, engine });
  const definition = blankDefinition();
  const node = definition.nodes.find((n) => n.kind === 'agent')!;
  node.context = { ...node.context, mode, ...(tier ? { tier } : {}) };
  const workflow = engine.create('Tier test', '', definition);
  engine.publish(workflow.id);
  const started = engine.startSummary(workflow.id, {});
  return {
    store,
    engine,
    workflow,
    definition,
    node,
    runId: started.runId,
    started,
  };
}
afterEach(() => {
  for (const { engine, store } of opened.splice(0)) {
    engine.stop();
    store.close();
  }
  vi.useRealTimers();
});

it.each(['max', 'balanced', 'fast'] as const)(
  'exposes %s for either context mode in every assignment projection',
  (tier) => {
    for (const mode of ['current', 'fresh'] as const) {
      const { engine, runId, started } = setup(tier, mode);
      expect(started.nextWork.items[0].context).toMatchObject({ tier, mode });
      expect(engine.workSummaries(runId)[0].context.tier).toBe(tier);
      expect(
        engine.continuation.briefing({ id: runId, limit: 20 }).available
          .items[0].context.tier,
      ).toBe(tier);
      const work = engine.available(runId)[0];
      expect(work.context.tier).toBe(tier);
      if (mode === 'fresh')
        expect(() => engine.claim(work.id, worker)).toThrow('fresh context');
      const claim = engine.claim(work.id, {
        ...worker,
        freshContext: mode === 'fresh',
        modelSelection: selection,
      });
      expect(claim.context.tier).toBe(tier);
      expect(claim.modelSelection).toEqual(selection);
      expect(
        engine.usage.read({ runId, groupBy: 'attempt' }).groups[0],
      ).toMatchObject({
        requestedTier: tier,
        modelSelection: selection,
        snapshot: null,
      });
    }
  },
);

it('rejects unknown tiers and invalid declarations without reserving or binding work', () => {
  const { engine, definition, node, runId, store } = setup('max');
  expect(
    definitionSchema.safeParse({
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === node.id
          ? { ...n, context: { ...node.context, tier: 'ultra' } }
          : n,
      ),
    }).success,
  ).toBe(false);
  const work = engine.available(runId)[0];
  work.context.continuityGroup = 'author';
  store.put('work', work);
  const before = store.get('work', work.id);
  for (const invalid of [
    {},
    { tier: 'ultra' },
    { provider: ' ' },
    { model: 'x'.repeat(201) },
    { unknown: 'field' },
  ]) {
    expect(() =>
      engine.claim(work.id, {
        ...worker,
        session: { executorId: 'harness', sessionId: 'author' },
        modelSelection: invalid as any,
      }),
    ).toThrow();
    expect(store.get('work', work.id)).toEqual(before);
    expect(engine.contextGroups.describe(runId, 'author')).toMatchObject({
      revision: 0,
      session: null,
    });
    expect(engine.usage.read({ runId }).totals.attempts).toBe(0);
  }
  expect(modelSelectionSchema.parse({ model: ' chosen ' })).toEqual({
    model: 'chosen',
  });
  const claim = engine.claim(work.id, {
    ...worker,
    session: { executorId: 'harness', sessionId: 'author' },
    modelSelection: selection,
  });
  expect(claim.attempt).toBe(1);
});

it('retains each attempt separately and never treats a declaration as measured usage', () => {
  vi.useFakeTimers();
  const { engine, runId } = setup('max');
  const one = engine.claim(
    engine.available(runId)[0].id,
    { ...worker, modelSelection: selection },
    10,
  );
  expect(engine.usage.read({ runId }).totals.tokens.inputTokens.coverage).toBe(
    'unknown',
  );
  engine.reportFailure(one.id, one.token!, 'Retry');
  const two = engine.claim(one.id, worker, 10);
  expect(two.modelSelection).toBeUndefined();
  engine.usage.report({
    workId: one.id,
    attempt: one.attempt,
    token: one.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        { provider: 'actual', model: 'a' },
        { provider: 'actual', model: 'b' },
      ],
    },
  });
  vi.advanceTimersByTime(10_001);
  engine.pump();
  const attempts = engine.usage.read({ runId, groupBy: 'attempt' }).groups;
  expect(attempts[0]).toMatchObject({
    attempt: 1,
    requestedTier: 'max',
    modelSelection: selection,
    outcome: 'failed',
  });
  expect(attempts[0].snapshot?.models).toHaveLength(2);
  expect(attempts[1]).toMatchObject({
    attempt: 2,
    requestedTier: 'max',
    modelSelection: null,
    snapshot: null,
    outcome: 'expired',
  });
  expect(JSON.stringify(attempts)).not.toContain(one.token!);
});

it('preserves omission, immutable publications and portable tiers without exporting selections', () => {
  const old = setup();
  expect(old.engine.available(old.runId)[0].context).not.toHaveProperty('tier');
  old.engine.claim(old.engine.available(old.runId)[0].id, worker);
  expect(
    old.engine.usage.read({ runId: old.runId, groupBy: 'attempt' }).groups[0],
  ).toMatchObject({ requestedTier: null, modelSelection: null });
  const { engine, workflow, definition, node, runId } = setup('fast');
  engine.claim(engine.available(runId)[0].id, {
    ...worker,
    modelSelection: selection,
  });
  node.context.tier = 'max';
  engine.update(workflow.id, {
    draft: definition,
    draftRevision: workflow.draftRevision,
  });
  expect(
    engine.store
      .getVersion(workflow.id, 1)
      ?.definition.nodes.find((n) => n.kind === 'agent')?.context.tier,
  ).toBe('fast');
  const bundle = exportWorkflows(engine.store, workflow.id);
  expect(JSON.stringify(bundle)).not.toContain('modelSelection');
  const target = setup().store;
  importWorkflows(target, bundle);
  const imported = target.workflows().find((w) => w.id === workflow.id)!;
  expect(
    imported.draft.nodes.find((n) => n.kind === 'agent')?.context.tier,
  ).toBe('max');
  expect(validateDefinition(imported.draft)).toBeTruthy();
});

it('persists new attribution across restart and leaves legacy attempts unknown', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-tiers-'));
  try {
    const path = join(directory, 'data.sqlite');
    const { engine, store, runId } = setup('balanced', 'current', path);
    const work = engine.claim(engine.available(runId)[0].id, {
      ...worker,
      modelSelection: selection,
    });
    engine.stop();
    store.close();
    opened.pop();
    const reopened = new Store(path),
      resumed = new Engine(reopened, process.cwd());
    opened.push({ store: reopened, engine: resumed });
    expect(
      resumed.usage.read({ runId, groupBy: 'attempt' }).groups[0],
    ).toMatchObject({ requestedTier: 'balanced', modelSelection: selection });
    const receipt = reopened.list<any>('usageAttempts')[0];
    delete receipt.requestedTier;
    delete receipt.modelSelection;
    reopened.put('usageAttempts', receipt);
    const legacy = resumed.usage.read({ runId, groupBy: 'attempt' }).groups[0];
    expect(legacy).not.toHaveProperty('requestedTier');
    expect(legacy.modelSelection).toBeNull();
    expect(resumed.inspect(runId).work[0].id).toBe(work.id);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
