import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  type WorkRequest,
  type WorkflowComparison,
  type Json,
  type BudgetPolicy,
} from '@interlock/core';
import { importWorkflows } from '../packages/runtime/src/transfer';
import { fingerprint } from '../packages/runtime/src/versionIdentity';

const bundle = JSON.parse(readFileSync('workflows/improve.json', 'utf8'));
const worker = {
  workerId: 'fixture',
  freshContext: true,
  tools: [],
  skills: ['interlock-local-trials'],
  modelSelection: { provider: 'fake', model: 'fixture' },
};
const fixtures: { root: string; e: Engine }[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.e.stop();
    f.e.store.close();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(f.root, { recursive: true, force: true });
  }
});
const policy = (max = 50): BudgetPolicy => ({
  scope: 'tree',
  unknownUsage: 'block',
  limits: {
    claims: { max },
    cost: { currency: 'USD', threshold: { max: 1000000 } },
  },
});
function setup(extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-improve-')),
    repository = join(root, 'repository');
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  writeFileSync(join(repository, 'fixture.txt'), 'original');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'Base',
  );
  const commit = git('rev-parse', 'HEAD');
  const e = new Engine(new Store(join(root, 'state.db')), repository);
  fixtures.push({ root, e });
  const definition = blankDefinition();
  if (definition.nodes[1].kind === 'agent') {
    definition.nodes[1].prompt = 'Baseline response';
    definition.nodes[1].maxAttempts = 1;
  }
  const source = e.create('Production', '', definition);
  e.publish(source.id);
  const experiment = e.create('Experiment only', '', definition);
  e.publish(experiment.id);
  const suite = (id: string) =>
    e.testbench.createSuite({
      workflowId: experiment.id,
      content: {
        name: id,
        cases: [
          {
            id,
            name: id,
            input: {
              question: id === 'heldout' && extra.overlapCases ? 'tuning' : id,
            },
            assertions: [
              {
                kind: 'output',
                path: 'selfReport',
                operator: 'equals',
                expected: true,
              },
            ],
            qualityGuidance: 'Inspect the actual answer.',
          },
        ],
      },
    });
  const tuning = suite('tuning'),
    acceptance = suite('heldout');
  importWorkflows(e.store, bundle);
  e.publish(bundle.rootId);
  const { overlapCases: _overlap, ...requestExtra } = extra;
  const input = {
    production: { workflowId: source.id, version: 1 },
    experimentWorkflowId: experiment.id,
    nodeId: 'agent',
    hypothesis: 'An explicit answer instruction improves correctness.',
    tuning: { suiteId: tuning.id, suiteRevision: 1 },
    acceptance: { suiteId: acceptance.id, suiteRevision: 1 },
    executor: { provider: 'fake', model: 'fixture' },
    rubric: 'The actual answer must be good.',
    outputPath: 'artifact',
    criteria: { maxElapsedIncreasePercent: 100000 },
    orchestratorBudget: policy(),
    sampleBudget: policy(2),
    trialSetup: { kind: 'local_git', repository, commit },
    ...requestExtra,
  };
  const run = e.start(bundle.rootId, input as Json).run;
  return { root, repository, e, source, experiment, input, runId: run.id };
}
function usage(e: Engine, w: WorkRequest, cost = 10) {
  e.usage.report({
    workId: w.id,
    attempt: w.attempt,
    token: w.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'fake',
          model: 'fixture',
          inputTokens: 10,
          outputTokens: 5,
          cost: { currency: 'USD', source: 'fixture', amountMicros: cost },
        },
      ],
    },
  });
}
async function wait(check: () => void) {
  await vi.waitFor(check, { timeout: 10000, interval: 20 });
}
function prepare(f: ReturnType<typeof setup>, w: WorkRequest) {
  const e = f.e,
    q = w.input as any;
  e.budgets.set({
    runId: w.runId,
    expectedRevision: 0,
    budget: q.orchestratorBudget,
  });
  const source = e.workflow(q.production.workflowId),
    experiment = e.workflow(q.experimentWorkflowId),
    budget = e.budgets.read(w.runId);
  return {
    experimentRunId: w.runId,
    production: {
      workflowId: source.id,
      version: q.production.version,
      latestVersion: source.latestVersion,
      draftMatchesLatest: e.describeWorkflow(source).draftMatchesLatest,
      draftRevision: source.draftRevision,
      definition: e.store.getVersion(source.id, q.production.version)!
        .definition,
    },
    experiment: {
      workflowId: experiment.id,
      latestVersion: experiment.latestVersion,
      draftRevision: experiment.draftRevision,
      draftMatchesLatest: true,
      definition: e.store.getVersion(experiment.id, 1)!.definition,
    },
    tuning: e.testbench.getSuite(q.tuning.suiteId),
    acceptance: e.testbench.getSuite(q.acceptance.suiteId),
    promptRevisions: [],
    budget: { revision: budget.revision, budget: budget.budget },
  };
}
function grade(e: Engine, w: WorkRequest, fractional = false) {
  const s = w.input as any,
    r = e.continuation.result({
      id: s.runId,
      path: s.outputPath,
      includeHash: true,
    });
  const verdict = (r.value as any).answer === 'good' ? 'pass' : 'fail';
  return {
    ...Object.fromEntries(
      ['evaluationRunId', 'sampleId', 'rubric', 'mode', 'outputPath'].map(
        (k) => [k, s[k]],
      ),
    ),
    verdict,
    score: fractional
      ? verdict === 'pass'
        ? 4.5
        : 1.5
      : verdict === 'pass'
        ? 5
        : 0,
    notes: 'Inspected the retained artifact.',
    evidence: [{ field: 'output', path: s.outputPath, sha256: r.sha256 }],
    findings: [
      {
        criterion: 'Correct answer',
        status: verdict,
        notes: 'Read actual answer.',
        references: ['root:' + s.runId],
      },
    ],
  };
}
function evaluatorPrepare(e: Engine, w: WorkRequest) {
  const s = w.input as any,
    c = e.store.get<WorkflowComparison>('comparisons', s.comparisonId)!;
  return {
    ...s,
    evaluationRunId: w.runId,
    remaining: 0,
    skipped: [],
    samples: c.samples
      .filter((x) => x.observation?.status === 'completed')
      .map((x) => ({
        ...s,
        evaluationRunId: w.runId,
        sampleId: x.id,
        runId: x.runId,
        caseId: x.caseId,
        guidance: c.suite.cases.find((c) => c.id === x.caseId)!.qualityGuidance,
        checks: x.observation!.checks,
        evidence: [],
      })),
  };
}
function record(e: Engine, w: WorkRequest) {
  const { sample: s, grade: g } = w.input as any,
    execution = e
      .run(w.runId)
      .executions.find(
        (x) => x.nodeId === 'review' && x.status === 'completed',
      )!;
  const receipt = e.testbench.judge({
    id: s.comparisonId,
    sampleId: g.sampleId,
    reviewer: 'evaluation:' + g.evaluationRunId,
    reviewerKind: 'agent',
    rubric: g.rubric,
    score: g.score,
    notes: g.notes,
    requestId: g.evaluationRunId + ':' + g.sampleId,
    evaluation: {
      runId: g.evaluationRunId,
      reviewerRunId: w.runId,
      executionId: execution.id,
      evidence: g.evidence,
    },
  });
  return {
    sampleId: g.sampleId,
    judgmentId: receipt.id,
    requestId: receipt.requestId,
    verdict: g.verdict,
    score: g.score,
    comparisonSampleCount: receipt.evaluation!.comparisonSampleCount,
  };
}
function collect(f: ReturnType<typeof setup>, w: WorkRequest, options: any) {
  const e = f.e,
    { experiment: x, dispatch: d } = w.input as any,
    phase = w.nodeId.endsWith('acceptance') ? 'acceptance' : 'tuning';
  const invocation = e
    .run(w.runId)
    .executions.find((x) => x.nodeId === 'evaluate_' + phase)!;
  const evaluationRunId = invocation.childRunIds[0];
  const c = e.store.get<WorkflowComparison>('comparisons', d.comparisonId)!,
    report = e.testbench.report({ id: c.id, metricsDetail: 'full', limit: 25 });
  const rows = report.samples.map((s) => {
    const judgments = c.judgments.filter((j) => j.sampleId === s.id),
      j = judgments.find((j) => j.evaluation?.runId === evaluationRunId),
      u = s.metrics.usage!,
      cost = u.costs.find((c) => c.currency === 'USD');
    const graderAttempt = j?.evaluation
      ? e.usage
          .read({
            runId: j.evaluation.reviewerRunId,
            groupBy: 'attempt',
            limit: 100,
          })
          .groups.find(
            (a) =>
              a.workId === j.evaluation!.grader.workId &&
              a.attempt === j.evaluation!.grader.attempt,
          )
      : undefined;
    return {
      sampleId: s.id,
      trialRef: s.trialRef,
      caseId: s.caseId,
      side: s.side,
      repetition: s.repetition,
      status: s.observation?.status,
      currentStatus: s.currentStatus,
      executorConditionsState: s.metrics.executorConditions.state,
      graderConfigurationMatched:
        j?.evaluation?.grader.modelSelection?.provider ===
          x.plan.request.executor.provider &&
        j?.evaluation?.grader.modelSelection?.model ===
          x.plan.request.executor.model &&
        Boolean(
          graderAttempt?.snapshot?.final &&
          graderAttempt.snapshot.models.every(
            (m) =>
              m.provider === x.plan.request.executor.provider &&
              m.model === x.plan.request.executor.model,
          ),
        ),
      checks: s.observation?.checks ?? [],
      grade: j?.evaluation
        ? {
            mode: j.evaluation.mode,
            verdict: j.evaluation.verdict,
            score: j.score,
            rubric: j.rubric,
            runId: j.evaluation.runId,
            specificationHash: j.evaluation.specificationHash,
            disagreement: false,
          }
        : null,
      costMicros:
        u.costCoverage === 'complete'
          ? (cost?.amountMicros.value ?? null)
          : null,
      elapsedMs: s.metrics.timing!.treeElapsedMs,
    };
  });
  const own = e.usage.read({ runId: w.runId, includeDescendants: false }),
    grader = e.usage.read({ runId: evaluationRunId, includeDescendants: true });
  const production = e.workflow(x.plan.production.workflowId);
  const result = {
    phase,
    configurationIds: report.configurationIds,
    comparisonId: c.id,
    requestId: c.requestId,
    evaluationRunId,
    rows,
    cleanupComplete: !report.trials?.cleanupPending,
    budgetPolicyUnchanged:
      fingerprint(e.budgets.read(f.runId).budget) ===
        fingerprint(x.plan.request.orchestratorBudget) &&
      c.samples.every(
        (s) =>
          fingerprint(e.budgets.read(s.runId!).budget) ===
          fingerprint(x.plan.request.sampleBudget),
      ),
    graderUsageComplete: grader.totals.costCoverage === 'complete',
    coordinatorUsageComplete: own.totals.costCoverage === 'complete',
    productionUnchanged:
      production.latestVersion === x.plan.production.latestVersion &&
      production.draftRevision === x.plan.production.draftRevision,
    usage: { coordinator: own.totals, evaluator: grader.totals },
  };
  return options.evidence ? options.evidence(result) : result;
}
async function drive(f: ReturnType<typeof setup>, options: any = {}) {
  const e = f.e;
  for (let n = 0; n < 1500; n++) {
    e.pump();
    if (
      options.stopAt &&
      e.store
        .work()
        .some(
          (w) =>
            w.runId === f.runId &&
            w.nodeId === options.stopAt &&
            w.status === 'available',
        )
    )
      return;
    if (['completed', 'failed', 'cancelled'].includes(e.run(f.runId).status))
      return;
    const available = e.available();
    if (!available.length) {
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }
    for (const a of available) {
      const run = e.run(a.runId);
      if (options.stopAt === a.nodeId && !run.comparison) return;
      const w = e.claim(a.id, worker);
      usage(
        e,
        w,
        run.comparison ? (run.comparison.side === 'baseline' ? 100 : 50) : 10,
      );
      let out: any;
      if (run.comparison) {
        await new Promise((r) => setTimeout(r, 5));
        const c = e.store.get<WorkflowComparison>(
          'comparisons',
          run.comparison.comparisonId,
        )!;
        const bad =
          run.comparison.side === 'baseline' ||
          (options.regression && c.requestId.endsWith(':acceptance'));
        const file = join(w.trialEnvironment!.workspace, 'fixture.txt'),
          before = readFileSync(file, 'utf8');
        writeFileSync(file, before + ' ' + (bad ? 'bad' : 'good'));
        out = {
          artifact: { answer: bad ? 'bad' : 'good', before },
          selfReport: true,
        };
      } else if (a.runId !== f.runId) {
        if (a.nodeId === 'prepare') out = evaluatorPrepare(e, w);
        else if (a.nodeId === 'review') out = grade(e, w, options.fractional);
        else if (a.nodeId === 'record') out = record(e, w);
        else throw Error('Unknown evaluator ' + a.nodeId);
      } else if (a.nodeId === 'prepare') out = prepare(f, w);
      else if (a.nodeId === 'propose') {
        const q = (w.input as any).request;
        expect(JSON.stringify(q)).not.toContain('heldout');
        out = {
          hypothesis: q.hypothesis,
          prompt: 'Candidate: return the good answer.',
          informedCaseIds: q.cases.map((c: any) => c.id),
        };
      } else if (a.nodeId === 'publish') {
        const x = w.input as any,
          current = e.workflow(x.candidate.workflowId);
        if (current.latestVersion === 1) {
          e.update(current.id, {
            draftRevision: current.draftRevision,
            draft: x.candidate.definition,
          });
          e.publish(current.id);
        }
        expect(fingerprint(e.store.getVersion(current.id, 2)!.definition)).toBe(
          x.candidate.definitionHash,
        );
        out = {
          workflowId: current.id,
          version: 2,
          definitionHash: x.candidate.definitionHash,
        };
        if (options.lostPublish) {
          e.reportFailure(w.id, w.token!, 'Lost publish response');
          return;
        }
      } else if (a.nodeId.startsWith('dispatch_')) {
        const x = (w.input as any).experiment,
          phase = a.nodeId.endsWith('acceptance') ? 'acceptance' : 'tuning',
          q = x.requests[phase],
          { requestId, ...selection } = q;
        const p = e.testbench.preview(selection);
        expect(p.canStart).toBe(true);
        const c = e.testbench.start({
          ...selection,
          confirmation: p.confirmation,
          requestId,
        });
        out = { comparisonId: c.id, requestId };
        // Keep the coordinator claimed while ordinary workers finish its independent trials.
        for (let i = 0; i < 800; i++) {
          e.pump();
          const r = e.testbench.report({ id: c.id });
          if (r.status === 'completed' && !r.trials!.cleanupPending) break;
          for (const t of e
            .available()
            .filter((t) => e.run(t.runId).comparison?.comparisonId === c.id)) {
            const claim = e.claim(t.id, worker),
              s = e.run(t.runId).comparison!;
            usage(e, claim, s.side === 'baseline' ? 100 : 50);
            await new Promise((r) => setTimeout(r, 5));
            const bad =
              s.side === 'baseline' ||
              (options.regression && phase === 'acceptance');
            const file = join(claim.trialEnvironment!.workspace, 'fixture.txt'),
              before = readFileSync(file, 'utf8');
            writeFileSync(file, before + ' ' + (bad ? 'bad' : 'good'));
            e.submit(claim.id, claim.token!, {
              artifact: { answer: bad ? 'bad' : 'good', before },
              selfReport: true,
            });
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        if (options.lostDispatch === phase) {
          e.reportFailure(w.id, w.token!, 'Lost delivery after start');
          return;
        }
      } else if (a.nodeId.startsWith('collect_')) out = collect(f, w, options);
      else throw Error('Unknown coordinator ' + a.nodeId);
      e.submit(w.id, w.token!, out as Json);
    }
  }
  throw Error(
    'Improvement did not settle: ' +
      JSON.stringify(e.continuation.briefing({ id: f.runId, limit: 20 })),
  );
}
it('ships a generated importable starter and completes a held-out experiment without changing production', async () => {
  execFileSync(process.execPath, [
    'scripts/build-improvement-starter.mjs',
    '--check',
  ]);
  const f = setup();
  await drive(f);
  expect(f.e.run(f.runId).error).toBeUndefined();
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'candidate_better',
    acceptance: 'proposal_only',
    scope: { candidates: 1, repairs: 0 },
    informedCaseIds: ['tuning'],
    promotionProposal: {
      expectedProduction: { workflowId: f.source.id, version: 1 },
      candidate: { workflowId: f.experiment.id, version: 2 },
    },
  });
  expect(f.e.workflow(f.source.id).latestVersion).toBe(1);
  expect(readFileSync(join(f.repository, 'fixture.txt'), 'utf8')).toBe(
    'original',
  );
  expect(f.e.store.list<WorkflowComparison>('comparisons')).toHaveLength(2);
}, 20000);

