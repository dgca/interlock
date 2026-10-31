import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
  type WorkflowComparison,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [],
  stores: Store[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'configuration-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const store = new Store(path),
    engine = new Engine(store, process.cwd());
  stores.push(store);
  engines.push(engine);
  return { store, engine, api: appRouter.createCaller({ engine }) };
}
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function publish(e: Engine, definition: WorkflowDefinition) {
  const w = e.create('Fixture', '', definition);
  e.publish(w.id);
  return w.id;
}
function fixture() {
  const { engine, store, api } = setup();
  const prompt = engine.prompts.create({
    name: 'Shared',
    description: '',
    content: 'Old instructions',
  });
  const d = blankDefinition();
  if (d.nodes[1].kind !== 'agent') throw Error('Agent');
  d.nodes[1].promptIds = [prompt.id];
  d.nodes[1].maxAttempts = 1;
  const workflowId = publish(engine, d);
  engine.publish(workflowId);
  engine.prompts.update(prompt.id, 1, {
    name: 'Shared',
    description: '',
    content: 'New instructions',
  });
  const suite = engine.testbench.createSuite({
    workflowId,
    content: { name: 'Cases', cases: [{ id: 'a', name: 'A', input: {} }] },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    concurrency: 1,
    configurations: {
      baseline: { promptRevisions: [{ id: prompt.id, revision: 1 }] },
      candidate: { promptRevisions: [{ id: prompt.id, revision: 2 }] },
    },
  };
  return { engine, store, api, prompt, workflowId, selection };
}
function start(
  e: Engine,
  selection: Parameters<Engine['testbench']['preview']>[0],
) {
  const preview = e.testbench.preview(selection);
  return e.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: crypto.randomUUID(),
  });
}
function drain(
  e: Engine,
  inspect: (w: ReturnType<Engine['claim']>) => void = () => {},
) {
  e.pump();
  let n = 0;
  while (e.available().length && n++ < 100) {
    const claim = e.claim(e.available()[0].id, worker);
    inspect(claim);
    e.submit(claim.id, claim.token!, e.run(claim.runId).input);
  }
  expect(n).toBeLessThan(100);
}

it('captures distinct old/new revisions without changing shared prompts or ordinary starts', () => {
  const { engine: e, prompt, workflowId, selection, store } = fixture();
  const before = store.list('prompts');
  const preview = e.testbench.preview(selection);
  expect(preview.configurations!.baseline.prompts[0]).toMatchObject({
    id: prompt.id,
    revision: 1,
  });
  expect(preview.configurations!.candidate.prompts[0]).toMatchObject({
    id: prompt.id,
    revision: 2,
  });
  expect(preview.configurations!.differences.prompts).toEqual([prompt.id]);
  expect(JSON.stringify(preview)).not.toContain('Old instructions');
  const c = start(e, selection);
  e.prompts.update(prompt.id, 2, {
    name: 'Shared',
    description: '',
    content: 'Later instructions',
  });
  const seen: string[] = [];
  drain(e, (work) => seen.push(work.savedPrompts![0].content));
  expect(seen).toEqual(['Old instructions', 'New instructions']);
  const report = e.testbench.report({ id: c.id });
  expect(report.configurationIds).toEqual({
    baseline: preview.configurations!.baseline.id,
    candidate: preview.configurations!.candidate.id,
  });
  expect(JSON.stringify(report)).not.toContain('instructions');
  const ordinary = e.start(workflowId, {}).run;
  expect(e.available(ordinary.id)[0].savedPrompts![0].content).toBe(
    'Later instructions',
  );
  expect(before).toHaveLength(1);
  expect(store.list('prompts')).toHaveLength(1);
});

it('requires exact complete transitive prompt selections, including an explicit empty manifest', () => {
  const { engine: e, selection, prompt } = fixture();
  for (const manifest of [
    [],
    [{ id: 'unrelated', revision: 1 }],
    [
      { id: prompt.id, revision: 1 },
      { id: prompt.id, revision: 2 },
    ],
  ]) {
    expect(() =>
      e.testbench.preview({
        ...selection,
        configurations: { baseline: { promptRevisions: manifest } },
      }),
    ).toThrow('exactly once');
  }
  expect(() =>
    e.testbench.preview({
      ...selection,
      configurations: {
        baseline: { promptRevisions: [{ id: prompt.id, revision: 99 }] },
      },
    }),
  ).toThrow('revision 99');
  const child = publish(e, blankDefinition()),
    root = publish(e, workflowCall(child));
  const suite = e.testbench.createSuite({
    workflowId: root,
    content: { name: 'No prompts', cases: [{ id: 'a', name: 'A', input: {} }] },
  });
  expect(
    e.testbench.preview({
      suiteId: suite.id,
      suiteRevision: 1,
      baselineVersion: 1,
      candidateVersion: 1,
      configurations: { baseline: { promptRevisions: [] } },
    }).canStart,
  ).toBe(true);
});

