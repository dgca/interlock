import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import previousRelease from './fixtures/testbench-previous-release.json';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  testAssertionSchema,
  type Run,
  type WorkflowDefinition,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import { workflowCall } from './fixtures/detached';
import { batchDefinition, itemScript } from './fixtures/batch';
import { exportWorkflows } from '../packages/runtime/src/transfer';

const stores: Store[] = [],
  engines: Engine[] = [],
  directories: string[] = [];
const worker = {
  workerId: 'testbench',
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
  vi.restoreAllMocks();
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function publish(
  engine: Engine,
  name = 'Research',
  definition = blankDefinition(),
) {
  const w = engine.create(name, '', definition);
  engine.publish(w.id);
  engine.publish(w.id);
  return w.id;
}
function content(
  cases: any[] = [
    {
      id: 'case',
      name: 'Representative',
      input: { topic: 'A' },
      assertions: [],
    },
  ],
) {
  return { name: 'Research checks', cases };
}
function plan(
  engine: Engine,
  options: {
    workflowId?: string;
    cases?: any[];
    concurrency?: number;
    repetitions?: number;
    baselineVersion?: number;
    candidateVersion?: number;
  } = {},
) {
  const workflowId = options.workflowId ?? publish(engine);
  const suite = engine.testbench.createSuite({
    workflowId,
    content: content(options.cases),
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: options.baselineVersion ?? 1,
    candidateVersion: options.candidateVersion ?? 2,
    repetitions: options.repetitions ?? 1,
    concurrency: options.concurrency ?? 2,
  };
  const preview = engine.testbench.preview(selection),
    request = {
      ...selection,
      confirmation: preview.confirmation,
      requestId: `request-${suite.id}`,
    };
  return { workflowId, suite, selection, preview, request };
}
function launch(engine: Engine, options: Parameters<typeof plan>[1] = {}) {
  const p = plan(engine, options),
    comparison = engine.testbench.start(p.request);
  engine.pump();
  return { ...p, id: comparison.id };
}
function report(engine: Engine, id: string, extra = {}) {
  return engine.testbench.report({ id, ...extra });
}
function complete(engine: Engine, output: any = { ok: true }) {
  let rounds = 0;
  while (engine.available().length && rounds++ < 1000) {
    const w = engine.available()[0],
      c = engine.claim(w.id, worker);
    engine.submit(
      c.id,
      c.token!,
      typeof output === 'function' ? output(c, engine.run(c.runId)) : output,
    );
  }
  if (rounds >= 1000) throw new Error('Unbounded test work');
}
function state(store: Store) {
  return Object.fromEntries(
    [
      'workflows',
      'versions',
      'deletedVersions',
      'runs',
      'work',
      'events',
      'prompts',
      'promptRevisions',
      'testSuites',
      'comparisons',
    ].map((c) => [c, store.list(c)]),
  );
}
async function eventually(check: () => void) {
  let last: unknown;
  for (let i = 0; i < 150; i++) {
    try {
      check();
      return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw last;
}

it('captures source input only, validates bounds, revisions and no-op saves, and retains input after source deletion', async () => {
  const { engine, store, api } = setup(),
    workflowId = publish(engine);
  const run = engine.start(workflowId, { saved: 'input' }).run;
  complete(engine, { privateOutput: 'not copied' });
  const before = state(store);
  for (const cases of [
    [],
    [{ id: 'a', name: 'A' }],
    [{ id: 'a', name: 'A', input: null, sourceRunId: run.id }],
    [{ id: 'a', name: 'A', input: 'x'.repeat(65537) }],
    [
      { id: 'a', name: 'A', input: null },
      { id: 'a', name: 'B', input: null },
    ],
  ])
    await expect(
      api.testbench.createSuite({ workflowId, content: content(cases) }),
    ).rejects.toThrow();
  await expect(
    api.testbench.createSuite({
      workflowId,
      content: content([{ id: 'a', name: 'A', sourceRunId: 'missing' }]),
    }),
  ).rejects.toThrow('Source run');
  expect(state(store)).toEqual(before);
  const suite = await api.testbench.createSuite({
    workflowId,
    content: content([{ id: 'a', name: 'A', sourceRunId: run.id }]),
  });
  expect(suite.cases[0].input).toEqual({ saved: 'input' });
  expect(suite.cases[0].source).toMatchObject({
    runId: run.id,
    workflowId,
    version: 2,
  });
  expect(JSON.stringify(suite)).not.toContain('privateOutput');
  expect(JSON.stringify(suite)).not.toContain('token');
  const explicit = content([{ id: 'a', name: 'A', input: { saved: 'input' } }]);
  const updated = engine.testbench.updateSuite({
    id: suite.id,
    revision: 1,
    content: explicit,
  });
  expect(updated.revision).toBe(2);
  const snapshot = state(store);
  expect(
    engine.testbench.updateSuite({
      id: suite.id,
      revision: 2,
      content: explicit,
    }),
  ).toEqual(updated);
  expect(state(store)).toEqual(snapshot);
  expect(() =>
    engine.testbench.updateSuite({
      id: suite.id,
      revision: 1,
      content: explicit,
    }),
  ).toThrow('Suite changed');
  expect(state(store)).toEqual(snapshot);
  store.remove('runs', run.id);
  expect(engine.testbench.getSuite(suite.id).cases[0].input).toEqual({
    saved: 'input',
  });
  expect(engine.testbench.listSuites({}).items[0]).not.toHaveProperty('cases');
});

it('rejects malformed assertions and unsupported or missing nodes/ports and input contracts before execution', () => {
  const { engine, store } = setup();
  for (const check of [
    { kind: 'output', operator: 'gte', expected: 'bad' },
    { kind: 'output', operator: 'equals' },
    { kind: 'route', nodeId: 'agent', visit: 0, port: 'default' },
    { kind: 'output', operator: 'exists', expected: null },
  ])
    expect(() => testAssertionSchema.parse(check)).toThrow();
  const definition = blankDefinition();
  definition.inputSchema = {
    type: 'object',
    required: ['required'],
    properties: { required: { type: 'boolean' } },
  };
  const wf = publish(engine, 'Contracts', definition);
  const p = plan(engine, {
    workflowId: wf,
    cases: [
      {
        id: 'a',
        name: 'A',
        input: {},
        assertions: [
          { kind: 'route', nodeId: 'missing', visit: 1, port: 'default' },
        ],
      },
    ],
  });
  expect(p.preview.canStart).toBe(false);
  expect(p.preview.blockers.join(' ')).toContain('does not exist');
  expect(p.preview.blockers.join(' ')).toContain('required');
  const before = state(store);
  expect(() => engine.testbench.start(p.request)).toThrow();
  expect(state(store)).toEqual(before);
  const batch = publish(engine, 'Batch', batchDefinition());
  const nested = plan(engine, {
    workflowId: batch,
    cases: [
      {
        id: 'a',
        name: 'A',
        input: [],
        assertions: [{ kind: 'output', nodeId: 'work', operator: 'exists' }],
      },
    ],
  });
  expect(nested.preview.blockers.join(' ')).toContain('Batch-member');
  const invalidPort = plan(engine, {
    cases: [
      {
        id: 'a',
        name: 'A',
        input: null,
        assertions: [
          { kind: 'route', nodeId: 'agent', visit: 1, port: 'missing' },
        ],
      },
    ],
  });
  expect(invalidPort.preview.canStart).toBe(false);
  const valid = launch(engine, {
    workflowId: wf,
    cases: [
      {
        id: 'a',
        name: 'A',
        input: { required: true },
        assertions: [
          { kind: 'route', nodeId: 'agent', visit: 1, port: 'default' },
        ],
      },
    ],
  });
  complete(engine);
  expect(report(engine, valid.id).checkCounts.pass).toBe(2);
});

it('rejects stale suite or prompt preview and conflicting requests, recovers identical delivery without duplicate runs', () => {
  const { engine, store } = setup();
  const p = plan(engine);
  const changed = content([
    { id: 'case', name: 'Representative', input: { different: true } },
  ]);
  engine.testbench.updateSuite({
    id: p.suite.id,
    revision: 1,
    content: changed,
  });
  const before = state(store);
  expect(() => engine.testbench.start(p.request)).toThrow('revision');
  expect(state(store)).toEqual(before);
  const prompt = engine.prompts.create({
    name: 'Guidance',
    content: 'Original',
    description: '',
  });
  const d = blankDefinition();
  (d.nodes[1] as any).promptIds = [prompt.id];
  const wf = publish(engine, 'Prompt', d),
    q = plan(engine, { workflowId: wf });
  engine.prompts.update(prompt.id, 1, {
    name: 'Guidance',
    content: 'Changed',
    description: '',
  });
  const current = state(store);
  expect(() => engine.testbench.start(q.request)).toThrow('preview changed');
  expect(state(store)).toEqual(current);
  const fresh = engine.testbench.preview(q.selection),
    request = { ...q.request, confirmation: fresh.confirmation };
  const first = engine.testbench.start(request);
  engine.pump();
  const after = state(store);
  expect(engine.testbench.start(request).id).toBe(first.id);
  expect(state(store)).toEqual(after);
  expect(() => engine.testbench.start({ ...request, concurrency: 1 })).toThrow(
    'different arguments',
  );
  expect(state(store)).toEqual(after);
});

it('evaluates repeated cases with separate checks and append-only quality', () => {
  const { engine, store } = setup();
  const c = launch(engine, {
    repetitions: 2,
    cases: [
      {
        id: 'a',
        name: 'A',
        input: null,
        assertions: [
          {
            kind: 'output',
            operator: 'equals',
            path: 'value',
            expected: { a: 1, b: 2 },
          },
          { kind: 'output', operator: 'exists', path: 'nil' },
          { kind: 'output', operator: 'gte', path: 'score', expected: 5 },
          { kind: 'output', operator: 'exists', path: 'missing' },
          { kind: 'output', nodeId: 'agent', visit: 2, operator: 'exists' },
        ],
      },
    ],
  });
  complete(engine, (_work: any, run: Run) => ({
    value: { b: 2, a: 1 },
    nil: null,
    score: run.comparison!.side === 'baseline' ? 6 : 3,
  }));
  const result = report(engine, c.id, { checkLimit: 10 });
  expect(result.status).toBe('completed');
  expect(result.total).toBe(4);
  expect(result.executionErrors).toBe(0);
  expect(result.checkCounts).toEqual({ pass: 10, fail: 6, unknown: 4 });
  const sample = result.samples[0];
  expect(sample.observation!.checkTotal).toBe(5);
  expect(
    sample.observation!.checks.find((c) => c.status === 'unknown')!.reason,
  ).toContain('did not execute');
  const quality = {
    id: c.id,
    sampleId: sample.id,
    reviewer: 'Owner',
    reviewerKind: 'human' as const,
    rubric: 'Accuracy and usefulness',
    score: 4,
    notes: 'Good evidence',
  };
  engine.testbench.judge(quality);
  engine.testbench.judge({
    ...quality,
    reviewer: 'Review agent',
    reviewerKind: 'agent',
    score: 3,
  });
  expect(report(engine, c.id).judgments.map((j) => j.reviewerKind)).toEqual([
    'human',
    'agent',
  ]);
  expect(report(engine, c.id).checkCounts).toEqual(result.checkCounts);
  const before = state(store);
  expect(() => engine.testbench.judge({ ...quality, rubric: '' })).toThrow();
  expect(state(store)).toEqual(before);
});

it('bounds root count, active comparisons and global tree concurrency with successful release controls', () => {
  const { engine, store } = setup();
  const tooBig = plan(engine, {
    repetitions: 3,
    cases: Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      name: `Case ${i}`,
      input: null,
    })),
  });
  expect(tooBig.preview.rootRunCount).toBe(150);
  expect(tooBig.preview.canStart).toBe(false);
  const before = state(store);
  expect(() => engine.testbench.start(tooBig.request)).toThrow('100 root runs');
  expect(state(store)).toEqual(before);
  const first = launch(engine, { repetitions: 5, concurrency: 10 }),
    second = launch(engine, { repetitions: 5, concurrency: 10 });
  expect(
    store.runs().filter((r) => r.comparison && r.status === 'waiting'),
  ).toHaveLength(10);
  expect(report(engine, second.id).queued).toBe(10);
  const third = launch(engine),
    fourth = launch(engine);
  const fifth = plan(engine);
  const full = state(store);
  expect(() => engine.testbench.start(fifth.request)).toThrow(
    'Four comparisons',
  );
  expect(state(store)).toEqual(full);
  engine.testbench.cancel({ id: first.id });
  engine.pump();
  expect(report(engine, second.id).activeTrees).toBeGreaterThan(0);
  expect(engine.testbench.start(fifth.request).id).toBeTruthy();
  for (const c of [second, third, fourth])
    engine.testbench.cancel({ id: c.id });
});

it('holds detached slots and reports independent work after ordinary cancellation, with explicit detached cancellation', () => {
  const { engine, store } = setup(),
    child = publish(engine, 'Independent'),
    root = publish(engine, 'Supervisor', workflowCall(child, 'detached'));
  const c = launch(engine, {
    workflowId: root,
    repetitions: 2,
    concurrency: 1,
  });
  const initial = report(engine, c.id);
  expect(initial.activeTrees).toBe(1);
  expect(initial.queued).toBe(3);
  expect(initial.activeDetachedCount).toBe(1);
  expect(
    store.runs().find((r) => r.comparison && r.workflowId === root)!.status,
  ).toBe('completed');
  const cancelled = engine.testbench.cancel({ id: c.id });
  engine.pump();
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.activeDetachedCount).toBe(1);
  expect(report(engine, c.id).queued).toBe(0);
  expect(engine.run(cancelled.activeDetachedRunIds[0]).status).toBe('waiting');
  engine.testbench.cancel({ id: c.id, cancelDetached: true });
  engine.pump();
  expect(report(engine, c.id).activeDetachedCount).toBe(0);
  expect(report(engine, c.id).observed).toBe(4);
  const control = launch(engine, { workflowId: root, concurrency: 1 });
  complete(engine);
  expect(report(engine, control.id).status).toBe('completed');
  expect(report(engine, control.id).activeDetachedCount).toBe(0);
});