it('retains the baseline when held-out cases regress', async () => {
  const f = setup();
  await drive(f, { regression: true });
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'retain_baseline',
    promotionProposal: null,
    tuning: { outcome: 'candidate_better' },
    acceptanceEvidence: { outcome: 'retain_baseline' },
  });
  expect(f.e.workflow(f.source.id).latestVersion).toBe(1);
}, 20000);

it.each([
  [
    'mismatched trial model',
    (r: any) => {
      r.rows[0].executorConditionsState = 'mismatch';
    },
  ],
  [
    'unknown grader model',
    (r: any) => {
      r.rows[0].graderConfigurationMatched = false;
    },
  ],
  [
    'unreported cost',
    (r: any) => {
      r.rows[0].costMicros = null;
    },
  ],
  [
    'missing grading',
    (r: any) => {
      r.rows[0].grade = null;
    },
  ],
  [
    'disagreement',
    (r: any) => {
      r.rows[0].grade.disagreement = true;
    },
  ],
  [
    'changed budget',
    (r: any) => {
      r.budgetPolicyUnchanged = false;
    },
  ],
  [
    'stale production',
    (r: any) => {
      r.productionUnchanged = false;
    },
  ],
  [
    'duplicate membership',
    (r: any) => {
      r.rows[1] = r.rows[0];
    },
  ],
  [
    'unfinished cleanup',
    (r: any) => {
      r.cleanupComplete = false;
    },
  ],
  [
    'unreported grader usage',
    (r: any) => {
      r.graderUsageComplete = false;
    },
  ],
] as const)(
  'keeps %s visible and never uses acceptance cases',
  async (_name, change) => {
    const f = setup();
    await drive(f, {
      evidence: (r: any) => {
        change(r);
        return r;
      },
    });
    expect(f.e.run(f.runId).output).toMatchObject({
      outcome: 'insufficient_evidence',
      promotionProposal: null,
      acceptanceEvidence: null,
    });
    expect(f.e.store.list('comparisons')).toHaveLength(1);
  },
  20000,
);