it('fingerprints selected metadata and pins, while explicit revisions ignore unrelated current edits', () => {
  const { engine: e, selection, prompt, workflowId, store } = fixture();
  const preview = e.testbench.preview(selection);
  e.prompts.update(prompt.id, 2, {
    name: 'Shared',
    description: '',
    content: 'Later',
  });
  expect(e.testbench.preview(selection).confirmation).toBe(
    preview.confirmation,
  );
  const requested = {
    ...selection,
    confirmation: preview.confirmation,
    requestId: 'stable',
  };
  expect(() =>
    e.testbench.start({
      ...requested,
      configurations: {
        ...selection.configurations,
        candidate: {
          ...selection.configurations.candidate,
          executor: { model: 'different' },
        },
      },
    }),
  ).toThrow('preview changed');
  expect(store.list('comparisons')).toEqual([]);
  const c = e.testbench.start(requested);
  expect(e.testbench.start(requested).id).toBe(c.id);
  expect(() =>
    e.testbench.start({ ...requested, configurations: undefined }),
  ).toThrow('different arguments');
  const defaultPlan = { ...selection, configurations: undefined };
  const p = e.testbench.preview(defaultPlan);
  e.prompts.update(prompt.id, 3, {
    name: 'Shared',
    description: '',
    content: 'Newest',
  });
  expect(() =>
    e.testbench.start({
      ...defaultPlan,
      confirmation: p.confirmation,
      requestId: 'current',
    }),
  ).toThrow('preview changed');
  const version = store.getVersion(workflowId, 1)!;
  store.version({
    ...version,
    definition: { ...version.definition, maxSteps: 99 },
  });
  expect(e.testbench.preview(selection).confirmation).not.toBe(
    preview.confirmation,
  );
});

it.each(['wait', 'detached'] as const)(
  'retains each side through queued roots, Batch items, %s children and restart',
  (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'interlock-configurations-'));
    dirs.push(dir);
    const path = join(dir, 'db.sqlite');
    const first = setup(path),
      e = first.engine;
    const prompt = e.prompts.create({
      name: 'Instructions',
      description: '',
      content: 'Old',
    });
    const d = blankDefinition();
    if (d.nodes[1].kind !== 'agent') throw Error('Agent');
    d.nodes[1].promptIds = [prompt.id];
    const child = publish(e, d);
    const batch = batchDefinition(
      nodeSchema.parse({ ...workflowCall(child, mode).nodes[1], id: 'invoke' }),
    );
    batch.nodes.push(nodeSchema.parse({ ...d.nodes[1], id: 'rootAgent' }));
    batch.edges.find((x) => x.source === 'entry')!.target = 'rootAgent';
    batch.edges.push({
      id: 'root-batch',
      source: 'rootAgent',
      target: 'batch',
      port: 'default',
    });
    const root = publish(e, batch);
    e.prompts.update(prompt.id, 1, {
      name: 'Instructions',
      description: '',
      content: 'New',
    });
    const suite = e.testbench.createSuite({
      workflowId: root,
      content: {
        name: 'Trials',
        cases: [{ id: 'a', name: 'A', input: [1, 2] }],
      },
    });
    const c = start(e, {
      suiteId: suite.id,
      suiteRevision: 1,
      baselineVersion: 1,
      candidateVersion: 1,
      repetitions: 2,
      concurrency: 1,
      configurations: {
        baseline: { promptRevisions: [{ id: prompt.id, revision: 1 }] },
        candidate: { promptRevisions: [{ id: prompt.id, revision: 2 }] },
      },
    });
    e.pump();
    const firstRun = e.testbench.report({ id: c.id }).samples[0].runId;
    e.prompts.update(prompt.id, 2, {
      name: 'Instructions',
      description: '',
      content: 'Latest',
    });
    // Selected captures must survive loss of the original revision documents too.
    first.store.remove('promptRevisions', `${prompt.id}:1`);
    first.store.remove('promptRevisions', `${prompt.id}:2`);
    e.stop();
    engines.splice(engines.indexOf(e), 1);
    first.store.close();
    stores.splice(stores.indexOf(first.store), 1);
    const { engine: resumed } = setup(path);
    let count = 0;
    drain(resumed, (work) => {
      count++;
      const run = resumed.run(work.runId);
      expect(work.savedPrompts![0].content).toBe(
        run.comparison!.side === 'baseline' ? 'Old' : 'New',
      );
    });
    expect(count).toBe(12);
    expect(resumed.testbench.report({ id: c.id }).samples[0].runId).toBe(
      firstRun,
    );
    expect(resumed.testbench.report({ id: c.id }).status).toBe('completed');
  },
);