it('freezes current prompts across queued root, child and Batch dispatch while ordinary runs capture newer content', () => {
  const { engine } = setup();
  const prompt = engine.prompts.create({
      name: 'Shared',
      description: '',
      content: 'Version one',
    }),
    childDefinition = blankDefinition();
  (childDefinition.nodes[1] as any).promptIds = [prompt.id];
  const child = publish(engine, 'Child', childDefinition),
    root = publish(
      engine,
      'Batch root',
      batchDefinition(nodeSchema.parse({ ...workflowCall(child).nodes[1] })),
    );
  const c = launch(engine, {
    workflowId: root,
    concurrency: 1,
    cases: [{ id: 'a', name: 'Batch input', input: [1, 2, 3] }],
  });
  engine.prompts.update(prompt.id, 1, {
    name: 'Shared',
    description: '',
    content: 'Version two',
  });
  const prompts: string[] = [];
  complete(engine, (work: any) => {
    prompts.push(work.savedPrompts[0].content);
    return {};
  });
  expect(prompts).toHaveLength(6);
  expect(new Set(prompts)).toEqual(new Set(['Version one']));
  expect(report(engine, c.id).prompts[0].revision).toBe(1);
  const ordinary = engine.start(child, null).run;
  expect(engine.available(ordinary.id)[0].savedPrompts![0].content).toBe(
    'Version two',
  );
});