it('reports a quality and cost tradeoff rather than silently relaxing the criterion', async () => {
  const f = setup();
  await drive(f, {
    evidence: (r: any) => {
      for (const row of r.rows)
        if (row.side === 'candidate') row.costMicros = 1000;
      return r;
    },
  });
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'tradeoff',
    promotionProposal: null,
    acceptanceEvidence: null,
  });
}, 20000);

it('resumes the same candidate and comparisons after an ambiguous dispatch and restart', async () => {
  const f = setup();
  await drive(f, { lostDispatch: 'tuning' });
  expect(f.e.run(f.runId).status).toBe('failed');
  const original = f.e.store.list<WorkflowComparison>('comparisons')[0].id;
  f.e.stop();
  f.e.store.close();
  const resumed = new Engine(new Store(join(f.root, 'state.db')), f.repository);
  fixtures.find((x) => x.root === f.root)!.e = resumed;
  f.e = resumed;
  resumed.retry(f.runId);
  await drive(f);
  expect(resumed.run(f.runId).output).toMatchObject({
    outcome: 'candidate_better',
    tuning: { comparisonId: original },
  });
  expect(resumed.store.list('comparisons')).toHaveLength(2);
  expect(resumed.workflow(f.experiment.id).latestVersion).toBe(2);
}, 20000);

