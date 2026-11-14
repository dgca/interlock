import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import type { Json, TestSuite } from '@interlock/core';
import { importStarter } from '../packages/server/src/starters';
import bundle from '../workflows/sdlc-v2.json';
import suites from './fixtures/sdlc-v2-suites.json';

const engines: Engine[] = [],
  dirs: string[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Report = {
  state: string;
  error?: string;
  unsupported: { items: string[] };
  coverage?: { untested: { edgeId: string }[] };
};
async function simulate(e: Engine, suite: TestSuite, caseId: string) {
  const requestId = `${suite.workflowId}-${caseId}`;
  e.simulations.request({
    action: 'run',
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId,
    version: e.workflow(suite.workflowId).latestVersion,
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
  throw new Error(
    `${caseId} did not settle: ${JSON.stringify(e.simulations.request({ action: 'get', id: requestId }))}`.slice(
      0,
      3000,
    ),
  );
}

// The saved suites drive SDLC v2 and both helpers through the built-in
// fixture simulator, as a user would after editing a copy. Every edge of each
// workflow must be traversed by at least one case.
it('simulates every route of SDLC v2, Plan review and Change review', async () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  importStarter(e, { starterId: 'sdlc-v2', requestId: 'simulate' });
  const copies = e.store.list<{ id: string; starterId: string }>(
    'starterCopies',
  );
  for (const [key, content] of Object.entries(suites)) {
    const starterId = key === bundle.rootId ? 'sdlc-v2' : `sdlc-v2/${key}`;
    const workflowId = copies.find((c) => c.starterId === starterId)!.id;
    const suite = e.testbench.createSuite({
      workflowId,
      content: content as Parameters<
        Engine['testbench']['createSuite']
      >[0]['content'],
    });
    let untested: string[] | undefined;
    for (const { id } of content.cases) {
      const report = await simulate(e, suite, id);
      expect(
        report.state,
        `${key} ${id}: ${report.error ?? report.unsupported.items.join('; ')}`,
      ).toBe('passed');
      const missed = report.coverage!.untested.map((u) => u.edgeId);
      untested = (untested ?? missed).filter((edge) => missed.includes(edge));
    }
    expect(untested, `${key} edges no case traverses`).toEqual([]);
  }
});

// One check of the real Script logic against a temporary Git repository. The
// Scripts run in-process; Git is the only subprocess.
const scripts = (id: string) =>
  Object.fromEntries(
    bundle.workflows
      .find((w) => w.id === id)!
      .draft.nodes.flatMap((n) =>
        'command' in n && typeof n.command === 'string'
          ? [[n.id, n.command]]
          : [],
      ),
  ) as Record<string, string>;
type Output = {
  taskDir: string;
  route: string;
  verdict: string;
  checks: { outputTail: string }[];
};
const AsyncFunction = (async () => {}).constructor as unknown as new (
  ...args: string[]
) => (
  input: unknown,
  load: (name: string) => Promise<unknown>,
) => Promise<Output>;
// The test runner cannot resolve import() inside a constructed function.
const run = (command: string, input: unknown) =>
  new AsyncFunction('input', 'load', command.replaceAll('import(', 'load('))(
    input,
    (name) => import(name),
  );

it('runs the setup, check, verdict, routing and delivery Scripts on a real repository', async () => {
  const S = scripts(bundle.rootId),
    C = scripts(`${bundle.rootId}-change-review`);
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-sdlc-v2-')));
  dirs.push(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-qm', 'base');

  const root = await run(S.setup, {
    run: { repoPath: repo, request: 'Fix reimport!', issue: 'o/r/issues/403' },
  });
  expect(root).toMatchObject({ size: 'small', createPr: false });
  expect(root.taskDir).toMatch(/^\.tasks\/403-fix-reimport-/);
  expect(existsSync(join(repo, root.taskDir))).toBe(true);
  await expect(
    run(S.setup, { run: { repoPath: repo, request: 'x', taskDir: '../out' } }),
  ).rejects.toThrow(/inside/);

  // Approval covers only the plan text the person saw.
  const planPath = join(root.taskDir, 'plan.md');
  writeFileSync(join(repo, planPath), '# plan\nAC1');
  const plan = { artifactPath: planPath, summary: 's', decisions: [] };
  const capture = await run(S.planAsk, {
    root,
    plan,
    ask: { question: 'q', context: 'c' },
  });
  writeFileSync(join(repo, planPath), '# changed');
  expect(
    (await run(S.planDecision, { capture, answer: { choice: 'approved' } }))
      .route,
  ).toBe('revise');

  git('checkout', '-qb', 'task');
  writeFileSync(join(repo, 'b.txt'), 'b');
  git('add', '.');
  git('commit', '-qm', 'change');
  const head = git('rev-parse', 'HEAD');
  // A failing command is retried once; a pass on retry is reported as flaky.
  const flag = join(repo, '.git', 'flaky');
  const pre = await run(C.checks, {
    run: {
      repoPath: repo,
      baseRef: 'main',
      checkCommands: [
        `test -e ${flag} || { touch ${flag}; exit 1; }`,
        'exit 3',
      ],
    },
  });
  expect(pre).toMatchObject({ headCommit: head, checksPassed: false });
  expect(pre.checks).toMatchObject([
    { status: 'passed', attempts: 2 },
    { status: 'failed', exitCode: 3, attempts: 2 },
  ]);
  expect(pre.checks[0].outputTail).toMatch(/second attempt/);

  // A failed check holds the change unless an environment finding names it.
  const review = (findings: Json[]) => ({
    verdict: 'pass',
    summary: 's',
    reviewedCommit: head,
    reviewScope: 'full',
    criteria: [{ id: 'AC1', status: 'verified', evidence: 'e' }],
    findings,
    resolutions: [],
    limitations: [],
  });
  expect((await run(C.normalize, { pre, review: review([]) })).verdict).toBe(
    'revise',
  );
  const finding = (owner: string, location: string) => ({
    id: 'E1',
    owner,
    severity: 'major',
    location,
    details: 'Fails the same way at the base commit',
  });
  const excused = await run(C.normalize, {
    pre: { ...pre, checks: [pre.checks[1]] },
    review: review([finding('environment', 'exit 3')]),
  });
  expect(excused).toMatchObject({
    verdict: 'pass',
    findings: [{ severity: 'minor' }],
  });

  // Plan-owned findings return to planning; the round limit asks a person.
  const plans = await run(C.normalize, {
    pre: { ...pre, checksPassed: true, checks: [] },
    review: review([finding('plan', 'plan.md')]),
  });
  expect((await run(S.reviewRoute, { review: plans, count: 1 })).route).toBe(
    'replan',
  );
  expect((await run(S.reviewRoute, { review: plans, count: 3 })).route).toBe(
    'ask',
  );

  // Delivery refuses a checkout that moved after review.
  expect((await run(S.deliverCheck, { root, review: excused })).route).toBe(
    'local',
  );
  writeFileSync(join(repo, 'c.txt'), 'c');
  git('add', '.');
  git('commit', '-qm', 'more');
  await expect(run(S.deliverCheck, { root, review: excused })).rejects.toThrow(
    /Review the new commit/,
  );
});
