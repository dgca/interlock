import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import type { Json, SimulationFixture } from '@interlock/core';
import { importWorkflows } from '../packages/runtime/src/transfer';
import allNodes from '../workflows/all-nodes.json';
import evaluate from '../workflows/evaluate.json';

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
    if (r.state !== 'running') return r;
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
});
