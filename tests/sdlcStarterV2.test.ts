import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import prWatcher from '../workflows/pr-watcher.json';
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

// Every starter workflow inherits the shared default, so one choice covers
// them all. Both reviewers carry the same read-only policy, so under Standard
// they read without asking and still ask before any edit.
it('ships every workflow without a permission level and reviewers with a read-only policy', () => {
  const levels = (b: { workflows: unknown[] }) =>
    (
      b.workflows as {
        name: string;
        draft: { agentPermissions?: string };
        versions: { definition: { agentPermissions?: string } }[];
      }[]
    ).map((w) => [
      w.name,
      [w.draft, ...w.versions.map((v) => v.definition)].map(
        (d) => d.agentPermissions ?? null,
      ),
    ]);
  expect(levels(bundle)).toEqual([
    ['SDLC workflow', [null]],
    ['Plan review', [null, null]],
    ['Change review', [null, null]],
  ]);
  const [, plan, change] = bundle.workflows;
  for (const definition of [plan.draft, plan.versions[0].definition])
    expect(definition.permissionPolicy).toEqual(change.draft.permissionPolicy);
  const rules = change.draft.permissionPolicy.allow.map((rule) =>
    'pattern' in rule ? rule.pattern : rule.kind,
  );
  for (const write of ['edit', 'git add *', 'git commit *'])
    expect(rules).not.toContain(write);
  expect(levels(prWatcher).flatMap(([, l]) => l)).not.toContain('standard');
});

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
  verification: string;
  feedback: string;
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

  // Scripts run in the run's worktree when it has one, otherwise in repoPath.
  const inDir = async (dir: string, input: unknown) => {
    const before = process.cwd();
    process.chdir(dir);
    try {
      return await run(S.setup, input);
    } finally {
      process.chdir(before);
    }
  };
  const root = await inDir(repo, {
    run: { repoPath: repo, request: 'Fix reimport!', issue: 'o/r/issues/403' },
  });
  expect(root).toMatchObject({ size: 'small', createPr: false });
  expect(root.taskDir).toMatch(/^\.tasks\/403-fix-reimport-/);
  expect(existsSync(join(repo, root.taskDir))).toBe(true);
  await expect(
    inDir(repo, { run: { repoPath: repo, request: 'x', taskDir: '../out' } }),
  ).rejects.toThrow(/inside/);

  // Without its own worktree, a dirty checkout is refused. In a run's own
  // worktree, a passed repoPath does not move the work to the main checkout.
  writeFileSync(join(repo, 'a.txt'), 'dirty');
  await expect(
    inDir(repo, { run: { repoPath: repo, request: 'x' } }),
  ).rejects.toThrow(/uncommitted changes/);
  const tree = join(repo, '..', `${repo.split('/').at(-1)}-tree`);
  dirs.push(tree);
  git('worktree', 'add', '-q', '-b', 'interlock/run-1', tree, 'HEAD');
  process.env.INTERLOCK_ROOT_RUN_ID = 'run-1';
  try {
    expect(
      await inDir(tree, { run: { repoPath: repo, request: 'x' } }),
    ).toMatchObject({ repoPath: realpathSync(tree), dedicatedBranch: true });
  } finally {
    delete process.env.INTERLOCK_ROOT_RUN_ID;
  }
  git('checkout', '-q', 'a.txt');

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

  // Three question rounds, then the shared limit checkpoint; continuing
  // starts a new count and does not extend the review round limit.
  const asking = {
    summary: 's',
    questions: [{ question: 'q', whyItMatters: 'w', recommendation: 'r' }],
  };
  let gate: Output | null = null;
  for (const expected of ['ask', 'ask', 'ask', 'limit']) {
    gate = await run(S.questionGate, { build: asking, prior: gate });
    expect(gate.route).toBe(expected);
  }
  const grant = await run(S.limitGrant, {
    asked: await run(S.limitAsk, { ask: gate }),
    answer: { choice: 'continue' },
  });
  expect(grant.route).toBe('build');
  expect(grant.feedback).toMatch(/without further questions/);
  expect(
    (await run(S.questionGate, { build: asking, prior: gate })).route,
  ).toBe('ask');
  expect(
    (await run(S.reviewRoute, { review: plans, count: 3, grant })).route,
  ).toBe('ask');
  // A review-round extension survives a later question-limit decision.
  const rounds = await run(S.limitGrant, {
    asked: { kind: 'rounds', resume: 'plan', round: 3, feedback: '' },
    answer: { choice: 'continue' },
    prior: null,
  });
  const later = await run(S.limitGrant, {
    asked: await run(S.limitAsk, { ask: gate }),
    answer: { choice: 'continue' },
    prior: rounds,
  });
  expect(
    (await run(S.reviewRoute, { review: plans, count: 4, grant: later })).route,
  ).toBe('replan');

  // Check commands skipped on a dirty checkout hold the round, and the result
  // can never report verification passed for them.
  writeFileSync(join(repo, 'b.txt'), 'dirty');
  const skipped = await run(C.checks, {
    run: { repoPath: repo, baseRef: 'main', checkCommands: ['true'] },
  });
  git('checkout', '-q', 'b.txt');
  expect(skipped.checks).toMatchObject([{ status: 'not_run' }]);
  const unproven = await run(C.normalize, { pre: skipped, review: review([]) });
  expect(unproven).toMatchObject({
    verdict: 'revise',
    findings: [{ id: 'rule-checks', severity: 'major' }],
  });
  expect(
    (
      await run(S.result, {
        root,
        review: { ...unproven, verdict: 'pass', findings: [] },
        deliver: { branch: 'task', reviewedCommit: head },
        pr: null,
      })
    ).verification,
  ).toBe('incomplete');

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

