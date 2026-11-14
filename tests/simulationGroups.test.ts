import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  definitionSchema,
  type Json,
  type SimulationFixture,
} from '@interlock/core';
import { importWorkflows } from '../packages/runtime/src/transfer';
import allNodes from '../workflows/all-nodes.json';
import evaluate from '../workflows/evaluate.json';
import { parallelDefinition } from './fixtures/parallel';

// Kept apart from simulation.test.ts, which is at its size ceiling. These
// simulate bundled workflows that use Batch and Parallel end to end.
const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
});
type Report = {
  state: string;
  error?: string;
  unsupported: { items: string[] };
  substitutions: { items: { nodeId: string; executionId: string }[] };
  executions: {
    items: { executionId: string; item?: number; branch?: string }[];
  };
  coverage?: { untested: { edgeId: string }[] };
};
async function simulate(
  e: Engine,
  workflowId: string,
  input: Json,
  fixtures: SimulationFixture[],
) {
  const suite = e.testbench.createSuite({
    workflowId,
    content: {
      name: 'Groups',
      cases: [{ id: 'case', name: 'Case', input, fixtures, assertions: [] }],
    },
  });
  const requestId = crypto.randomUUID();
  e.simulations.request({
    action: 'run',
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId: 'case',
    version: e.workflow(workflowId).latestVersion,
    requestId,
  });
  for (let i = 0; i < 2000; i++) {
    const r = e.simulations.request({
      action: 'get',
      id: requestId,
      limit: 100,
    }) as unknown as Report;
    if (r.state !== 'running') return { ...r, requestId };
    await tick();
  }
  throw new Error('Simulation did not settle');
}
const engine = () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  return e;
};

it('simulates the evaluation Batch one item at a time with collected item failures', async () => {
  const e = engine();
  const w = e.create(
    evaluate.name,
    evaluate.description,
    evaluate.definition as Parameters<Engine['create']>[2],
  );
  e.publish(w.id);
  const sha256 = 'a'.repeat(64);
  const settings = {
    comparisonId: 'c',
    rubric: 'r',
    mode: 'review',
    outputPath: '',
    maxSamples: 2,
  } as const;
  const sample = (sampleId: string, mode: string) => ({
    ...settings,
    mode,
    evaluationRunId: 'e',
    sampleId,
    runId: `run-${sampleId}`,
    caseId: 'case',
    guidance: '',
    checks: [],
    evidence: [],
  });
  const grade = (sampleId: string) => ({
    rubric: 'r',
    mode: 'review',
    outputPath: '',
    evaluationRunId: 'e',
    sampleId,
    verdict: 'pass',
    score: 5,
    notes: '',
    evidence: [{ field: 'output', path: '', sha256 }],
    findings: [],
  });
  // Item 0 takes the review route, item 1 the checks route. With both items
  // running at once, item 1's Script would consume a fixture out of order.
  const report = await simulate(e, w.id, { comparisonId: 'c', rubric: 'r' }, [
    { nodeId: 'normalize', kind: 'script', output: settings },
    {
      nodeId: 'plan',
      kind: 'script',
      output: {
        ...settings,
        evaluationRunId: 'e',
        samples: [sample('s0', 'review'), sample('s1', 'checks_only')],
        skipped: [],
        remaining: 0,
      },
    },
    { nodeId: 'review', kind: 'agent', output: grade('s0') },
    {
      nodeId: 'record',
      kind: 'script',
      output: {
        sampleId: 's0',
        judgmentId: 'j',
        requestId: 'q',
        verdict: 'pass',
        score: 5,
        comparisonSampleCount: 2,
      },
    },
    { nodeId: 'checks', kind: 'script', output: grade('s1') },
    { nodeId: 'record', kind: 'script', error: 'recording failed' },
    { nodeId: 'summarize', kind: 'script', output: { recorded: 1 } },
  ]);
  expect(report.state, report.error ?? report.unsupported.items.join()).toBe(
    'passed',
  );
  expect(report.coverage!.untested).toEqual([]);
  const items = new Map(
    report.executions.items.map((x) => [x.executionId, x.item]),
  );
  expect(
    report.substitutions.items.map((s) => [s.nodeId, items.get(s.executionId)]),
  ).toEqual([
    ['normalize', undefined],
    ['plan', undefined],
    ['review', 0],
    ['record', 0],
    ['checks', 1],
    ['record', 1],
    ['summarize', undefined],
  ]);
});