it('does not propose or dispatch when the captured coordinator allowance is exhausted', async () => {
  const f = setup({ orchestratorBudget: policy(1) });
  await drive(f, { stopAt: 'propose' });
  expect(f.e.store.list('comparisons')).toHaveLength(0);
  expect(f.e.workflow(f.experiment.id).latestVersion).toBe(1);
  expect(
    f.e.store.work().find((w) => w.nodeId === 'propose')?.budgetBlocked,
  ).toBeDefined();
}, 20000);

it('reuses exact version 2 after a lost publication response', async () => {
  const f = setup();
  await drive(f, { lostPublish: true });
  expect(f.e.run(f.runId).status).toBe('failed');
  expect(f.e.workflow(f.experiment.id).latestVersion).toBe(2);
  f.e.retry(f.runId);
  await drive(f);
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'candidate_better',
  });
  expect(f.e.workflow(f.experiment.id).latestVersion).toBe(2);
}, 20000);

it('rejects overlapping tuning and acceptance inputs before proposing', async () => {
  const f = setup({ overlapCases: true });
  await drive(f);
  expect(f.e.run(f.runId).status).toBe('failed');
  expect(f.e.run(f.runId).error).toContain('distinct IDs and original inputs');
  expect(f.e.workflow(f.experiment.id).latestVersion).toBe(1);
});