it('protects queued transitive version pins and workflow deletion until cancellation, then allows cleanup', () => {
  const { engine, store } = setup(),
    child = publish(engine, 'Dependency'),
    root = engine.create('Root', '', blankDefinition()).id;
  engine.publish(root);
  engine.update(root, {
    draft: workflowCall(child),
    draftRevision: engine.workflow(root).draftRevision,
  });
  engine.publish(root);
  const c = launch(engine, { workflowId: root, concurrency: 1 });
  expect(report(engine, c.id).queued).toBe(1);
  const versions = [
    { workflowId: child, version: 1 },
    { workflowId: root, version: 2 },
  ];
  engine.update(root, {
    draft: blankDefinition(),
    draftRevision: engine.workflow(root).draftRevision,
  });
  engine.publish(root);
  const preview = engine.versions.preview({ versions });
  expect(preview.blockers.length).toBeGreaterThan(0);
  expect(preview.blockers.every((b) => b.kind === 'comparison')).toBe(true);
  const before = state(store);
  expect(() =>
    engine.versions.delete({
      versions,
      confirmation: preview.confirmation,
      acknowledgeHistoryLoss: true,
    }),
  ).toThrow();
  expect(() => engine.deleteWorkflow(root)).toThrow('Active comparison');
  expect(state(store)).toEqual(before);
  engine.testbench.cancel({ id: c.id });
  engine.pump();
  const p = engine.versions.preview({ versions });
  expect(p.canDelete).toBe(true);
  engine.versions.delete({
    versions,
    confirmation: p.confirmation,
    acknowledgeHistoryLoss: true,
  });
  expect(store.getVersion(child, 1)).toBeUndefined();
});