it('simulates every Parallel branch, invoked children in Batch items and a detached call', async () => {
  const e = engine();
  importWorkflows(e.store, allNodes as Parameters<typeof importWorkflows>[1]);
  e.publish(allNodes.rootId);
  const mission = {
    mission: 'M',
    crew: ['Ada', 'Grace'],
    timing: 'duration',
    releaseAt: '',
  };
  const badges = [
    { name: 'Ada', badge: 'A' },
    { name: 'Grace', badge: 'G' },
  ];
  // Each Batch item runs its waited child workflow for real, so the child's
  // Script takes the item's next fixture.
  const item = (name: string, badge: string): SimulationFixture[] => [
    { nodeId: 'crew-name', kind: 'script', output: { name } },
    { nodeId: 'format', kind: 'script', output: { name, badge } },
  ];
  const report = await simulate(e, allNodes.rootId, {}, [
    { nodeId: 'prepare', kind: 'script', output: mission },
    {
      nodeId: 'fetch',
      kind: 'fetch',
      output: { status: 200, headers: {}, body: '' },
    },
    ...item('Ada', 'A'),
    ...item('Grace', 'G'),
    { nodeId: 'bash', kind: 'script', output: badges },
    { nodeId: 'badge-count', kind: 'script', output: 2 },
    { nodeId: 'badge-names', kind: 'script', output: true },
    {
      nodeId: 'dispatch',
      kind: 'workflow',
      output: {
        runId: 'captain',
        workflowId: 'interlock-all-nodes-demo-crew-badge',
        version: 1,
      },
    },
    { nodeId: 'agent', kind: 'agent', output: { mission: 'M', markdown: '' } },
  ]);
  expect(report.state, report.error ?? report.unsupported.items.join()).toBe(
    'passed',
  );
  // Only the routes this case does not choose stay untested: every Batch and
  // Parallel route, including each branch's start and return, is covered.
  expect(report.coverage!.untested.map((u) => u.edgeId).sort()).toEqual([
    'agent-timeout-agent-timeout',
    'agent-timeout-default-exit',
    'condition-false-not-ready',
    'not-ready-default-exit',
    'switch-poll-wait-poll',
    'switch-timestamp-wait-until',
    'wait-poll-default-crew',
    'wait-poll-timeout-not-ready',
    'wait-until-default-crew',
  ]);
  const steps = new Map(report.executions.items.map((x) => [x.executionId, x]));
  expect(
    report.substitutions.items
      .filter((s) => s.nodeId.startsWith('badge-'))
      .map((s) => steps.get(s.executionId)?.branch),
  ).toEqual(['count', 'allNamed']);
  expect(e.available()).toEqual([]);
});