// The delivery Script against a temporary repository whose pushes go to a
// local bare repository, with a stub gh first on PATH. Each reason the Script
// cannot deliver hands delivery to the agent; other failures block it.
it('pushes and opens the pull request with gh, or hands delivery to the agent', async () => {
  const S = scripts(bundle.rootId);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-sdlc-pr-')));
  dirs.push(dir);
  const [repo, bare, bin, gh] = ['repo', 'bare.git', 'bin', 'gh'].map((d) =>
    join(dir, d),
  );
  for (const d of [repo, bin, gh]) mkdirSync(d);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
  }).trim();
  const git = (...args: string[]) =>
    execFileSync(realGit, args, { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync(realGit, ['init', '-q', '--bare', bare]);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'interlock/run-1');
  writeFileSync(join(repo, 'b.txt'), 'b');
  git('add', '.');
  git('commit', '-qm', 'change');
  const head = git('rev-parse', 'HEAD');
  // gh reads the fetch URL; pushes go to the bare repository.
  git('remote', 'add', 'origin', 'git@ghe.example.test:o/r.git');
  git('config', 'remote.origin.pushurl', bare);
  const pushed = () =>
    execFileSync(realGit, ['branch', '--list', 'interlock/run-1'], {
      cwd: bare,
      encoding: 'utf8',
    }).trim();

  // Only the stubs are on PATH, so gh is missing until the stub is written.
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`, {
    mode: 0o755,
  });
  const stub = `#!/bin/sh
D='${gh}'
open='[{"url":"https://ghe.example.test/o/r/pull/7","baseRefName":"develop","isDraft":false}]'
case "$1 $2" in
  "--version "*) echo 'gh version 2.0.0' ;;
  "auth status") echo "$3" >> "$D/hosts"; [ -e "$D/signed-in" ] || { echo 'not logged in' >&2; exit 1; } ;;
  "pr list") if [ -e "$D/list-fails" ]; then echo 'HTTP 502' >&2; exit 1; fi
    if [ -e "$D/existing" ]; then echo "$open"; else echo '[]'; fi ;;
  "pr create") printf '%s\\n' "$@" > "$D/args"; /bin/cat > "$D/body"
    if [ -e "$D/fail-late" ]; then : > "$D/existing"; echo "could not add label: 'bug' not found" >&2; exit 1; fi
    if [ -e "$D/fail-create" ]; then echo 'base branch not found' >&2; exit 1; fi
    echo 'https://ghe.example.test/o/r/pull/8' ;;
