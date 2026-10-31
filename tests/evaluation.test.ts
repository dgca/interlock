import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  validateDefinition,
  type WorkflowComparison,
  type Json,
  type WorkRequest,
} from '@interlock/core';

const starter = JSON.parse(readFileSync('workflows/evaluate.json', 'utf8'));
const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'fixture',
  freshContext: false,
  tools: [],
  skills: [],
};
function engine(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function close(e: Engine) {
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
}
afterEach(() => {
  for (const e of [...engines]) close(e);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function reportUsage(e: Engine, w: WorkRequest, amountMicros: number) {
  e.usage.report({
    workId: w.id,
    attempt: w.attempt,
    token: w.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'synthetic',
          model: 'fixture',
          inputTokens: 10,
          outputTokens: 5,
          cost: { currency: 'USD', source: 'fixture', amountMicros },
        },
      ],
    },
  });
}
function fixture(
  e: Engine,
  assertions: any[] = [
    { kind: 'output', path: 'selfReport', operator: 'equals', expected: true },
  ],
  failBaseline = false,
) {
  const definition = blankDefinition();
  const agent = definition.nodes.find((n) => n.kind === 'agent')!;
  if (agent.kind === 'agent') agent.maxAttempts = 1;
  const w = e.create('Subject', '', definition);
  e.publish(w.id);
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Fixed cases',
      cases: [
        {
          id: 'case',
          name: 'Actual answer',
          input: { question: 'Answer is good' },
          assertions,
          qualityGuidance: 'Check the actual answer, not its self-report.',
        },
      ],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
  };
  const c = e.testbench.start({
    ...selection,
    confirmation: e.testbench.preview(selection).confirmation,
    requestId: 'trial-' + w.id,
  });
  e.pump();
  for (const available of e.available()) {
    const claim = e.claim(available.id, worker);
    reportUsage(e, claim, 100);
    if (failBaseline && e.run(claim.runId).comparison?.side === 'baseline') {
      e.reportFailure(claim.id, claim.token!, 'Original trial failed');
      continue;
    }
    e.submit(claim.id, claim.token!, {
      artifact: {
        answer:
          e.run(claim.runId).comparison?.side === 'baseline' ? 'bad' : 'good',
      },
      selfReport: true,
    });
  }
  e.pump();
  expect(e.testbench.report({ id: c.id }).status).toBe('completed');
  const evaluator = e.create(
    starter.name,
    starter.description,
    definitionSchema.parse(starter.definition),
  );
  e.publish(evaluator.id);
  return { comparisonId: c.id, evaluatorId: evaluator.id };
}
function start(e: Engine, f: ReturnType<typeof fixture>, extra = {}) {
  return e.start(f.evaluatorId, {
    comparisonId: f.comparisonId,
    rubric: 'Assess whether the actual answer is good.',
    outputPath: 'artifact',
    ...extra,
  }).run;
}
function prepare(e: Engine, w: WorkRequest, rootId: string) {
  const s = w.input as any,
    c = e.store.get<WorkflowComparison>('comparisons', s.comparisonId)!;
  return {
    ...s,
    evaluationRunId: rootId,
    remaining: 0,
    skipped: [],
    samples: c.samples.map((sample) => ({
      ...s,
      evaluationRunId: rootId,
      sampleId: sample.id,
      runId: sample.runId!,
      caseId: sample.caseId,
      guidance: c.suite.cases[0].qualityGuidance ?? '',
      checks: sample.observation!.checks,
      evidence:
        s.mode === 'checks_only'
          ? [evidence(e, sample.runId!, s.outputPath)]
          : [],
    })),
  };
}
function evidence(e: Engine, id: string, path: string) {
  const value = e.continuation.result({ id, path, includeHash: true });
  return { field: 'output', path, sha256: value.sha256! };
}
function review(e: Engine, w: WorkRequest) {
  const s = w.input as any,
    value = e.continuation.result({
      id: s.runId,
      path: s.outputPath,
      includeHash: true,
    });
  const verdict = (value.value as any).answer === 'good' ? 'pass' : 'fail';
  return {
    evaluationRunId: s.evaluationRunId,
    sampleId: s.sampleId,
    rubric: s.rubric,
    mode: s.mode,
    outputPath: s.outputPath,
    verdict,
    score: verdict === 'pass' ? 5 : 0,
    notes: 'Inspected the actual retained answer.',
    evidence: [{ field: 'output', path: s.outputPath, sha256: value.sha256 }],
    findings: [
      {
        criterion: 'Answer correctness',
        status: verdict,
        notes: 'Compared actual answer with the captured expectation.',
        references: ['root:' + s.runId + ':output:' + s.outputPath],
      },
    ],
  };
}
function request(e: Engine, w: WorkRequest) {
  const { grade: g, sample: s } = w.input as any;
  const grader = e
    .run(w.runId)
    .executions.find(
      (x) =>
        ['review', 'checks'].includes(x.nodeId) && x.status === 'completed',
    )!;
  return {
    id: s.comparisonId,
    sampleId: g.sampleId,
    reviewer: 'evaluation:' + g.evaluationRunId,
    reviewerKind: 'agent' as const,
    rubric: g.rubric,
    score: g.score,
    notes: g.notes,
    requestId: g.evaluationRunId + ':' + g.sampleId,
    evaluation: {
      runId: g.evaluationRunId,
      reviewerRunId: w.runId,
      executionId: grader.id,
      evidence: g.evidence,
    },
  };
}
async function drive(
  e: Engine,
  rootId: string,
  options: {
    stopBeforeRecord?: boolean;
    stopAfterRecord?: boolean;
    usage?: boolean;
  } = {},
) {
  for (let n = 0; n < 30; n++) {
    await vi.waitFor(() => {
      e.pump();
      expect(
        e.available(rootId).length > 0 || e.run(rootId).status === 'completed',
      ).toBe(true);
    });
    if (e.run(rootId).status === 'completed') return;
    const w = e.available(rootId)[0],
      claim = e.claim(w.id, {
        ...worker,
        freshContext: w.context.mode === 'fresh',
      });
    if (options.usage) reportUsage(e, claim, 10);
    let output: unknown;
    if (w.nodeId === 'prepare') output = prepare(e, w, rootId);
    else if (w.nodeId === 'review') {
      expect(w.context.mode).toBe('fresh');
      expect(w.input).not.toHaveProperty('side');
      expect(w.input).not.toHaveProperty('version');
      output = review(e, w);
    } else {
      expect(w.nodeId).toBe('record');
      const q = request(e, w);
      if (options.stopBeforeRecord) return { q, claim };
      const receipt = e.testbench.judge(q);
      if (options.stopAfterRecord) return { q, claim, receipt };
      const g = (w.input as any).grade;
      output = {
        sampleId: g.sampleId,
        judgmentId: receipt.id,
        comparisonSampleCount: receipt.evaluation!.comparisonSampleCount,
        requestId: q.requestId,
        verdict: g.verdict,
        score: g.score,
      };
    }
    e.submit(claim.id, claim.token!, output as Json);
  }
  throw Error('Evaluation did not finish');
}

