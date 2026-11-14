import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  validateDefinition,
  type WorkflowComparison,
  type Json,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import {
  planEvaluation,
  recordEvaluation,
} from '../packages/runtime/src/evaluationPlan';

const starter = JSON.parse(readFileSync('workflows/evaluate.json', 'utf8'));
const worker = {
  workerId: 'fixture',
  freshContext: false,
  tools: [],
  skills: [],
};
// The starter's Scripts call this Interlock over HTTP. Each engine gets its own
// listener; `record` can replace a judgment response to simulate failures.
type Hooks = {
  record?: (sampleId: string) => Response | 'lost' | undefined;
  plan?: (plan: any) => any;
  posts: string[];
};
const open = new Map<Engine, { hooks: Hooks; close: () => Promise<void> }>(),
  dirs: string[] = [];
async function engine(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd()),
    app = createApp(e),
    hooks: Hooks = { posts: [] };
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname.endsWith('/judgments')) {
        const { sampleId } = await req.clone().json();
        hooks.posts.push(sampleId);
        const reply = hooks.record?.(sampleId);
        if (reply === 'lost') {
          await app.fetch(req);
          return new Response('Lost response', { status: 502 });
        }
        if (reply) return reply;
      }
      const response = await app.fetch(req);
      return hooks.plan && url.pathname.endsWith('/evaluation-plan')
        ? Response.json(hooks.plan(await response.json()))
        : response;
    },
  });
  await new Promise<void>((r) =>
    server.listening ? r() : server.once('listening', r),
  );
  const { port } = server.address() as { port: number };
  e.executors.mcpUrl = `http://127.0.0.1:${port}/mcp/execute`;
  open.set(e, {
    hooks,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  });
  return e;
}
const hooks = (e: Engine) => open.get(e)!.hooks;
async function close(e: Engine) {
  e.stop();
  e.store.close();
  await open.get(e)!.close();
  open.delete(e);
}
afterEach(async () => {
  for (const e of [...open.keys()]) await close(e);
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
  repetitions = 1,
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
    repetitions,
  };
  const c = e.testbench.start({
    ...selection,
    confirmation: e.testbench.preview(selection).confirmation,
    requestId: 'trial-' + w.id,
  });
  for (
    let n = 0;
    n < 5 && e.testbench.report({ id: c.id }).status !== 'completed';
    n++
  ) {
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
  }
  expect(e.testbench.report({ id: c.id }).status).toBe('completed');
  const evaluator = e.create(
    starter.name,
    starter.description,
    definitionSchema.parse(starter.definition),
  );
  e.publish(evaluator.id);
  return { comparisonId: c.id, evaluatorId: evaluator.id, subjectId: w.id };
}
function start(e: Engine, f: ReturnType<typeof fixture>, extra = {}) {
  return e.start(f.evaluatorId, {
    comparisonId: f.comparisonId,
    rubric: 'Assess whether the actual answer is good.',
    outputPath: 'artifact',
    ...extra,
  }).run;
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
const items = (e: Engine, rootId: string) =>
  e.store
    .runs()
    .filter((r) => r.parentRunId === rootId && r.batchNodeId === 'evaluate');
const grader = (run: Run) =>
  run.executions.find(
    (x) => ['review', 'checks'].includes(x.nodeId) && x.status === 'completed',
  );
/** The MCP record_quality request an older copy's recording agent sends. */
function mcpRequest(f: ReturnType<typeof fixture>, run: Run) {
  const execution = grader(run)!,
    g = execution.output as any;
  return {
    id: f.comparisonId,
    sampleId: g.sampleId as string,
    reviewer: 'evaluation:' + g.evaluationRunId,
    reviewerKind: 'agent' as const,
    rubric: g.rubric as string,
    score: g.score as number,
    notes: g.notes as string,
    requestId: g.evaluationRunId + ':' + g.sampleId,
    evaluation: {
      runId: g.evaluationRunId as string,
      reviewerRunId: run.id,
      executionId: execution.id,
      evidence: g.evidence,
    },
  };
}
/** Answers every fresh review until the evaluation settles, or after `reviews`. */
async function drive(
  e: Engine,
  rootId: string,
  options: { reviews?: number; usage?: boolean } = {},
) {
  for (let n = 0; n < 30; n++) {
    await vi.waitFor(
      () => {
        e.pump();
        expect(
          e.available(rootId).length > 0 ||
            ['completed', 'failed'].includes(e.run(rootId).status),
        ).toBe(true);
      },
      { timeout: 10000, interval: 20 },
    );
    if (['completed', 'failed'].includes(e.run(rootId).status)) return;
    if (n === options.reviews) return;
    const w = e.available(rootId)[0],
      claim = e.claim(w.id, {
        ...worker,
        freshContext: w.context.mode === 'fresh',
      });
    expect(w.nodeId).toBe('review');
    expect(w.context.mode).toBe('fresh');
    expect(w.input).not.toHaveProperty('side');
    expect(w.input).not.toHaveProperty('version');
    if (options.usage) reportUsage(e, claim, 10);
    e.submit(claim.id, claim.token!, review(e, w) as Json);
  }
  throw Error('Evaluation did not finish');
}
/** Runs an evaluation whose recording is refused, leaving every grade unrecorded. */
async function unrecorded(
  e: Engine,
  f: ReturnType<typeof fixture>,
  extra = {},
) {
  hooks(e).record = () =>
    Response.json(
      { error: 'Recording is offline in this test', code: 'invalid_request' },
      { status: 400 },
    );
  const r = start(e, f, extra);
  await drive(e, r.id);
  hooks(e).record = undefined;
  const run = items(e, r.id).find((i) => grader(i))!;
  return { r, run, q: mcpRequest(f, run) };
}

it('imports a valid starter and evaluates actual artifacts with separate grading usage and no winner', async () => {
  validateDefinition(definitionSchema.parse(starter.definition));
  const e = await engine(),
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
  expect(a).toMatchObject({
    reviewer: 'evaluation:' + r.id,
    reviewerKind: 'agent',
    requestId: r.id + ':' + a.sampleId,
  });
  // Only the fresh reviews are agent work; selection and recording are Scripts.
  const evaluatorWork = e.store
    .work()
    .filter((w) => w.runId === r.id || e.run(w.runId).parentRunId === r.id);
  expect(evaluatorWork.map((w) => w.nodeId)).toEqual(['review', 'review']);
  expect(report.metrics.sides.baseline.usage.costs[0].amountMicros.value).toBe(
    100,
  );
  expect(report.metrics.sides.candidate.usage.costs[0].amountMicros.value).toBe(
    100,
  );
  expect(
    e.usage.read({ runId: r.id, includeDescendants: true }).totals.costs[0]
      .amountMicros.value,
  ).toBe(20);
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
  'checks_only maps frozen checks to %s with no agent work',
  async (verdict, assertions, score) => {
    const e = await engine(),
      f = fixture(e, assertions as any[]),
      r = start(e, f, { mode: 'checks_only' });
    await drive(e, r.id);
    expect(e.run(r.id).status).toBe('completed');
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
      e.store.work().filter((w) => e.run(w.runId).workflowId === f.evaluatorId),
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

it('records each grade once after a lost response and resumes after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-evaluation-'));
  dirs.push(dir);
  const path = join(dir, 'test.sqlite');
  let e = await engine(path);
  const f = fixture(e),
    r = start(e, f);
  // Lose the first response after its write; later requests go through.
  hooks(e).record = () => (hooks(e).posts.length === 1 ? 'lost' : undefined);
  await drive(e, r.id, { reviews: 1 });
  await vi.waitFor(
    () => {
      e.pump();
      expect(
        items(e, r.id).some((i) =>
          i.executions.some(
            (x) => x.nodeId === 'record' && x.status === 'completed',
          ),
        ),
      ).toBe(true);
    },
    { timeout: 10000, interval: 20 },
  );
  // The first response was lost after the write; the retry got the original.
  expect(hooks(e).posts).toHaveLength(2);
  const first = e.testbench.report({ id: f.comparisonId }).judgments;
  expect(first).toHaveLength(1);
  const recorded = items(e, r.id).find((i) => grader(i))!;
  expect(
    recorded.executions.find((x) => x.nodeId === 'record')!.output,
  ).toMatchObject({ judgmentId: first[0].id });
  await close(e);
  e = await engine(path);
  await drive(e, r.id);
  expect(e.run(r.id).output).toMatchObject({ recorded: 2, state: 'complete' });
  expect(e.testbench.report({ id: f.comparisonId }).judgments).toHaveLength(2);
  const q = mcpRequest(f, recorded);
  expect(e.testbench.judge(q).id).toBe(first[0].id);
  expect(() => e.testbench.judge({ ...q, score: 2 })).toThrow(
    /different arguments/,
  );
  expect(e.store.work().filter((w) => w.nodeId === 'review')).toHaveLength(2);
});

it('rejects mismatched rubric, scores, evidence, source and grader provenance', async () => {
  const e = await engine(),
    f = fixture(e),
    { r, q } = await unrecorded(e, f);
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

it('records by reference only from the item run that graded the sample', async () => {
  const e = await engine(),
    f = fixture(e),
    { r, run, q } = await unrecorded(e, f);
  const other = e.store
    .get<WorkflowComparison>('comparisons', f.comparisonId)!
    .samples.find((s) => s.id !== q.sampleId)!;
  const request = { id: f.comparisonId, evaluationRunId: r.id };
  expect(() =>
    recordEvaluation(e.testbench, e.store, {
      ...request,
      reviewerRunId: r.id,
      sampleId: q.sampleId,
    }),
  ).toThrow(/no completed review or checks step/);
  expect(() =>
    recordEvaluation(e.testbench, e.store, {
      ...request,
      reviewerRunId: run.id,
      sampleId: other.id,
    }),
  ).toThrow(/another evaluation run or sample/);
  expect(e.testbench.report({ id: f.comparisonId }).judgments).toHaveLength(0);
  const post = (id: string) =>
    createApp(e).request(
      `http://127.0.0.1:4310/api/comparisons/${id}/judgments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evaluationRunId: r.id,
          reviewerRunId: run.id,
          sampleId: q.sampleId,
        }),
      },
    );
  expect((await post('missing')).status).toBe(404);
  const created = await post(f.comparisonId);
  expect(created.status).toBe(200);
  const judgment = await created.json();
  // The same receipt an older copy's recording agent writes through MCP.
  expect(e.testbench.judge(q).id).toBe(judgment.id);
  expect((await (await post(f.comparisonId)).json()).id).toBe(judgment.id);
});

it('preserves independent evaluations and does not pair incompatible specifications sharing rubric text', async () => {
  const e = await engine(),
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

it('keeps legacy append-only judging and adds opt-in idempotency without exposing its fingerprint', async () => {
  const e = await engine(),
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
  const e = await engine(),
    f = fixture(e),
    failing = e.store.get<WorkflowComparison>('comparisons', f.comparisonId)!
      .samples[0].id;
  hooks(e).record = (sampleId) =>
    sampleId === failing
      ? Response.json({ error: 'Unavailable' }, { status: 503 })
      : undefined;
  const r = start(e, f);
  await drive(e, r.id);
  expect(hooks(e).posts.filter((id) => id === failing)).toHaveLength(3);
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
  const e = await engine(),
    f = fixture(e),
    { q } = await unrecorded(e, f);
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
  const e = await engine(),
    f = fixture(e, [
      {
        kind: 'output',
        path: 'selfReport',
        operator: 'equals',
        expected: false,
      },
    ]),
    { q } = await unrecorded(e, f, { mode: 'checks_only' });
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
  const e = await engine(),
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
  const { r, q } = await unrecorded(e, f);
  expect(e.run(r.id).output).toMatchObject({
    selected: 1,
    skipped: [{ sampleId: failed.id, reason: expect.stringMatching(/retry/) }],
  });
  // A grade for the retried root cannot be recorded against the original either.
  expect(() =>
    e.testbench.judge({
      ...q,
      sampleId: failed.id,
      requestId: r.id + ':' + failed.id,
    }),
  ).toThrow(/retained completed trial root/);
});

it('uses receipt coverage to keep an omitted trial partial even if the plan forgets it', async () => {
  const e = await engine(),
    f = fixture(e);
  hooks(e).plan = (plan) => ({
    ...plan,
    samples: plan.samples.slice(0, 1),
    remaining: 0,
  });
  const r = start(e, f);
  await drive(e, r.id);
  expect(e.run(r.id).output).toMatchObject({
    selected: 1,
    recorded: 1,
    comparisonSampleCount: 2,
    remaining: 1,
    state: 'partial',
  });
});

it('validates a grader receipt against its raw result when forwarded output is reshaped', async () => {
  const e = await engine(),
    f = fixture(e),
    { q } = await unrecorded(e, f);
  const reference = q.evaluation;
  const reviewer = e.run(reference.reviewerRunId),
    execution = reviewer.executions.find(
      (x) => x.id === reference.executionId,
    )!;
  const raw = structuredClone(execution.output!);
  execution.result = raw;
  execution.output = { summary: 'Forwarded presentation data' };
  e.store.put('runs', reviewer);
  expect(
    e.continuation.result({
      id: reviewer.id,
      executionId: execution.id,
      field: 'result',
    }).value,
  ).toEqual(raw);
  expect(e.testbench.judge(q).evaluation?.grader.kind).toBe('agent');
});

it.each([
  {
    name: 'prefers complete pairs and never grades a retry in place of a failed original',
    repetitions: 2,
    settings: { maxSamples: 2 },
    // A failed original whose run later completed through a retry.
    failed: 'baseline:1',
    selected: ['baseline:2', 'candidate:2'],
    skipped: [/Original trial is failed; a later retry cannot replace it/],
    remaining: 1,
  },
  {
    name: 'counts eligible samples past the limit as remaining',
    repetitions: 2,
    settings: { maxSamples: 3 },
    selected: ['baseline:1', 'baseline:2', 'candidate:1'],
    skipped: [],
    remaining: 1,
  },
  {
    name: 'skips outputs without the selected path',
    repetitions: 1,
    settings: { outputPath: 'missing' },
    selected: [],
    skipped: [/no path "missing"/, /no path "missing"/],
    remaining: 0,
  },
  {
    name: 'skips a trial run that is no longer completed',
    repetitions: 1,
    settings: {},
    cancelled: 'candidate:1',
    selected: ['baseline:1'],
    skipped: [/Trial run is now cancelled/],
    remaining: 0,
  },
])('plans an evaluation: $name', async (row) => {
  const e = await engine(),
    f = fixture(e, undefined, false, row.repetitions),
    c = e.store.get<WorkflowComparison>('comparisons', f.comparisonId)!,
    label = (s: { side: string; repetition: number }) =>
      `${s.side}:${s.repetition}`;
  for (const s of c.samples) {
    if (label(s) === row.failed) s.observation!.status = 'failed';
    if (label(s) === row.cancelled) {
      const run = e.run(s.runId!);
      run.status = 'cancelled';
      e.store.put('runs', run);
    }
  }
  e.store.put('comparisons', c);
  // Any run whose input captures the settings can own an evaluation plan.
  const owner = e.start(f.subjectId, {
    comparisonId: c.id,
    rubric: 'Fixed rubric',
    outputPath: 'artifact',
    ...(row.settings as Record<string, Json>),
  }).run;
  const plan = planEvaluation(e.store, { id: c.id, evaluationRunId: owner.id });
  const bySample = new Map(c.samples.map((s) => [s.id, s]));
  expect(
    plan.samples.map((s) => label(bySample.get(s.sampleId)!)).sort(),
  ).toEqual(row.selected);
  expect(plan.skipped.map((s) => s.reason)).toEqual(
    row.skipped.map((r) => expect.stringMatching(r)),
  );
  expect(plan.remaining).toBe(row.remaining);
  // Exactly the grader input a receipt expects: no side, version or worker.
  const keys =
    'caseId checks comparisonId evaluationRunId evidence guidance maxSamples mode outputPath rubric runId sampleId';
  for (const s of plan.samples) {
    expect(Object.keys(s).sort().join(' ')).toBe(keys);
    // A fresh reviewer reads the output itself; checks_only receipts verify digests.
    expect(s.evidence).toEqual([]);
  }
});