// Small graphs for the saved-suite regressions below.
const script = (id: string, extra = {}) => ({
  id,
  kind: 'script',
  label: id,
  language: 'javascript',
  command: 'return input;',
  ...extra,
});
const call = (id: string, workflowId: string, mode = 'wait') => ({
  id,
  kind: 'workflow',
  label: id,
  workflowId,
  version: 1,
  mode,
});
function publish(e: Engine, name: string, middle: object[]) {
  const ids = middle.map((n) => (n as { id: string }).id);
  const w = e.create(
    name,
    '',
    definitionSchema.parse({
      nodes: [
        { id: 'entry', kind: 'entry', label: 'In' },
        ...middle,
        { id: 'exit', kind: 'exit', label: 'Out' },
      ],
      edges: [...ids, 'exit'].map((target, i, all) => ({
        id: `e${i}`,
        source: i ? all[i - 1] : 'entry',
        target,
      })),
    }),
  );
  e.publish(w.id);
  return w.id;
}
function batch(e: Engine, name: string) {
  const w = e.create(
    name,
    '',
    definitionSchema.parse({
      nodes: [
        { id: 'entry', kind: 'entry', label: 'In' },
        { id: 'items', kind: 'batch', label: 'Items', itemsPath: 'items' },
        script('a', { batchId: 'items' }),
        script('b', { batchId: 'items' }),
        { id: 'exit', kind: 'exit', label: 'Out' },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'items' },
        { id: 'item', source: 'items', port: 'item', target: 'a' },
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'end', source: 'b', target: 'items', targetHandle: 'end' },
        { id: 'out', source: 'items', port: 'complete', target: 'exit' },
      ],
    }),
  );
  e.publish(w.id);
  return w.id;
}

it('keeps suites for a detached call inside a waited child running that child', async () => {
  const e = engine();
  const leaf = publish(e, 'Leaf', [script('ls')]);
  const mid = publish(e, 'Mid', [call('call', leaf, 'detached')]);
  // The root's waited call shares the detached call's node ID.
  const root = publish(e, 'Root', [call('call', mid)]);
  const ran = await simulate(e, root, {}, [
    { nodeId: 'ls', kind: 'script', output: {} },
  ]);
  expect(ran.state, ran.error ?? ran.unsupported.items.join()).toBe('passed');
  const failed = await simulate(e, mid, {}, [
    { nodeId: 'call', kind: 'workflow', error: 'never' },
  ]);
  expect(failed.error).toMatch(/detached Workflow call cannot fail/);
});

it('accepts item-by-item and step-by-step fixture order for Batch items', async () => {
  const e = engine();
  const inner = batch(e, 'Inner');
  const outer = publish(e, 'Outer', [call('call', inner)]);
  const fixture = (nodeId: string, n: number): SimulationFixture => ({
    nodeId,
    kind: 'script',
    output: n,
  });
  const steps = [fixture('a', 0), fixture('a', 1), fixture('b', 0)];
  const items = [fixture('a', 0), fixture('b', 0), fixture('a', 1)];
  for (const [id, fixtures] of [
    [inner, [...steps, fixture('b', 1)]],
    [outer, [...steps, fixture('b', 1)]],
    [outer, [...items, fixture('b', 1)]],
  ] as const) {
    const r = await simulate(e, id, { items: [1, 2] }, [...fixtures]);
    expect(r.state, r.error ?? r.unsupported.items.join()).toBe('passed');
  }
});

it('simulates a first 1 of 3 join with the other branches cancelled', async () => {
  const e = engine();
  const w = e.create(
    'First of three',
    '',
    parallelDefinition({
      keys: ['spec', 'code', 'lint'],
      concurrency: 3,
      join: { joinAfter: 1 },
    }),
  );
  e.publish(w.id);
  const report = await simulate(e, w.id, {}, [
    { nodeId: 'r0', kind: 'agent', output: 'first' },
  ]);
  expect(report.state, report.error).toBe('passed');
  const capture = e.simulations.request({
    action: 'capture',
    id: report.requestId,
  }) as { result?: Json };
  expect(capture.result).toEqual({
    results: { spec: 'first' },
    branches: { spec: 'completed', code: 'cancelled', lint: 'cancelled' },
  });
  expect(
    report.executions.items
      .filter((x) => x.branch)
      .map((x) => [x.branch, (x as { status?: string }).status]),
  ).toEqual([
    ['spec', 'completed'],
    ['code', 'cancelled'],
    ['lint', 'cancelled'],
  ]);
  // Cancelled branches started but never returned to the join.
  expect(report.coverage!.untested.map((u) => u.edgeId)).toEqual([
    'join-r1',
    'join-r2',
  ]);
});