esac
`;
  const flag = (name: string, on: boolean) =>
    on
      ? writeFileSync(join(gh, name), '')
      : rmSync(join(gh, name), { force: true });
  const deliver = { branch: 'interlock/run-1', reviewedCommit: head };
  const describe = {
    title: '-Fix: reimport',
    description: 'What changed',
    draft: true,
    labels: ['bug'],
    reviewers: [],
    baseBranch: 'main',
  };
  // A run without its own worktree starts on main; the build commits on a
  // task branch. setup records the delivery remote before any agent runs.
  let root = {} as Output;
  const start = async (from = 'main') => {
    const before = process.cwd();
    git('checkout', '-q', from);
    process.chdir(repo);
    try {
      root = await run(S.setup, {
        run: { repoPath: repo, request: 'x', createPr: true, taskDir: '.t' },
      });
    } finally {
      process.chdir(before);
      git('checkout', '-q', 'interlock/run-1');
    }
  };
  const path = process.env.PATH;
  process.env.PATH = bin;
  type Published = {
    route: string;
    reason: string;
    prUrl: string | null;
    notes: string[];
  };
  const publish = async (changes: object = {}) =>
    (await run(S.publishPr, {
      root,
      deliver,
      describe: { ...describe, ...changes },
    })) as unknown as Published;
  const expectRoute = async (
    route: string,
    reason: RegExp,
    changes: object = {},
  ) => {
    const r = await publish(changes);
    expect(r.route).toBe(route);
    expect(r.reason).toMatch(reason);
    return r;
  };
  try {
    await start();
    await expectRoute('fallback', /gh is not installed/);
    writeFileSync(join(bin, 'gh'), stub, { mode: 0o755 });
    // An unknown host, such as an ssh alias, is left to the agent.
    await expectRoute(
      'fallback',
      /ghe\.example\.test, could not be matched to a host gh is signed in to/,
    );
    git('remote', 'set-url', 'origin', 'https://github.com/o/r.git');
    await start();
    await expectRoute('fallback', /^gh is not signed in to github\.com\.$/);
    git('remote', 'set-url', 'origin', bare);
    await start();
    await expectRoute('fallback', /not a GitHub repository/);

    // A GitHub Enterprise host gh is signed in to, given in scp form.
    git('remote', 'set-url', 'origin', 'git@ghe.example.test:o/r.git');
    await start();
    flag('signed-in', true);

    // Nothing is pushed to the branch a pull request merges into.
    await expectRoute('blocked', /does not push it/, {
      baseBranch: 'interlock/run-1',
    });
    git(
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/interlock/run-1',
    );
    await expectRoute('blocked', /does not push it/);
    git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    await start('interlock/run-1');
    await expectRoute('blocked', /does not push it/);
    expect(pushed()).toBe('');
    await start();

    // Forks are ambiguous; a remote an agent redirected blocks delivery.
    git('remote', 'add', 'upstream', 'git@ghe.example.test:u/r.git');
    await expectRoute('fallback', /Several remotes are on ghe\.example\.test/);
    git('remote', 'remove', 'upstream');
    git('config', 'remote.pushDefault', 'fork');
    await expectRoute(
      'fallback',
      /configured to push interlock\/run-1 to fork/,
    );
    git('config', '--unset', 'remote.pushDefault');
    git('remote', 'set-url', '--push', 'origin', join(dir, 'elsewhere.git'));
    await expectRoute('blocked', /changed after the run started/);
    git('remote', 'set-url', '--push', 'origin', bare);

    writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });
    await expectRoute('fallback', /git push to origin was rejected/);
    rmSync(join(bare, 'hooks', 'pre-receive'));
    // An untracked file outside the task folder would be missing.
    writeFileSync(join(repo, 'forgot.txt'), 'f');
    expect(await publish()).toMatchObject({
      route: 'opened',
      prUrl: 'https://ghe.example.test/o/r/pull/8',
      existing: false,
      notes: [expect.stringMatching(/^1 untracked file .*: forgot\.txt\.$/)],
    });
    rmSync(join(repo, 'forgot.txt'));
    expect(readFileSync(join(gh, 'hosts'), 'utf8')).toMatch(
      /--hostname=ghe\.example\.test/,
    );
    expect(
      execFileSync(realGit, ['rev-parse', 'interlock/run-1'], {
        cwd: bare,
        encoding: 'utf8',
      }).trim(),
    ).toBe(head);
    const args = readFileSync(join(gh, 'args'), 'utf8').split('\n');
    expect(args).toEqual(
      expect.arrayContaining([
        '--head=interlock/run-1',
        '--title=-Fix: reimport',
        '--body-file=-',
        '--base=main',
        '--draft',
        '--label=bug',
      ]),
    );
    expect(args.some((a) => a.startsWith('--repo'))).toBe(false);
    expect(readFileSync(join(gh, 'body'), 'utf8')).toBe('What changed');

    // An open pull request for the branch is reused, not created again, and
    // differences from what was asked for are noted.
    rmSync(join(gh, 'args'));
    flag('existing', true);
    expect(await publish()).toMatchObject({
      route: 'opened',
      prUrl: 'https://ghe.example.test/o/r/pull/7',
      existing: true,
      notes: [
        'The open pull request merges into develop, not main.',
        expect.stringMatching(/is not a draft/),
      ],
    });
    expect(existsSync(join(gh, 'args'))).toBe(false);
    flag('list-fails', true);
    await expectRoute('blocked', /could not look up pull requests.*HTTP 502/);
    flag('list-fails', false);
    flag('existing', false);
    // gh can fail after it opened the pull request.
    flag('fail-late', true);
    const late = await expectRoute(
      'opened',
      /after opening the pull request.*'bug'/,
    );
    expect(late).toMatchObject({
      prUrl: 'https://ghe.example.test/o/r/pull/7',
      notes: [],
    });
    flag('fail-late', false);
    flag('existing', false);
    flag('fail-create', true);
    await expectRoute(
      'blocked',
      /^gh pr create failed: base branch not found$/,
    );

    // The Script pushes only the reviewed commit, with nothing uncommitted.
    writeFileSync(join(repo, 'b.txt'), 'dirty');
    await expect(
      run(S.deliverCheck, {
        root,
        review: { verdict: 'pass', reviewedCommit: head },
      }),
    ).rejects.toThrow(/uncommitted changes/);
    await expectRoute('blocked', /uncommitted changes/);
    git('checkout', '-q', 'b.txt');
    git('commit', '-q', '--allow-empty', '-m', 'after review');
    await expectRoute('blocked', /moved to/);
  } finally {
    process.env.PATH = path;
  }

  // The result names the reason the agent delivered, or why nothing was.
  const review = {
    summary: 'Reviewed.',
    findings: [],
    limitations: [],
    checksPassed: true,
    checks: [],
  };
  const reason = 'gh is not signed in to github.com.';
  const fallback = { route: 'fallback', reason, prUrl: null, existing: false };
  expect(
    await run(S.result, {
      root,
      review,
      deliver,
      publish: fallback,
      pr: { prUrl: null, summary: 'No credentials.' },
    }),
  ).toMatchObject({
    outcome: 'delivery_blocked',
    prUrl: null,
    limitations: [expect.stringContaining(reason)],
  });
  expect(
    await run(S.result, {
      root,
      review,
      deliver,
      publish: {
        route: 'opened',
        reason: null,
        prUrl: 'https://ghe.example.test/o/r/pull/7',
        existing: true,
        summary: 'Pushed.',
      },
      pr: null,
    }),
  ).toMatchObject({
    outcome: 'pr_created',
    prUrl: 'https://ghe.example.test/o/r/pull/7',
    limitations: [
      expect.stringMatching(/already existed/),
      "The pull request's own CI had not finished when this workflow ended.",
    ],
  });
});