it('reads bounded retained revision history, including deleted prompts, without changing current saves', async () => {
  const { engine: e, api, prompt } = fixture();
  const historical = await api.prompts.get({
    id: prompt.id,
    revision: 1,
    history: { limit: 1 },
  });
  expect(historical.content).toBe('Old instructions');
  expect(historical.id).toBe(prompt.id);
  expect(historical.currentRevision).toBe(2);
  expect(historical.history).toMatchObject({
    total: 2,
    items: [{ revision: 2, name: 'Shared' }],
    nextOffset: 1,
  });
  expect(historical).not.toHaveProperty('promptId');
  expect(() => e.prompts.update(prompt.id, 1, historical)).toThrow(
    'changed elsewhere',
  );
  const unused = e.prompts.create({
    name: 'Unused',
    description: '',
    content: 'Retained',
  });
  e.prompts.delete(unused.id);
  expect((await api.prompts.get({ id: unused.id, revision: 1 })).content).toBe(
    'Retained',
  );
  expect(
    (await api.prompts.get({ id: unused.id, revision: 1 })).currentRevision,
  ).toBeNull();
  await expect(api.prompts.get({ id: unused.id })).rejects.toThrow(
    'does not exist',
  );
  const next = await api.prompts.get({
    id: prompt.id,
    history: { offset: 1, limit: 1 },
  });
  expect(next.history!.items[0].revision).toBe(1);
  expect(next.history!.nextOffset).toBeNull();
});

it('rejects lost revisions and oversized combined captures before allocating work', () => {
  const { engine: e, selection, store, prompt } = fixture();
  store.remove('promptRevisions', `${prompt.id}:1`);
  expect(() => e.testbench.preview(selection)).toThrow(
    'revision 1 is unavailable',
  );
  expect(store.runs()).toEqual([]);
  e.prompts.update(prompt.id, 2, {
    name: 'Shared',
    description: '',
    content: 'X'.repeat(600_000),
  });
  e.prompts.update(prompt.id, 3, {
    name: 'Shared',
    description: '',
    content: 'Y'.repeat(600_000),
  });
  const oversized = {
    ...selection,
    configurations: {
      baseline: { promptRevisions: [{ id: prompt.id, revision: 3 }] },
      candidate: { promptRevisions: [{ id: prompt.id, revision: 4 }] },
    },
  };
  expect(() => e.testbench.preview(oversized)).toThrow('1 MiB');
  expect(store.list('comparisons')).toEqual([]);
  // Equal selections share one body and retain the previous 1 MiB allowance.
  expect(
    e.testbench.preview({
      ...selection,
      configurations: {
        baseline: oversized.configurations.baseline,
        candidate: oversized.configurations.baseline,
      },
    }).canStart,
  ).toBe(true);
});

it('allows one explicit side while the other captures current revisions', () => {
  const { engine: e, selection } = fixture();
  const c = start(e, {
    ...selection,
    configurations: { baseline: selection.configurations.baseline },
  });
  const seen: string[] = [];
  drain(e, (w) => seen.push(w.savedPrompts![0].content));
  expect(seen).toEqual(['Old instructions', 'New instructions']);
  expect(
    e.testbench.report({ id: c.id }).configurations!.candidate.promptSource,
  ).toBe('current');
});

it('rejects a root-only manifest when a child requires a different prompt', () => {
  const { engine: e, selection, prompt } = fixture();
  const childPrompt = e.prompts.create({
    name: 'Child',
    description: '',
    content: 'Child instructions',
  });
  const childDef = blankDefinition();
  if (childDef.nodes[1].kind !== 'agent') throw Error('Agent');
  childDef.nodes[1].promptIds = [childPrompt.id];
  const child = publish(e, childDef);
  const rootDef = workflowCall(child, 'wait', true);
  const after = rootDef.nodes.find((n) => n.id === 'after');
  if (after?.kind !== 'agent') throw Error('Agent');
  after.promptIds = [prompt.id];
  const root = publish(e, rootDef);
  const suite = e.testbench.createSuite({
    workflowId: root,
    content: { name: 'Transitive', cases: [{ id: 'a', name: 'A', input: {} }] },
  });
  expect(() =>
    e.testbench.preview({
      ...selection,
      suiteId: suite.id,
      baselineVersion: 1,
      candidateVersion: 1,
    }),
  ).toThrow('each transitive');
});

