import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import type { Json, WorkflowDefinition } from '@interlock/core';
import { importStarter } from '../packages/server/src/starters';

// Fixture simulation of SDLC v2 against a temporary Git repository. Agent
// results and human answers are scripted; Script nodes run for real, so
// result checks, check commands and routing are exercised. Each case lists the
// steps it expects in order, so a wrong route stops the case.

type Finding = { id: string; severity: string };
type WorkInput = {
  headCommit?: string;
  planPath?: string | null;
  formatFeedback?: string;
  priorReview?: { findings: Finding[] } | null;
  previous?: string | { feedback?: string; humanResponse?: string };
  review?: { deliveryNotes: string[] };
};
type Ctx = { repo: string; input: WorkInput };
const feedback = (input: WorkInput) =>
  typeof input.previous === 'object' ? input.previous.feedback : undefined;
type Step = ['agent', string, (ctx: Ctx) => Json] | ['human', string, Json];

const engines: Engine[] = [],
  dirs: string[] = [];
const covered = new Set<string>();
let definition: WorkflowDefinition | undefined;
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (repo: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
function repository() {
  const repo = mkdtempSync(join(tmpdir(), 'interlock-sdlc-v2-'));
  dirs.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'Fixture\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'Initial');
  return repo;
}
function write(repo: string, file: string, text = 'text\n') {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
}
let commits = 0;
function commit(repo: string, file = `change-${++commits}.txt`) {
  write(repo, file, `${commits}\n`);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', `Change ${commits}`);
  return git(repo, 'rev-parse', 'HEAD');
}

// ── Agent results ──
const spec = ({ repo }: Ctx) => {
  write(repo, 'notes/spec.md', '# Spec\nAC1\n');
  return { artifactPath: 'notes/spec.md', summary: 'Spec', decisions: [] };
};
const plan =
  (extra: Record<string, Json> = {}) =>
  ({ repo }: Ctx) => {
    write(repo, 'notes/plan.md', `# Plan ${commits}\nAC1\n`);
    return {
      artifactPath: 'notes/plan.md',
      summary: 'Plan',
      checkCommands: ['git diff --quiet'],
      decisions: [],
      ...extra,
    };
  };
const badPlan = () => ({
  artifactPath: 'notes/missing.md',
  summary: 'Plan',
  checkCommands: [],
  decisions: [],
});
const build =
  (resolutions: Json[] = [], file?: string) =>
  ({ repo }: Ctx) => ({
    status: 'done',
    summary: 'Built',
    headCommit: commit(repo, file),
    questions: [],
    resolutions,
  });
const question = ({ repo }: Ctx) => ({
  status: 'question',
  summary: 'Need a decision',
  headCommit: git(repo, 'rev-parse', 'HEAD'),
  questions: [
    {
      question: 'Keep the old flag?',
      whyItMatters: 'API',
      recommendation: 'Yes',
    },
  ],
  resolutions: [],
});
const unusableBuild = () => ({
  status: 'done',
  summary: 'Built',
  headCommit: 'not-a-commit',
  questions: [],
  resolutions: [],
});
const finding = (id: string, owner: string, severity = 'major') => ({
  id,
  owner,
  severity,
  location: 'src/file.ts',
  details: 'Fixture finding',
});
const reviewer =
  (
    verdict: 'pass' | 'revise' | 'blocked',
    findings: Json[] = [],
    extra: Record<string, Json> = {},
  ) =>
  ({ input }: Ctx) => ({
    verdict,
    summary: `Review ${verdict}`,
    reviewedCommit: input.headCommit ?? null,
    criteria:
      input.planPath && !('criteria' in extra)
        ? [{ id: 'AC1', status: 'verified', evidence: 'Fixture test' }]
        : [],
    findings,
    resolutions: (input.priorReview?.findings ?? [])
      .filter((f) => f.severity !== 'minor')
      .map((f) => ({ id: f.id, status: 'resolved', evidence: 'Fixed' })),
    deliveryNotes: ['For delivery: mention the migration'],
    limitations: [],
    ...extra,
  });
const passingReview: Step[] = [
  ['agent', 'specReviewer', reviewer('pass')],
  [
    'agent',
    'codeReviewer',
    reviewer('pass', [finding('C1', 'build', 'minor')]),
  ],
];
const planReview =
  (verdict: string, findings: Json[] = []) =>
  () => ({
    verdict,
    summary: `Plan review ${verdict}`,
    findings: findings.map((f) => ({
      ...(f as Record<string, Json>),
      recommendation: 'Fix',
    })),
    limitations: verdict === 'blocked' ? ['Could not read the spec'] : [],
  });

// ── Driver ──
function waitingInput(engine: Engine, runId: string) {
  const run = engine.run(runId);
  const step = run.executions.at(-1);
  return run.status === 'waiting' &&
    step?.kind === 'input' &&
    step.status === 'waiting'
    ? step
    : undefined;
}
async function drive(
  engine: Engine,
  runId: string,
  repo: string,
  steps: Step[],
) {
  for (const [index, [kind, nodeId, result]] of steps.entries()) {
    const label = `step ${index} (${nodeId})`;
    await vi.waitFor(
      () => {
        const run = engine.run(runId);
        if (run.status === 'failed') throw new Error(`${label}: ${run.error}`);
        const ready =
          kind === 'agent'
            ? engine.available(runId).some((w) => w.nodeId === nodeId)
            : waitingInput(engine, runId)?.nodeId === nodeId;
        if (!ready)
          throw new Error(
            `${label}: waiting at ${run.executions.at(-1)?.nodeId} (${run.status})`,
          );
      },
      { timeout: 10000, interval: 10 },
    );
    if (kind === 'human') {
      const step = waitingInput(engine, runId)!;
      engine.externalInputs.answer(
        {
          action: 'answer',
          target: { kind: 'human', runId, executionId: step.id },
          value: result,
          expectedRevision: 0,
          submissionId: `answer-${index}`,
        },
        'mcp',
      );
      continue;
    }
    const work = engine.available(runId).find((w) => w.nodeId === nodeId)!;
    const fresh = work.context.mode === 'fresh';
    const claim = engine.claim(work.id, {
      workerId: fresh ? `fresh-${index}` : 'author',
      freshContext: fresh,
      tools: [],
      skills: [],
      session: {
        executorId: 'fixture',
        sessionId: fresh ? `fresh-${index}` : 'author',
      },
    });
    engine.submit(
      claim.id,
      claim.token!,
      result({ repo, input: work.input as WorkInput }),
    );
  }
}
async function simulate(input: Record<string, Json>, steps: Step[]) {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  importStarter(engine, { starterId: 'sdlc-v2', requestId: 'fixture' });
  const workflow = engine.store.workflows()[0];
  definition = engine.store.getVersion(workflow.id, 1)!.definition;
  const repo = repository();
  const run = engine.start(workflow.id, {
    request: 'Synthetic change',
    repoPath: repo,
    taskDir: 'notes',
    ...input,
  }).run;
  await drive(engine, run.id, repo, steps);
  await vi.waitFor(
    () => expect(['completed', 'failed']).toContain(engine.run(run.id).status),
    { timeout: 10000, interval: 10 },
  );
  const executions = engine.store.runs().flatMap((r) => r.executions);
  const done = new Set(executions.map((e) => e.nodeId));
  for (const edge of definition.edges)
    if (
      executions.some(
        (e) =>
          e.nodeId === edge.source &&
          e.status === 'completed' &&
          (e.port ?? 'default') === (edge.port ?? 'default'),
      ) ||
      (edge.port?.startsWith('branch:') && done.has(edge.target)) ||
      (edge.targetHandle === 'join' && done.has(edge.source))
    )
      covered.add(edge.id);
  const result = engine.run(run.id);
  expect(result.error).toBeUndefined();
  return {
    engine,
    run: result,
    output: result.output as Record<string, Json>,
    repo,
  };
}

const smallStart: Step[] = [['agent', 'plan', plan()]];
it('finishes a small change locally with verification and delivery reported apart', async () => {
  const { output } = await simulate({}, [
    ...smallStart,
    ['agent', 'build', build()],
    ...passingReview,
  ]);
  expect(output).toMatchObject({
    outcome: 'finished',
    verification: {
      status: 'passed',
      reviewRounds: 1,
      checksPassed: true,
      checks: [{ command: 'git diff --quiet', status: 'passed', attempts: 1 }],
      criteria: [{ id: 'AC1', status: 'verified' }],
      openFindings: [{ id: 'C1', severity: 'minor' }],
    },
    delivery: {
      status: 'local',
      prUrl: null,
      ci: 'not_applicable',
      notes: [
        'For delivery: mention the migration',
        'For delivery: mention the migration',
      ],
    },
  });
  const nodes = new Map(definition!.nodes.map((n) => [n.id, n]));
  for (const id of ['specReviewer', 'codeReviewer', 'planReview'])
    expect(nodes.get(id)).toMatchObject({ context: { mode: 'fresh' } });
});

it('reviews a standard plan, routes plan findings to the spec and the plan, and opens a PR', async () => {
  const { output } = await simulate({ size: 'standard', createPr: true }, [
    ['agent', 'spec', spec],
    ['agent', 'plan', plan()],
    ['agent', 'planReview', planReview('revise', [finding('P1', 'spec')])],
    ['agent', 'spec', spec],
    ['agent', 'plan', plan()],
    ['agent', 'planReview', planReview('revise', [finding('P2', 'plan')])],
    ['agent', 'plan', plan()],
    ['agent', 'planReview', planReview('ready')],
    ['agent', 'build', build()],
    ...passingReview,
    [
      'agent',
      'openPr',
      ({ input }) => {
        expect(input.review?.deliveryNotes).toHaveLength(2);
        return { prUrl: 'https://example.com/pr/1', summary: 'Opened' };
      },
    ],
  ]);
  expect(output.delivery).toMatchObject({
    status: 'pr_opened',
    prUrl: 'https://example.com/pr/1',
    ci: 'not_awaited',
  });
});

it('bounds plan result repair, asks about decisions and build questions, then fixes review findings', async () => {
  await simulate({}, [
    ['agent', 'plan', badPlan],
    ['agent', 'plan', badPlan],
    ['agent', 'plan', badPlan],
    ['human', 'planHuman', { choice: 'revise', comment: 'Write the file' }],
    [
      'agent',
      'plan',
      plan({
        decisions: [
          { question: 'Rename?', whyItMatters: 'Public', recommendation: 'No' },
        ],
      }),
    ],
    ['human', 'planHuman', { choice: 'approved' }],
    [
      'agent',
      'build',
      ({ input, repo }) => {
        expect(input.previous).toHaveProperty('humanResponse');
        return question({ repo, input });
      },
    ],
    ['human', 'questionHuman', 'Keep it'],
    [
      'agent',
      'build',
      (ctx) => {
        expect(ctx.input.previous).toBe('Keep it');
        return build()(ctx);
      },
    ],
    ['agent', 'specReviewer', reviewer('pass')],
    ['agent', 'codeReviewer', reviewer('revise', [finding('C1', 'build')])],
    [
      'agent',
      'build',
      (ctx) => {
        expect(feedback(ctx.input)).toContain('C1');
        return build([{ id: 'C1', status: 'fixed', details: 'Fixed' }])(ctx);
      },
    ],
    ...passingReview,
  ]);
});

it('stops when a person declines a blocked plan review', async () => {
  const { output } = await simulate({ size: 'standard' }, [
    ['agent', 'spec', spec],
    ['agent', 'plan', plan()],
    ['agent', 'planReview', planReview('blocked')],
    ['human', 'planHuman', { choice: 'stop' }],
  ]);
  expect(output).toMatchObject({
    outcome: 'stopped',
    verification: { status: 'not_reviewed', reviewRounds: 0 },
    delivery: { status: 'not_attempted' },
  });
});

it('routes change findings to the spec, asks at the round limit and extends it', async () => {
  const { output } = await simulate({ size: 'standard' }, [
    ['agent', 'spec', spec],
    ['agent', 'plan', plan()],
    ['agent', 'planReview', planReview('ready')],
    ['agent', 'build', build()],
    ['agent', 'specReviewer', reviewer('revise', [finding('S1', 'spec')])],
    ['agent', 'codeReviewer', reviewer('pass')],
    ['agent', 'spec', spec],
    // A change already reviewed skips a second plan review.
    ['agent', 'plan', plan()],
    ['agent', 'build', build()],
    ['agent', 'specReviewer', reviewer('pass')],
    ['agent', 'codeReviewer', reviewer('revise', [finding('C1', 'build')])],
    ['agent', 'build', build([{ id: 'C1', status: 'fixed', details: 'Done' }])],
    ['agent', 'specReviewer', reviewer('revise', [finding('S2', 'spec')])],
    ['agent', 'codeReviewer', reviewer('pass')],
    ['human', 'limitHuman', { choice: 'continue' }],
    ['agent', 'spec', spec],
    ['agent', 'plan', plan()],
    ['agent', 'build', build()],
    ...passingReview,
  ]);
  expect(output.verification).toMatchObject({
    status: 'passed',
    reviewRounds: 4,
  });
});

it('returns failing checks to the build once, bounds reviewer repair and stops at a blocked review', async () => {
  const { output } = await simulate({ checkCommands: ['test -f fixed.txt'] }, [
    ...smallStart,
    ['agent', 'build', build()],
    [
      'agent',
      'build',
      (ctx) => {
        expect(feedback(ctx.input)).toContain('test -f fixed.txt');
        return build([], 'fixed.txt')(ctx);
      },
    ],
    ['agent', 'specReviewer', reviewer('pass', [], { reviewedCommit: 'abc' })],
    ['agent', 'codeReviewer', reviewer('pass')],
    [
      'agent',
      'specReviewer',
      ({ input }) => {
        expect(input.formatFeedback).toContain('specReview reviewed');
        return reviewer('pass', [], { reviewedCommit: 'abc' })({
          repo: '',
          input,
        });
      },
    ],
    ['agent', 'codeReviewer', reviewer('pass')],
    ['human', 'limitHuman', { choice: 'continue' }],
    ['agent', 'specReviewer', reviewer('blocked')],
    ['agent', 'codeReviewer', reviewer('pass')],
    ['human', 'limitHuman', { choice: 'stop' }],
  ]);
  expect(output).toMatchObject({
    outcome: 'stopped',
    verification: {
      status: 'incomplete',
      checksPassed: true,
      checks: [{ command: 'test -f fixed.txt', status: 'passed' }],
    },
  });
});

it('bounds unusable build results, then routes findings to the plan at the round limit', async () => {
  await simulate({}, [
    ...smallStart,
    ['agent', 'build', unusableBuild],
    ['agent', 'build', unusableBuild],
    ['agent', 'build', unusableBuild],
    ['human', 'limitHuman', { choice: 'continue' }],
    ['agent', 'build', build()],
    ['agent', 'specReviewer', reviewer('pass')],
    ['agent', 'codeReviewer', reviewer('revise', [finding('C1', 'build')])],
    ['agent', 'build', build([{ id: 'C1', status: 'fixed', details: 'Done' }])],
    // Small changes have no spec, so a spec finding belongs to the plan.
    ['agent', 'specReviewer', reviewer('revise', [finding('S1', 'spec')])],
    ['agent', 'codeReviewer', reviewer('pass')],
    ['agent', 'plan', plan()],
    ['agent', 'build', build()],
    ['agent', 'specReviewer', reviewer('pass')],
    ['agent', 'codeReviewer', reviewer('revise', [finding('C2', 'plan')])],
    ['human', 'limitHuman', { choice: 'continue' }],
    ['agent', 'plan', plan()],
    ['agent', 'build', build()],
    ...passingReview,
  ]);
});

it('covers every route of the template across the cases above', () => {
  const missing = definition!.edges
    .filter((edge) => !covered.has(edge.id))
    .map((edge) => edge.id);
  expect(missing).toEqual([]);
});