it('imports a valid starter and evaluates actual artifacts with separate grading usage and no winner', async () => {
  validateDefinition(definitionSchema.parse(starter.definition));
  const e = engine(),
    f = fixture(e),
    r = start(e, f);
  await drive(e, r.id, { usage: true });
  expect(e.run(r.id).output).toMatchObject({
    selected: 2,
    recorded: 2,
    failed: 0,
    passed: 1,
    qualityFailed: 1,
    unknown: 0,
    state: 'complete',
    acceptance: 'not_decided',
    usageRef: { runId: r.id, includeDescendants: true },
  });
  const report = e.testbench.report({ id: f.comparisonId });
  expect(report.judgments).toHaveLength(2);
  const [a, b] = report.judgments;
  expect(a.evaluation?.specificationHash).toBe(b.evaluation?.specificationHash);
  expect(a.evaluation?.grader).toMatchObject({ kind: 'agent', attempt: 1 });
  expect(a.evaluation?.grader.workId).toBeTruthy();
  expect(report.metrics.sides.baseline.usage.costs[0].amountMicros.value).toBe(
    100,
  );
  expect(report.metrics.sides.candidate.usage.costs[0].amountMicros.value).toBe(
    100,
  );
  expect(
    e.usage.read({ runId: r.id, includeDescendants: true }).totals.costs[0]
      .amountMicros.value,
  ).toBe(50);
  expect(e.usage.read({ runId: r.id }).totals.costs[0].amountMicros.value).toBe(
    10,
  );
  for (const key of ['requestHash', 'token', 'tokenHash'])
    expect(JSON.stringify(report.judgments)).not.toContain('"' + key + '"');
  expect(e.continuation.result({ id: r.id })).not.toHaveProperty('sha256');
});