it('persists queued identities/captures/case revisions across restart and never redispatches missing history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-testbench-'));
  directories.push(dir);
  const path = join(dir, 'db.sqlite');
  const { engine, store } = setup(path);
  const c = launch(engine, { repetitions: 2, concurrency: 1 });
  const first = report(engine, c.id).samples[0].runId!;
  engine.testbench.updateSuite({
    id: c.suite.id,
    revision: 1,
    content: content([
      { id: 'new', name: 'New case', input: { changed: true } },
    ]),
  });
  engine.stop();
  engines.splice(engines.indexOf(engine), 1);
  store.close();
  stores.splice(stores.indexOf(store), 1);
  const next = setup(path);
  next.engine.pump();
  expect(report(next.engine, c.id).samples[0].runId).toBe(first);
  expect(next.store.runs()).toHaveLength(1);
  for (const work of next.store.work().filter((w) => w.runId === first))
    next.store.remove('work', work.id);
  next.store.remove('runs', first);
  next.engine.pump();
  const missing = report(next.engine, c.id).samples[0];
  expect(missing.observation!.status).toBe('unavailable');
  expect(missing.historyAvailable).toBe(false);
  complete(next.engine);
  expect(report(next.engine, c.id).status).toBe('completed');
  expect(report(next.engine, c.id).suiteRevision).toBe(1);
  expect(next.store.runs()).toHaveLength(3);
  expect(next.engine.testbench.getSuite(c.suite.id).revision).toBe(2);
});