it('keeps unfinished coordinator expense pending without treating it as zero', async () => {
  const f = setup();
  await drive(f, {
    evidence: (r: any) => {
      r.coordinatorUsageComplete = false;
      r.usage.coordinator.costCoverage = 'partial';
      return r;
    },
  });
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'candidate_better',
    promotionProposal: { coordinatorExpenseStatus: 'pending_final_usage' },
    acceptanceEvidence: { coordinatorExpenseStatus: 'pending_final_usage' },
  });
}, 20000);

it('accepts fractional semantic scores without confusing them with measurement overflow', async () => {
  const f = setup();
  await drive(f, { fractional: true });
  expect(f.e.run(f.runId).output).toMatchObject({
    outcome: 'candidate_better',
    tuning: { baseline: { score: 1.5 }, candidate: { score: 4.5 } },
  });
}, 20000);

it('rejects a production draft that no longer matches the evaluated baseline', async () => {
  const f = setup(),
    draft = f.e.workflow(f.source.id).draft;
  if (draft.nodes[1].kind === 'agent')
    draft.nodes[1].prompt = 'Unrelated pending production edit';
  f.e.update(f.source.id, { draftRevision: f.source.draftRevision, draft });
  await drive(f);
  expect(f.e.run(f.runId).status).toBe('failed');
  expect(f.e.run(f.runId).error).toContain('no draft definition edits');
  expect(f.e.workflow(f.experiment.id).latestVersion).toBe(1);
});