it.each([
  [
    'pass',
    [
      {
        kind: 'output',
        path: 'selfReport',
        operator: 'equals',
        expected: true,
      },
    ],
    5,
  ],
  [
    'fail',
    [
      {
        kind: 'output',
        path: 'selfReport',
        operator: 'equals',
        expected: false,
      },
    ],
    0,
  ],
  ['unknown', [], 0],
])(
  'checks_only maps frozen checks to %s without a semantic reviewer',
  async (verdict, assertions, score) => {
    const e = engine(),
      f = fixture(e, assertions as any[]),
      r = start(e, f, { mode: 'checks_only' });
    await drive(e, r.id);
    const report = e.testbench.report({ id: f.comparisonId });
    expect(report.judgments).toHaveLength(2);
    for (const j of report.judgments) {
      expect(j.score).toBe(score);
      expect(j.evaluation).toMatchObject({
        mode: 'checks_only',
        verdict,
        grader: { kind: 'script' },
      });
    }
    expect(
      e.store
        .work()
        .filter(
          (w) =>
            e.run(w.runId).workflowId === f.evaluatorId &&
            w.nodeId === 'review',
        ),
    ).toHaveLength(0);
    expect(report.metrics.sides.baseline.quality.checksOnlySamples).toBe(1);
    if (verdict === 'unknown') {
      expect(e.run(r.id).output).toMatchObject({
        state: 'partial',
        unknown: 2,
      });
      expect(report.metrics.availability.reasons).toContain(
        'quality_unassessed',
      );
    }
  },
);

it('resumes a persisted recording step without duplicate judgments after an ambiguous response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-evaluation-'));
  dirs.push(dir);
  const path = join(dir, 'test.sqlite');
  let e = engine(path);
  const f = fixture(e),
    r = start(e, f);
  const stopped = (await drive(e, r.id, { stopAfterRecord: true }))!;
  expect(stopped.receipt).toBeDefined();
  e.reportFailure(
    stopped.claim.id,
    stopped.claim.token!,
    'Lost response after recording',
  );
  close(e);
  e = engine(path);
  await drive(e, r.id);
  const report = e.testbench.report({ id: f.comparisonId });
  expect(report.judgments).toHaveLength(2);
  expect(e.testbench.judge(stopped.q).id).toBe(stopped.receipt!.id);
  expect(() => e.testbench.judge({ ...stopped.q, score: 2 })).toThrow(
    /different arguments/,
  );
  expect(e.store.work().filter((w) => w.nodeId === 'review')).toHaveLength(2);
});