it('rolls back run allocation after a late injected write without launching external work, then succeeds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-testbench-rollback-'));
  directories.push(dir);
  const marker = join(dir, 'marker');
  const { engine, store } = setup();
  const d = blankDefinition();
  d.nodes[1] = itemScript(
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); return input;`,
  );
  d.nodes[1].id = 'agent';
  const wf = publish(engine, 'External action', d),
    p = plan(engine, { workflowId: wf });
  const c = engine.testbench.start(p.request);
  const before = state(store),
    put = store.put.bind(store);
  const spy = vi.spyOn(store, 'put').mockImplementation((collection, value) => {
    put(collection, value);
    if (collection === 'comparisons')
      throw new Error('injected comparison write');
  });
  expect(() => engine.pump()).toThrow('injected comparison write');
  expect(state(store)).toEqual(before);
  await new Promise((r) => setTimeout(r, 30));
  expect(existsSync(marker)).toBe(false);
  spy.mockRestore();
  engine.pump();
  await eventually(() => expect(report(engine, c.id).status).toBe('completed'));
  expect(existsSync(marker)).toBe(true);
});

it('reports execution failure separately from assertions and checks Batch failures without treating them as quality', async () => {
  const { engine } = setup();
  const wf = publish(
    engine,
    'Collect',
    batchDefinition(
      itemScript('if(input===2)throw new Error("bad item");return input;'),
      { failurePolicy: 'collect' },
    ),
  );
  const c = launch(engine, {
    workflowId: wf,
    cases: [
      {
        id: 'items',
        name: 'Items',
        input: [1, 2],
        assertions: [
          {
            kind: 'output',
            path: '1.status',
            operator: 'equals',
            expected: 'failed',
          },
        ],
      },
    ],
  });
  await eventually(() => expect(report(engine, c.id).status).toBe('completed'));
  const r = report(engine, c.id);
  expect(r.executionErrors).toBe(0);
  expect(r.checkCounts.pass).toBe(2);
  expect(r.samples[0].observation!.descendantErrorTotal).toBe(1);
  expect(r.judgmentCount).toBe(0);
  const failed = blankDefinition();
  failed.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Fail',
    language: 'javascript',
    command: 'throw new Error("failed");',
  });
  const other = launch(engine, {
    workflowId: publish(engine, 'Failure', failed),
    cases: [
      {
        id: 'fail',
        name: 'Fail',
        input: null,
        assertions: [{ kind: 'output', path: 'value', operator: 'exists' }],
      },
    ],
  });
  await eventually(() =>
    expect(report(engine, other.id).executionErrors).toBe(2),
  );
  expect(report(engine, other.id).checkCounts).toEqual({
    pass: 0,
    fail: 0,
    unknown: 2,
  });
});

it('pages compact reports and comparisons without inputs, outputs, tokens or prompt bodies; removes local experiments with workflow', () => {
  const { engine, store } = setup();
  const c = launch(engine, { repetitions: 2 });
  complete(engine, { secretOutput: 'hidden' });
  const r = report(engine, c.id, { limit: 1 });
  expect(r.samples).toHaveLength(1);
  expect(r.total).toBe(4);
  expect(JSON.stringify(r)).not.toContain('secretOutput');
  expect(JSON.stringify(r)).not.toContain('topic');
  expect(JSON.stringify(r)).not.toContain('token');
  expect(report(engine, c.id, { offset: 1, limit: 1 }).samples[0].id).not.toBe(
    r.samples[0].id,
  );
  expect(engine.testbench.list({ limit: 1 }).total).toBe(1);
  const bundle = exportWorkflows(store, c.workflowId);
  expect(JSON.stringify(bundle)).not.toContain(c.suite.id);
  engine.deleteWorkflow(c.workflowId);
  expect(engine.testbench.list({}).total).toBe(0);
  expect(engine.testbench.listSuites({}).total).toBe(0);
});

it('retains a failed observation after a successful ordinary explicit retry', () => {
  const { engine } = setup();
  const definition = blankDefinition();
  (definition.nodes[1] as any).maxAttempts = 1;
  const c = launch(engine, {
    workflowId: publish(engine, 'Retry evidence', definition),
    concurrency: 1,
  });
  const first = engine.available()[0],
    claimed = engine.claim(first.id, worker);
  engine.reportFailure(claimed.id, claimed.token!, 'Original failure');
  complete(engine);
  const original = report(engine, c.id).samples[0].observation;
  expect(original!.status).toBe('failed');
  const firstRun = report(engine, c.id).samples[0].runId!;
  engine.retry(firstRun);
  complete(engine, { repaired: true });
  expect(engine.run(firstRun).status).toBe('completed');
  expect(report(engine, c.id).samples[0].observation).toEqual(original);
});

it.each(['comparison', 'global'] as const)(
  'rejects explicit retries at occupied %s capacity without mutation, then retries after release',
  (scope) => {
    const { engine, store } = setup();
    const definition = blankDefinition();
    (definition.nodes[1] as any).maxAttempts = 1;
    const c = launch(engine, {
      workflowId: publish(engine, 'Retry capacity', definition),
      concurrency: scope === 'comparison' ? 1 : 10,
      repetitions: scope === 'comparison' ? 1 : 5,
    });
    const claimed = engine.claim(engine.available()[0].id, worker);
    engine.reportFailure(claimed.id, claimed.token!, 'Failed sample');
    let other: ReturnType<typeof launch> | undefined;
    if (scope === 'global') other = launch(engine, { concurrency: 1 });
    const before = state(store),
      observation = report(engine, c.id).samples[0].observation;
    expect(report(engine, c.id).activeTrees).toBe(
      scope === 'comparison' ? 1 : 9,
    );
    expect(() => engine.retry(claimed.runId)).toThrow(
      scope === 'comparison'
        ? 'Comparison concurrency is full'
        : 'Global comparison concurrency is full',
    );
    expect(state(store)).toEqual(before);
    if (other) {
      engine.testbench.cancel({ id: other.id });
      engine.pump();
    } else complete(engine);
    engine.retry(claimed.runId);
    expect(report(engine, c.id).activeTrees).toBe(
      scope === 'comparison' ? 1 : 10,
    );
    complete(engine);
    expect(engine.run(claimed.runId).status).toBe('completed');
    expect(report(engine, c.id).samples[0].observation).toEqual(observation);
  },
);

it('retries a detached child inside its active comparison tree without consuming another slot', () => {
  const { engine, store } = setup(),
    childDefinition = blankDefinition();
  (childDefinition.nodes[1] as any).maxAttempts = 1;
  const child = publish(engine, 'Detached child', childDefinition),
    root = publish(
      engine,
      'Active parent',
      workflowCall(child, 'detached', true),
    );
  const c = launch(engine, { workflowId: root, concurrency: 1 });
  const childRun = store.runs().find((r) => r.workflowId === child)!;
  const work = engine.claim(engine.available(childRun.id)[0].id, worker);
  engine.reportFailure(work.id, work.token!, 'Child failure');
  expect(report(engine, c.id).activeTrees).toBe(1);
  expect(report(engine, c.id).queued).toBe(1);
  engine.retry(childRun.id);
  expect(engine.run(childRun.id).status).toBe('waiting');
  expect(report(engine, c.id).activeTrees).toBe(1);
  complete(engine);
  expect(report(engine, c.id).status).toBe('completed');
});

it('identifies captured assertions after suite edits and exposes large expectations only through explicit case reads', async () => {
  const { engine, api, store } = setup(),
    large = 'private-expectation'.repeat(1000);
  const c = launch(engine, {
    cases: [
      {
        id: 'case',
        name: 'Original',
        input: { original: true },
        qualityGuidance: 'Original rubric',
        assertions: [
          { kind: 'output', path: 'score', operator: 'gte', expected: 4 },
          { kind: 'output', path: 'text', operator: 'equals', expected: large },
        ],
      },
    ],
  });
  complete(engine, { score: 2, text: 'short' });
  engine.testbench.updateSuite({
    id: c.suite.id,
    revision: 1,
    content: content([
      {
        id: 'case',
        name: 'Edited',
        input: null,
        assertions: [
          { kind: 'output', path: 'score', operator: 'gte', expected: 1 },
        ],
      },
    ]),
  });
  const result = report(engine, c.id),
    checks = result.samples[0].observation!.checks;
  expect(result.suiteRevision).toBe(1);
  expect(checks[0]).toMatchObject({
    status: 'fail',
    assertion: { path: 'score', operator: 'gte', expected: 4 },
    assertionRef: { comparisonId: c.id, caseId: 'case', index: 0 },
  });
  expect(checks[1]).toMatchObject({
    status: 'fail',
    expectedOmitted: true,
    assertion: { path: 'text', operator: 'equals' },
  });
  expect(checks[1].assertion).not.toHaveProperty('expected');
  expect(JSON.stringify(result)).not.toContain(large);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(262144);
  const before = state(store);
  await expect(
    api.testbench.case({ id: c.id, caseId: 'missing' }),
  ).rejects.toThrow('case not found');
  await expect(
    api.testbench.case({ id: c.id, caseId: 'case', unexpected: true } as any),
  ).rejects.toThrow();
  expect(state(store)).toEqual(before);
  const captured = await api.testbench.case({
    id: c.id,
    caseId: checks[1].assertionRef.caseId,
  });
  expect(captured).toMatchObject({
    comparisonId: c.id,
    suiteRevision: 1,
    case: {
      name: 'Original',
      input: { original: true },
      qualityGuidance: 'Original rubric',
      assertions: [{ expected: 4 }, { expected: large }],
    },
  });
  expect(
    engine.testbench.getSuite(c.suite.id).cases[0].assertions[0],
  ).toMatchObject({ expected: 1 });
  expect(state(store)).toEqual(before);
});

it('caps report bytes with exact pagination across long quality notes', () => {
  const { engine } = setup(),
    c = launch(engine);
  complete(engine);
  const sample = report(engine, c.id).samples[0];
  for (let i = 0; i < 25; i++)
    engine.testbench.judge({
      id: c.id,
      sampleId: sample.id,
      reviewer: 'Agent',
      reviewerKind: 'agent',
      rubric: '🧪'.repeat(2000),
      score: 3,
      notes: '🧪'.repeat(2000),
    });
  const result = report(engine, c.id, { judgmentLimit: 25 });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(262144);
  expect(result.truncated).toBe(true);
  expect(result.judgmentCount).toBe(25);
  expect(result.nextJudgmentOffset).toBe(result.judgments.length);
  const next = report(engine, c.id, {
    judgmentOffset: result.nextJudgmentOffset,
    judgmentLimit: 25,
  });
  expect(next.judgments[0].id).not.toBe(result.judgments[0].id);
});

it('opens the published 0.1.18 database unchanged and preserves old claims and JavaScript/legacy Bash pins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-testbench-previous-'));
  directories.push(dir);
  const path = join(dir, 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(previousRelease.schema.join(';\n'));
  db.exec(
    'INSERT INTO migrations VALUES (1),(2),(3); INSERT INTO continuation_sequence VALUES (1,0);',
  );
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  db.close();
  const { engine, store } = setup(path);
  expect(store.migration).toEqual({ from: 3, to: 3 });
  for (const [collection, records] of Object.entries(previousRelease.documents))
    expect(store.list(collection)).toEqual(records);
  engine.pump();
  for (const [collection, records] of Object.entries(previousRelease.documents))
    expect(store.list(collection)).toEqual(records);
  const oldClaim = store.work().find((w) => w.status === 'claimed')!;
  engine.submit(oldClaim.id, 'testbench-fixture-token', { resumed: true });
  expect(engine.run(oldClaim.runId).status).toBe('completed');
  for (const language of ['javascript', 'legacy-bash']) {
    const workflow = store.workflows().find((w) => w.name.endsWith(language))!;
    const run = engine.start(workflow.id, { value: 7 }, 1).run;
    await eventually(() => expect(engine.run(run.id).status).toBe('completed'));
    expect(engine.run(run.id).output).toEqual(
      language === 'javascript' ? { previous: { value: 7 } } : { value: 7 },
    );
  }
  const workflow = store
    .workflows()
    .find((w) => w.name.endsWith('javascript'))!;
  const c = launch(engine, {
    workflowId: workflow.id,
    baselineVersion: 1,
    candidateVersion: 1,
  });
  await eventually(() => expect(report(engine, c.id).status).toBe('completed'));
  expect(report(engine, c.id).total).toBe(2);
  expect(store.list('versions')).toEqual(previousRelease.documents.versions);
});