it('updates measured attribution from late observer receipts without absorbing retry declarations', () => {
  const { engine: e, selection } = fixture();
  const c = start(e, {
    ...selection,
    configurations: {
      baseline: {
        ...selection.configurations.baseline,
        executor: { model: 'expected' },
      },
    },
  });
  e.pump();
  const claim = e.claim(e.available()[0].id, {
    ...worker,
    modelSelection: { model: 'expected' },
  });
  e.usage.report({
    workId: claim.id,
    attempt: claim.attempt,
    token: claim.token!,
    snapshot: {
      sequence: 1,
      final: false,
      models: [{ provider: 'test', model: 'expected', inputTokens: 1 }],
    },
  });
  e.reportFailure(claim.id, claim.token!, 'Trial failed');
  drain(e);
  const read = () => e.testbench.report({ id: c.id });
  expect(read().samples[0].metrics.executorConditions).toMatchObject({
    state: 'unknown',
    declared: { state: 'matched' },
    reported: { state: 'unknown' },
  });
  e.usage.report({
    workId: claim.id,
    attempt: claim.attempt,
    source: 'observer',
    snapshot: {
      sequence: 1,
      final: true,
      models: [{ provider: 'test', model: 'expected', inputTokens: 1 }],
    },
  });
  expect(read().samples[0].metrics.executorConditions.state).toBe('matched');
  const root = e.run(claim.runId);
  e.retry(root.id);
  const retry = e.claim(e.available(root.id)[0].id, {
    ...worker,
    modelSelection: { model: 'retry-model' },
  });
  e.submit(retry.id, retry.token!, {});
  expect(read().samples[0].metrics.executorConditions.state).toBe('matched');
});

it('distinguishes requests, declarations and usage, retaining unknown profile/environment claims', () => {
  const { engine: e, selection, store } = fixture();
  const input = {
    ...selection,
    configurations: {
      baseline: {
        ...selection.configurations.baseline,
        executor: { provider: 'fixture', model: 'expected' },
        environment: { identity: 'worktree-a', receipt: 'receipt:a' },
      },
      candidate: {
        ...selection.configurations.candidate,
        executor: { profile: 'local', model: 'expected' },
      },
    },
  };
  const c = start(e, input);
  e.pump();
  const claim = e.claim(e.available()[0].id, {
    ...worker,
    modelSelection: { provider: 'fixture', model: 'expected' },
  });
  e.usage.report({
    workId: claim.id,
    attempt: claim.attempt,
    token: claim.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [{ provider: 'fixture', model: 'other', inputTokens: 1 }],
    },
  });
  e.submit(claim.id, claim.token!, {});
  drain(e);
  const r = e.testbench.report({ id: c.id, metricsDetail: 'full' });
  expect(r.samples[0].metrics.executorConditions.declared.state).toBe(
    'matched',
  );
  expect(r.samples[0].metrics.executorConditions.reported.state).toBe(
    'mismatch',
  );
  expect(r.samples[1].metrics.executorConditions.state).toBe('unknown');
  expect(r.metrics.availability.reasons).toEqual(
    expect.arrayContaining([
      'executor_configuration_mismatch',
      'executor_configuration_unknown',
      'environment_unverified',
    ]),
  );
  expect(r.configurations!.baseline.environment).toEqual(
    input.configurations.baseline.environment,
  );
  expect(
    JSON.stringify(r.samples[0].metrics.executorConditions.actual),
  ).toContain('other');
  expect(r.metrics.sides.baseline.executorConditions.mismatched).toBe(1);
  expect(r.metrics.sides.candidate.executorConditions.unknown).toBe(1);
  const compact = e.testbench.report({ id: c.id });
  expect(compact.samples[0].metrics.executorConditions).not.toHaveProperty(
    'actual',
  );
  const legacy = store.get<WorkflowComparison>('comparisons', c.id)!;
  delete legacy.configurations;
  store.put('comparisons', legacy);
  expect(e.testbench.report({ id: c.id }).configurations).toBeNull();
});