it('rejects mismatched rubric, scores, evidence, source and grader provenance', async () => {
  const e = engine(),
    f = fixture(e),
    r = start(e, f),
    stopped = (await drive(e, r.id, { stopBeforeRecord: true }))!,
    q = stopped.q;
  for (const change of [
    { rubric: 'Changed rubric' },
    { score: 2 },
    { requestId: 'new-key' },
    { evaluation: { ...q.evaluation, executionId: 'unrelated' } },
    { evaluation: { ...q.evaluation, reviewerRunId: r.id } },
    {
      evaluation: {
        ...q.evaluation,
        evidence: [{ ...q.evaluation.evidence[0], sha256: '0'.repeat(64) }],
      },
    },
  ])
    expect(() => e.testbench.judge({ ...q, ...change })).toThrow();
  const source = e.store
    .get<WorkflowComparison>('comparisons', f.comparisonId)!
    .samples.find((s) => s.id === q.sampleId)!;
  const trial = e.run(source.runId!);
  const original = trial.output;
  trial.output = { artifact: { answer: 'changed' } };
  e.store.put('runs', trial);
  expect(() => e.testbench.judge(q)).toThrow(/artifact changed/);
  trial.output = original;
  e.store.put('runs', trial);
  expect(e.testbench.judge(q).evaluation?.evidence).toEqual(
    q.evaluation.evidence,
  );
});

it('preserves independent evaluations and does not pair incompatible specifications sharing rubric text', async () => {
  const e = engine(),
    f = fixture(e),
    r = start(e, f);
  await drive(e, r.id);
  const old = e.testbench.report({ id: f.comparisonId }).judgments;
  const r2 = start(e, f);
  await drive(e, r2.id);
  const judgments = e.testbench.report({ id: f.comparisonId }).judgments;
  expect(judgments).toHaveLength(4);
  expect(judgments[2].evaluation?.specificationHash).toBe(
    old[0].evaluation?.specificationHash,
  );
  const c = e.store.get<WorkflowComparison>('comparisons', f.comparisonId)!;
  c.judgments = c.judgments.slice(0, 2);
  c.judgments[1].evaluation!.specificationHash = 'f'.repeat(64);
  e.store.put('comparisons', c);
  expect(
    e.testbench.report({ id: f.comparisonId }).metrics.cases.items[0].paired
      .sharedRubricPairs,
  ).toBe(0);
});

it('keeps legacy append-only judging and adds opt-in idempotency without exposing its fingerprint', () => {
  const e = engine(),
    f = fixture(e),
    c = e.store.get<WorkflowComparison>('comparisons', f.comparisonId)!;
  const q = {
    id: c.id,
    sampleId: c.samples[0].id,
    reviewer: 'Human',
    reviewerKind: 'human' as const,
    rubric: 'Legacy',
    score: 3,
  };
  expect(e.testbench.judge(q).id).not.toBe(e.testbench.judge(q).id);
  const first = e.testbench.judge({ ...q, requestId: 'stable' });
  expect(e.testbench.judge({ ...q, requestId: 'stable' })).toEqual(first);
  const stored = e.store.get<WorkflowComparison>('comparisons', c.id)!;
  stored.judgments = Array.from({ length: 1000 }, (_, i) => ({
    ...stored.judgments[2],
    id: String(i),
  }));
  e.store.put('comparisons', stored);
  expect(e.testbench.judge({ ...q, requestId: 'stable' }).id).toBe('0');
  expect(() => e.testbench.judge(q)).toThrow(/1000/);
  expect(first).not.toHaveProperty('requestHash');
});

it('collects exhausted recording failures as partial coverage without inventing judgments', async () => {
  const e = engine(),
    f = fixture(e),
    r = start(e, f),
    stopped = (await drive(e, r.id, { stopBeforeRecord: true }))!;
  e.reportFailure(
    stopped.claim.id,
    stopped.claim.token!,
    'Recording unavailable',
  );
  const retry = e.claim(stopped.claim.id, worker);
  e.reportFailure(retry.id, retry.token!, 'Still unavailable');
  await drive(e, r.id);
  expect(e.run(r.id).output).toMatchObject({
    state: 'partial',
    selected: 2,
    recorded: 1,
    failed: 1,
    acceptance: 'not_decided',
  });
  expect(e.testbench.report({ id: f.comparisonId }).judgments).toHaveLength(1);
  const usage = e.usage.read({ runId: r.id, includeDescendants: true });
  expect(usage.totals.costCoverage).toBe('unknown');
});

