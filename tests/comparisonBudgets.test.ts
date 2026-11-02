import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, type BudgetPolicy } from '@interlock/core';
import { batchDefinition } from './fixtures/batch';
const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const worker = {
  workerId: 'fixture',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(max: number, batch = false, path = ':memory:', extra = {}) {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  const w = e.create(
    'Budgeted comparison',
    '',
    batch ? batchDefinition() : blankDefinition(),
  );
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Cases',
      cases: [{ id: 'a', name: 'A', input: batch ? [1, 2] : {} }],
    },
  });
  const sampleBudget: BudgetPolicy = {
      scope: 'tree',
      unknownUsage: 'allow',
      limits: { claims: { max } },
    },
    q = {
      suiteId: suite.id,
      suiteRevision: 1,
      baselineVersion: 1,
      candidateVersion: 1,
      sampleBudget,
      ...extra,
    };
  const c = e.testbench.start({
    ...q,
    confirmation: e.testbench.preview(q).confirmation,
    requestId: crypto.randomUUID(),
  });
  e.pump();
  return { e, c, q };
}
it('installs zero allowances before any Agent work is eligible', () => {
  const { e, c } = setup(0);
  expect(e.available()).toHaveLength(0);
  for (const s of e.testbench.report({ id: c.id }).samples) {
    expect(e.budgets.read(s.runId!).budget).toMatchObject({
      scope: 'tree',
      limits: { claims: { max: 0 } },
    });
    expect(
      e.store.work().find((w) => w.runId === s.runId)!.budgetBlocked,
    ).toBeDefined();
  }
  expect(e.store.list('usageAttempts')).toHaveLength(0);
});
it('shares each root allowance with its Batch descendants, keeping sides independent', () => {
  const { e, c } = setup(1, true);
  const samples = e.testbench.report({ id: c.id }).samples;
  for (const s of samples) {
    const w = e.available(s.runId!)[0];
    const claim = e.claim(w.id, worker);
    e.submit(claim.id, claim.token!, {});
    expect(e.available(s.runId!)).toHaveLength(0);
    expect(e.budgets.read(s.runId!).governing[0].state).toBe('blocked');
  }
  expect(e.store.list('usageAttempts')).toHaveLength(2);
});
it('binds sample budgets into confirmation and rejects partial descendant scope', () => {
  const { e, q } = setup(1);
  const before = e.testbench.preview(q);
  expect(() =>
    e.testbench.start({
      ...q,
      sampleBudget: { ...q.sampleBudget, limits: { claims: { max: 2 } } },
      confirmation: before.confirmation,
      requestId: crypto.randomUUID(),
    }),
  ).toThrow('preview changed');
  expect(() =>
    e.testbench.preview({
      ...q,
      sampleBudget: { ...q.sampleBudget, scope: 'run' },
    }),
  ).toThrow('tree scope');
});

it('keeps captured budgets on delayed roots after reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-comparison-budgets-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const f = setup(1, false, path, { repetitions: 2, concurrency: 1 });
  let e = f.e;
  const first = e.claim(e.available()[0].id, worker);
  e.submit(first.id, first.token!, {});
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  for (let i = 0; i < 3; i++) {
    const claim = e.claim(e.available()[0].id, worker);
    expect(e.budgets.read(claim.runId).budget).toEqual(f.q.sampleBudget);
    e.submit(claim.id, claim.token!, {});
  }
  expect(e.testbench.report({ id: f.c.id }).status).toBe('completed');
  expect(e.store.list('usageAttempts')).toHaveLength(4);
});