it('rejects grader input drift and a reused current context even with matching grade JSON', async () => {
  const e = engine(),
    f = fixture(e),
    r = start(e, f),
    { q } = (await drive(e, r.id, { stopBeforeRecord: true }))!;
  const run = e.run(q.evaluation.reviewerRunId),
    execution = run.executions.find((x) => x.id === q.evaluation.executionId)!;
  const original = structuredClone(execution.input);
  (execution.input as any).guidance = 'Invented criteria';
  e.store.put('runs', run);
  expect(() => e.testbench.judge(q)).toThrow(/grader input must match/);
  execution.input = original;
  e.store.put('runs', run);
  const assignment = e.store
    .work()
    .find((w) => w.executionId === execution.id)!;
  assignment.context.mode = 'current';
  e.store.put('work', assignment);
  expect(() => e.testbench.judge(q)).toThrow(/fresh-context/);
});

it('checks_only cannot replace failed original checks with successful invented checks', async () => {
  const e = engine(),
    f = fixture(e, [
      {
        kind: 'output',
        path: 'selfReport',
        operator: 'equals',
        expected: false,
      },
    ]),
    r = start(e, f, { mode: 'checks_only' });
  const { q } = (await drive(e, r.id, { stopBeforeRecord: true }))!;
  const run = e.run(q.evaluation.reviewerRunId),
    execution = run.executions.find((x) => x.id === q.evaluation.executionId)!;
  (execution.input as any).checks.forEach((c: any) => {
    c.status = 'pass';
  });
  (execution.output as any).verdict = 'pass';
  (execution.output as any).score = 5;
  e.store.put('runs', run);
  expect(() => e.testbench.judge({ ...q, score: 5 })).toThrow(
    /grader input must match/,
  );
});

it('keeps a failed first observation unassessable after a successful explicit trial retry', async () => {
  const e = engine(),
    f = fixture(e, undefined, true),
    c = e.store.get<WorkflowComparison>('comparisons', f.comparisonId)!;
  const failed = c.samples.find((s) => s.observation?.status === 'failed')!;
  expect(failed).toBeDefined();
  e.retry(failed.runId!);
  const retry = e.claim(e.available(failed.runId)[0].id, worker);
  e.submit(retry.id, retry.token!, {
    artifact: { answer: 'good' },
    selfReport: true,
  });
  expect(e.run(failed.runId!).status).toBe('completed');
  const r = start(e, f);
  await vi.waitFor(() => expect(e.available(r.id)[0]?.nodeId).toBe('prepare'));
  const w = e.available(r.id)[0],
    claim = e.claim(w.id, worker),
    plan = prepare(e, w, r.id);
  plan.samples = plan.samples.filter((s: any) => s.sampleId === failed.id);
  plan.remaining = 1;
  e.submit(claim.id, claim.token!, plan);
  const { q } = (await drive(e, r.id, { stopBeforeRecord: true }))!;
  expect(() => e.testbench.judge(q)).toThrow(/retained completed trial root/);
});

it('uses receipt coverage to keep an omitted trial partial even if preparation forgets it', async () => {
  const e = engine(),
    f = fixture(e),
    r = start(e, f);
  await vi.waitFor(() => expect(e.available(r.id)[0]?.nodeId).toBe('prepare'));
  const w = e.available(r.id)[0],
    claim = e.claim(w.id, worker),
    plan = prepare(e, w, r.id);
  plan.samples = plan.samples.slice(0, 1);
  plan.remaining = 0;
  e.submit(claim.id, claim.token!, plan);
  await drive(e, r.id);
  expect(e.run(r.id).output).toMatchObject({
    selected: 1,
    recorded: 1,
    comparisonSampleCount: 2,
    remaining: 1,
    state: 'partial',
  });
});
