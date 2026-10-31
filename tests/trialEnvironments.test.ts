import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowComparison,
} from '@interlock/core';

const fixtures: { root: string; store: Store; engine: Engine }[] = [];
const worker = {
  workerId: 'local-fixture',
  freshContext: false,
  tools: [],
  skills: ['interlock-local-trials'],
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-trials-')),
    repository = join(root, 'source');
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repository,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  writeFileSync(join(repository, 'message.txt'), 'original\n');
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
  const commit = git('rev-parse', 'HEAD'),
    store = new Store(join(root, 'state.db'));
  const engine = new Engine(store, repository, {
    trialRoot: join(root, 'trials'),
  });
  fixtures.push({ root, store, engine });
  return { root, repository, commit, store, engine, git };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const f of fixtures.splice(0)) {
    f.engine.stop();
    f.store.close();
    await new Promise((r) => setTimeout(r, 30));
    rmSync(f.root, { recursive: true, force: true });
  }
});
async function until(check: () => void) {
  let error: unknown;
  for (let i = 0; i < 250; i++) {
    try {
      check();
      return;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw error;
}
function plan(
  f: ReturnType<typeof setup>,
  agent = false,
  language?: 'javascript' | 'legacy',
  command?: string,
) {
  const d = blankDefinition();
  if (!agent)
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'script',
      label: 'Write trial',
      language: language === 'legacy' ? undefined : 'javascript',
      command:
        command ??
        "const fs = require('node:fs'); const before = fs.readFileSync('message.txt', 'utf8'); fs.writeFileSync('message.txt', before + 'baseline'); return {before, cwd: process.cwd()};",
    });
  const w = f.engine.create('Local trial', '', d);
  f.engine.publish(w.id);
  if (!agent && d.nodes[1].kind === 'script')
    d.nodes[1].command = d.nodes[1].command.replace('baseline', 'candidate');
  f.engine.update(w.id, { draftRevision: w.draftRevision, draft: d });
  f.engine.publish(w.id);
  const suite = f.engine.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Cases',
      cases: [{ id: 'a', name: 'A', input: { task: 'original task' } }],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    concurrency: 2,
    trialSetup: {
      kind: 'local_git' as const,
      repository: f.repository,
      commit: f.commit,
    },
  };
  const preview = f.engine.testbench.preview(selection);
  expect(preview.canStart).toBe(true);
  const c = f.engine.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: crypto.randomUUID(),
  });
  return { id: c.id, selection, workflowId: w.id };
}
it('gates roots until independent fixed-commit checkouts exist, retains evidence, and cleans only trial clones', async () => {
  const f = setup(),
    c = plan(f);
  f.engine.pump();
  expect(f.store.runs()).toEqual([]);
  await until(() => {
    f.engine.pump();
    const r = f.engine.testbench.report({ id: c.id });
    expect(r.status).toBe('completed');
    expect(r.trials!.cleanupPending).toBe(0);
  });
  const report = f.engine.testbench.report({ id: c.id });
  expect(report.samples.map((s) => f.engine.run(s.runId!).input)).toEqual([
    { task: 'original task' },
    { task: 'original task' },
  ]);
  const outputs = report.samples.map(
    (s) => f.engine.run(s.runId!).output as { before: string; cwd: string },
  );
  expect(outputs.map((o) => o.before)).toEqual(['original\n', 'original\n']);
  expect(outputs[0].cwd).not.toBe(outputs[1].cwd);
  expect(readFileSync(join(f.repository, 'message.txt'), 'utf8')).toBe(
    'original\n',
  );
  for (const [index, sample] of report.samples.entries()) {
    const receipt = f.engine.testbench.readTrial({
      id: c.id,
      sampleId: sample.id,
    });
    expect(receipt.preparation).toBe('ready');
    expect(receipt.cleanup).toBe('complete');
    expect(existsSync(receipt.workspace!)).toBe(false);
    expect(readFileSync(receipt.artifacts!.patch, 'utf8')).toContain(
      index === 0 ? 'baseline' : 'candidate',
    );
    expect(JSON.stringify(sample)).not.toContain('ownerToken');
    expect(JSON.stringify(sample)).not.toContain(f.root);
  }
});
it('provides Agent workspace context separately, gates capabilities, and requires quiescent cleanup after cancellation', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const work = f.engine.available()[0];
  expect(work.input).toEqual({ task: 'original task' });
  expect(work.trialEnvironment!.workspace).not.toBe(f.repository);
  expect(() => f.engine.claim(work.id, { ...worker, skills: [] })).toThrow(
    'interlock-local-trials',
  );
  const claim = f.engine.claim(work.id, worker);
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupBlocked).toBe(
      1,
    ),
  );
  const sample = f.engine.testbench
    .report({ id: c.id })
    .samples.find((s) => s.runId === claim.runId)!;
  expect(existsSync(work.trialEnvironment!.workspace)).toBe(true);
  expect(() =>
    f.engine.testbench.cleanupTrial({ id: c.id, sampleId: sample.id }),
  ).toThrow('quiescent');
  f.engine.testbench.cleanupTrial({
    id: c.id,
    sampleId: sample.id,
    quiescent: true,
  });
  f.engine.pump();
  await until(() =>
    expect(
      f.engine.testbench.readTrial({ id: c.id, sampleId: sample.id }).cleanup,
    ).toBe('complete'),
  );
  expect(existsSync(f.repository)).toBe(true);
});

it('retains new files and uses a clean script environment without copying server credentials', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'fixture-secret');
  const f = setup(),
    c = plan(
      f,
      false,
      'javascript',
      "require('node:fs').writeFileSync('new.txt', 'new trial artifact'); return { hasToken: Boolean(process.env.GITHUB_TOKEN), id: process.env.INTERLOCK_TRIAL_ID };",
    );
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  for (const sample of f.engine.testbench.report({ id: c.id }).samples) {
    expect(f.engine.run(sample.runId!).output).toMatchObject({
      hasToken: false,
    });
    const receipt = f.engine.testbench.readTrial({
      id: c.id,
      sampleId: sample.id,
    });
    expect(
      readFileSync(join(receipt.artifacts!.untracked, 'new.txt'), 'utf8'),
    ).toBe('new trial artifact');
    expect(receipt.artifacts!.fileCount).toBe(1);
  }
  expect(existsSync(join(f.repository, 'new.txt'))).toBe(false);
});

it('keeps omitted-language Scripts on the Bash path in the prepared working directory', async () => {
  const f = setup(),
    c = plan(
      f,
      false,
      'legacy',
      `node -e 'const fs = require("node:fs"); fs.writeFileSync("legacy.txt", "legacy"); console.log(JSON.stringify({cwd:process.cwd(), id:process.env.INTERLOCK_TRIAL_ID}))'`,
    );
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  for (const sample of f.engine.testbench.report({ id: c.id }).samples)
    expect(f.engine.run(sample.runId!).status).toBe('completed');
  expect(existsSync(join(f.repository, 'legacy.txt'))).toBe(false);
});

it('records preparation failures without allocating roots or modifying the repository', async () => {
  const f = setup();
  f.commit = 'f'.repeat(40);
  const c = plan(f);
  await until(() => {
    f.engine.pump();
    const r = f.engine.testbench.report({ id: c.id });
    expect(r.status).toBe('completed');
    expect(r.trials!.cleanupPending).toBe(0);
  });
  expect(f.store.runs()).toEqual([]);
  expect(
    f.engine.testbench.report({ id: c.id }).trials!.preparationFailed,
  ).toBe(2);
  expect(readFileSync(join(f.repository, 'message.txt'), 'utf8')).toBe(
    'original\n',
  );
});

it('rejects tracked symlinks before checkout or work dispatch', async () => {
  const f = setup();
  symlinkSync(
    join(f.repository, 'message.txt'),
    join(f.repository, 'escape.txt'),
  );
  f.git('add', '.');
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'Symlink',
  );
  f.commit = f.git('rev-parse', 'HEAD');
  const c = plan(f);
  await until(() => {
    f.engine.pump();
    expect(
      f.engine.testbench.report({ id: c.id }).trials!.preparationFailed,
    ).toBe(2);
  });
  expect(f.store.runs()).toEqual([]);
  expect(
    f.engine.testbench.report({ id: c.id }).samples[0].trial!.error,
  ).toContain('symlinks');
});

it('rejects native Fetch effects in preview without creating a checkout or sending a request', () => {
  const f = setup(),
    definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'fetch',
    label: 'External writer',
    url: 'http://127.0.0.1:1/should-not-run',
    method: 'POST',
  });
  const w = f.engine.create('Unsupported trial', '', definition);
  f.engine.publish(w.id);
  const suite = f.engine.testbench.createSuite({
    workflowId: w.id,
    content: { name: 'Case', cases: [{ id: 'a', name: 'A', input: {} }] },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 1,
    trialSetup: {
      kind: 'local_git' as const,
      repository: f.repository,
      commit: f.commit,
    },
  };
  const preview = f.engine.testbench.preview(selection);
  expect(preview.canStart).toBe(false);
  expect(preview.blockers.join()).toContain('Fetch effects');
  expect(() =>
    f.engine.testbench.start({
      ...selection,
      confirmation: preview.confirmation,
      requestId: 'unsupported',
    }),
  ).toThrow('Fetch effects');
  expect(existsSync(join(f.root, 'trials'))).toBe(false);
  expect(f.store.runs()).toEqual([]);
});

it('rejects a stale ownership receipt before a claim consumes an attempt', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const work = f.engine.available()[0];
  const marker = join(work.trialEnvironment!.workspace, '..', 'owner.json');
  const original = readFileSync(marker, 'utf8');
  writeFileSync(marker, '{}');
  expect(() => f.engine.claim(work.id, worker)).toThrow('stale');
  expect(f.store.work().find((w) => w.id === work.id)!.attempt).toBe(0);
  writeFileSync(marker, original);
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    ),
  );
});

it('recovers interrupted cleanup conservatively and lets an explicit quiescent request finish it', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const claim = f.engine.claim(f.engine.available()[0].id, worker);
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      1,
    ),
  );
  const stored = f.store.get<WorkflowComparison>('comparisons', c.id)!,
    sample = stored.samples.find((s) => s.runId === claim.runId)!;
  sample.trial!.cleanup = 'running';
  sample.trial!.requiresQuiescence = false;
  f.store.put('comparisons', stored);
  f.engine.stop();
  f.store.close();
  fixtures.splice(
    fixtures.findIndex((x) => x.engine === f.engine),
    1,
  );
  const store = new Store(join(f.root, 'state.db')),
    engine = new Engine(store, f.repository, {
      trialRoot: join(f.root, 'trials'),
    });
  fixtures.push({ root: f.root, store, engine });
  expect(
    engine.testbench.readTrial({ id: c.id, sampleId: sample.id }),
  ).toMatchObject({ cleanup: 'blocked', requiresQuiescence: true });
  expect(() => engine.deleteWorkflow(c.workflowId)).toThrow('trial cleanup');
  engine.testbench.cleanupTrial({
    id: c.id,
    sampleId: sample.id,
    quiescent: true,
  });
  engine.pump();
  await until(() =>
    expect(
      engine.testbench.readTrial({ id: c.id, sampleId: sample.id }).cleanup,
    ).toBe('complete'),
  );
  expect(readFileSync(join(f.repository, 'message.txt'), 'utf8')).toBe(
    'original\n',
  );
});

function compareDefinition(
  f: ReturnType<typeof setup>,
  definition: ReturnType<typeof blankDefinition>,
  input: any = {},
  extra = {},
) {
  const w = f.engine.create('Trial fixture', '', definition);
  f.engine.publish(w.id);
  const suite = f.engine.testbench.createSuite({
    workflowId: w.id,
    content: { name: 'Cases', cases: [{ id: 'a', name: 'A', input }] },
  });
  const q = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 1,
    trialSetup: {
      kind: 'local_git' as const,
      repository: f.repository,
      commit: f.commit,
    },
    ...extra,
  };
  const p = f.engine.testbench.preview(q);
  expect(p.canStart).toBe(true);
  return f.engine.testbench.start({
    ...q,
    confirmation: p.confirmation,
    requestId: crypto.randomUUID(),
  });
}

it('queues repetitions at a fixed commit even after the source checkout changes', async () => {
  const f = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Read',
    language: 'javascript',
    command: "return require('node:fs').readFileSync('message.txt','utf8');",
  });
  const c = compareDefinition(f, d, {}, { repetitions: 3, concurrency: 1 });
  writeFileSync(join(f.repository, 'message.txt'), 'new source');
  f.git('add', '.');
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'Later source',
  );
  let maxActive = 0;
  await until(() => {
    f.engine.pump();
    const r = f.engine.testbench.report({ id: c.id });
    maxActive = Math.max(maxActive, r.activeTrees);
    expect(r.observed).toBe(6);
    expect(r.trials!.cleanupPending).toBe(0);
  });
  expect(maxActive).toBeLessThanOrEqual(1);
  for (const s of f.engine.testbench.report({ id: c.id }).samples)
    expect(f.engine.run(s.runId!).output).toBe('original\n');
  expect(readFileSync(join(f.repository, 'message.txt'), 'utf8')).toBe(
    'new source',
  );
});

it('keeps detached Batch descendants in the sample workspace and waits for their artifacts', async () => {
  const { batchDefinition, itemScript } = await import('./fixtures/batch');
  const { workflowCall } = await import('./fixtures/detached');
  const f = setup();
  const child = f.engine.create(
    'Batch writer',
    '',
    batchDefinition(
      itemScript(
        "const fs=require('node:fs'); fs.writeFileSync('item-'+input+'.txt', process.cwd()); return process.cwd();",
      ),
    ),
  );
  f.engine.publish(child.id);
  const c = compareDefinition(f, workflowCall(child.id, 'detached'), [1, 2]);
  await until(() => {
    f.engine.pump();
    const r = f.engine.testbench.report({ id: c.id });
    expect(r.status).toBe('completed');
    expect(r.trials!.cleanupPending).toBe(0);
  });
  for (const s of f.engine.testbench.report({ id: c.id }).samples) {
    const receipt = f.engine.testbench.readTrial({ id: c.id, sampleId: s.id });
    for (const n of [1, 2])
      expect(
        readFileSync(
          join(receipt.artifacts!.untracked, `item-${n}.txt`),
          'utf8',
        ),
      ).toContain(receipt.id);
    expect(receipt.artifacts!.fileCount).toBe(2);
  }
  expect(existsSync(join(f.repository, 'item-1.txt'))).toBe(false);
});

it('runs polling Script checks in the prepared workspace', async () => {
  const f = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Probe',
    timing: {
      kind: 'poll',
      everyMs: 1000,
      path: 'ready',
      equals: true,
      check: {
        kind: 'script',
        language: 'javascript',
        command:
          "require('node:fs').writeFileSync('probe.txt', process.env.INTERLOCK_TRIAL_ID); return {ready:true};",
      },
    },
  });
  const c = compareDefinition(f, d);
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  for (const s of f.engine.testbench.report({ id: c.id }).samples) {
    const t = f.engine.testbench.readTrial({ id: c.id, sampleId: s.id });
    expect(
      readFileSync(join(t.artifacts!.untracked, 'probe.txt'), 'utf8'),
    ).toBe(t.id);
  }
  expect(existsSync(join(f.repository, 'probe.txt'))).toBe(false);
});

it('waits for a cancelled native process to close before removing its workspace', async () => {
  const f = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Long work',
    language: 'javascript',
    command:
      "require('node:fs').writeFileSync('started.txt', 'started'); await new Promise(r=>setTimeout(r,30000)); require('node:fs').writeFileSync('late.txt','late'); return {};",
  });
  const c = compareDefinition(f, d);
  await until(() => {
    f.engine.pump();
    const samples = f.engine.testbench.report({ id: c.id }).samples;
    expect(
      samples.every(
        (s) =>
          s.runId &&
          existsSync(
            join(
              f.engine.testbench.readTrial({ id: c.id, sampleId: s.id })
                .workspace!,
              'started.txt',
            ),
          ),
      ),
    ).toBe(true);
  });
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    ),
  );
  for (const s of f.engine.testbench.report({ id: c.id }).samples) {
    const t = f.engine.testbench.readTrial({ id: c.id, sampleId: s.id });
    expect(existsSync(t.workspace!)).toBe(false);
    expect(existsSync(join(t.artifacts!.untracked, 'started.txt'))).toBe(true);
    expect(existsSync(join(t.artifacts!.untracked, 'late.txt'))).toBe(false);
  }
});

it('stops an expired Agent sample instead of issuing another attempt into uncertain state', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const claim = f.engine.claim(f.engine.available()[0].id, worker);
  const work = f.store.work().find((w) => w.id === claim.id)!;
  work.leaseUntil = new Date(0).toISOString();
  f.store.put('work', work);
  f.engine.pump();
  const s = f.engine.testbench
    .report({ id: c.id })
    .samples.find((s) => s.runId === claim.runId)!;
  expect(f.engine.run(claim.runId).status).toBe('cancelled');
  expect(
    f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }),
  ).toMatchObject({ cleanup: 'blocked', requiresQuiescence: true });
  expect(() => f.engine.claim(claim.id, worker)).toThrow('not available');
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.testbench.cleanupTrial({
    id: c.id,
    sampleId: s.id,
    quiescent: true,
  });
  f.engine.pump();
  await until(() =>
    expect(
      f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanup,
    ).toBe('complete'),
  );
});

it('retains a replaced workspace and never deletes the original source through a symlink', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const work = f.engine.available()[0],
    workspace = work.trialEnvironment!.workspace;
  rmSync(workspace, { recursive: true });
  symlinkSync(f.repository, workspace);
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupBlocked).toBe(
      1,
    ),
  );
  expect(readFileSync(join(f.repository, 'message.txt'), 'utf8')).toBe(
    'original\n',
  );
  expect(existsSync(workspace)).toBe(true);
});

it('recovers evidence after workspace removal and rejects replaced artifact control files', async () => {
  const { retainAndCleanGitTrial } =
    await import('../packages/runtime/src/localGitTrials');
  const f = setup(),
    c = plan(f);
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  const s = f.store.get<WorkflowComparison>('comparisons', c.id)!.samples[0],
    trial = { ...s.trial!, artifacts: undefined };
  const result = await retainAndCleanGitTrial(
    join(f.root, 'trials'),
    trial,
    new AbortController().signal,
  );
  expect(result).toEqual(s.trial!.artifacts);
  const receipt = join(trial.directory!, 'artifacts', 'receipt.json'),
    saved = readFileSync(receipt, 'utf8');
  const outside = join(f.root, 'outside.json');
  writeFileSync(outside, saved);
  rmSync(receipt);
  symlinkSync(outside, receipt);
  await expect(
    retainAndCleanGitTrial(
      join(f.root, 'trials'),
      trial,
      new AbortController().signal,
    ),
  ).rejects.toThrow('receipt was replaced');
  expect(readFileSync(outside, 'utf8')).toBe(saved);
});

it('fails interrupted preparation on restart without allocating a root', async () => {
  const f = setup(),
    c = plan(f, true);
  const stored = f.store.get<WorkflowComparison>('comparisons', c.id)!;
  for (const s of stored.samples) s.trial!.preparation = 'preparing';
  f.store.put('comparisons', stored);
  f.engine.stop();
  const engine = new Engine(f.store, f.repository, {
    trialRoot: join(f.root, 'trials'),
  });
  fixtures.find((x) => x.engine === f.engine)!.engine = engine;
  engine.pump();
  expect(engine.testbench.report({ id: c.id }).trials).toMatchObject({
    preparationFailed: 2,
    cleanupBlocked: 2,
  });
  expect(f.store.runs()).toHaveLength(0);
  for (const s of stored.samples)
    engine.testbench.cleanupTrial({
      id: c.id,
      sampleId: s.id,
      quiescent: true,
    });
  engine.pump();
  expect(engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(0);
});

it('cancels interrupted claimed samples on restart instead of accepting more work', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const claim = f.engine.claim(f.engine.available()[0].id, worker);
  f.engine.stop();
  const engine = new Engine(f.store, f.repository, {
    trialRoot: join(f.root, 'trials'),
  });
  fixtures.find((x) => x.engine === f.engine)!.engine = engine;
  engine.pump();
  expect(engine.run(claim.runId).status).toBe('cancelled');
  const s = engine.testbench
    .report({ id: c.id })
    .samples.find((s) => s.runId === claim.runId)!;
  expect(
    engine.testbench.readTrial({ id: c.id, sampleId: s.id }),
  ).toMatchObject({ requiresQuiescence: true, cleanup: 'blocked' });
  engine.testbench.cancel({ id: c.id, cancelDetached: true });
  engine.testbench.cleanupTrial({ id: c.id, sampleId: s.id, quiescent: true });
  engine.pump();
  await until(() =>
    expect(
      engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanup,
    ).toBe('complete'),
  );
});

it('retains oversized evidence and permits idempotent cleanup after the coordinator reduces it', async () => {
  const f = setup(),
    c = plan(f, true);
  await until(() => expect(f.engine.available()).toHaveLength(2));
  const work = f.engine.available()[0],
    claim = f.engine.claim(work.id, worker);
  writeFileSync(
    join(claim.trialEnvironment!.workspace, 'oversized.bin'),
    Buffer.alloc(32 * 1024 * 1024 + 1),
  );
  f.engine.submit(claim.id, claim.token!, { done: true });
  const s = f.engine.testbench
    .report({ id: c.id })
    .samples.find((s) => s.runId === claim.runId)!;
  await until(() =>
    expect(
      f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanup,
    ).toBe('blocked'),
  );
  expect(
    f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanupError,
  ).toContain('32 MiB');
  expect(existsSync(claim.trialEnvironment!.workspace)).toBe(true);
  rmSync(join(claim.trialEnvironment!.workspace, 'oversized.bin'));
  f.engine.testbench.cleanupTrial({ id: c.id, sampleId: s.id });
  f.engine.pump();
  await until(() =>
    expect(
      f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanup,
    ).toBe('complete'),
  );
  f.engine.testbench.cleanupTrial({ id: c.id, sampleId: s.id });
  f.engine.pump();
  expect(
    f.engine.testbench.readTrial({ id: c.id, sampleId: s.id }).cleanup,
  ).toBe('complete');
  f.engine.testbench.cancel({ id: c.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    ),
  );
});

it('runs the importable example in managed trials and fails ordinary starts before changing the fixture', async () => {
  const { definitionSchema } = await import('@interlock/core');
  const example = JSON.parse(
    readFileSync(
      new URL('../workflows/local-git-trial.json', import.meta.url),
      'utf8',
    ),
  );
  const f = setup();
  writeFileSync(join(f.repository, 'trial-fixture.txt'), 'original');
  f.git('add', '.');
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'Fixture',
  );
  f.commit = f.git('rev-parse', 'HEAD');
  const d = definitionSchema.parse(example.definition),
    c = compareDefinition(f, d);
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  for (const s of f.engine.testbench.report({ id: c.id }).samples)
    expect(f.engine.run(s.runId!).output).toMatchObject({
      before: 'original',
      after: 'original\nbaseline',
    });
  const ordinary = f.engine.start(c.workflowId, {}).run;
  await until(() => {
    f.engine.pump();
    expect(f.engine.run(ordinary.id).status).toBe('failed');
  });
  expect(readFileSync(join(f.repository, 'trial-fixture.txt'), 'utf8')).toBe(
    'original',
  );
});

it('preserves committed evidence across a partially removed workspace', async () => {
  const { retainAndCleanGitTrial } =
    await import('../packages/runtime/src/localGitTrials');
  const f = setup(),
    c = plan(f);
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    );
  });
  const t = f.store.get<WorkflowComparison>('comparisons', c.id)!.samples[0]
    .trial!;
  const patch = readFileSync(t.artifacts!.patch, 'utf8');
  mkdirSync(t.workspace!);
  writeFileSync(join(t.workspace!, 'leftover.txt'), 'partially removed');
  const recovered = await retainAndCleanGitTrial(
    join(f.root, 'trials'),
    { ...t, artifacts: undefined },
    new AbortController().signal,
  );
  expect(recovered).toEqual(t.artifacts);
  expect(existsSync(t.workspace!)).toBe(false);
  expect(readFileSync(t.artifacts!.patch, 'utf8')).toBe(patch);
});

it('reserves global capacity across ordinary and managed comparisons', async () => {
  const f = setup();
  const ordinary = compareDefinition(
    f,
    blankDefinition(),
    {},
    { repetitions: 5, concurrency: 9, trialSetup: undefined },
  );
  f.engine.pump();
  expect(f.engine.testbench.report({ id: ordinary.id }).activeTrees).toBe(9);
  const managed = plan(f, true);
  f.engine.pump();
  const reserved = f.store
    .get<WorkflowComparison>('comparisons', managed.id)!
    .samples.filter((s) => s.trial!.preparation === 'preparing');
  expect(reserved).toHaveLength(1);
  await until(() => {
    f.engine.pump();
    expect(f.engine.testbench.report({ id: managed.id }).activeTrees).toBe(1);
  });
  expect(f.engine.testbench.report({ id: ordinary.id }).activeTrees).toBe(9);
  f.engine.testbench.cancel({ id: ordinary.id, cancelDetached: true });
  f.engine.testbench.cancel({ id: managed.id, cancelDetached: true });
  f.engine.pump();
  await until(() =>
    expect(
      f.engine.testbench.report({ id: managed.id }).trials!.cleanupPending,
    ).toBe(0),
  );
});

it('rejects nested Fetch polling before a fake external service can be modified', async () => {
  const { createServer } = await import('node:http');
  const { workflowCall } = await import('./fixtures/detached');
  let requests = 0;
  const server = createServer((_q, r) => {
    requests++;
    r.end('{"ready":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const a = server.address();
    if (!a || typeof a === 'string') throw new Error('No port');
    const f = setup(),
      d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'wait',
      label: 'External probe',
      timing: {
        kind: 'poll',
        everyMs: 1000,
        path: 'body.ready',
        equals: true,
        check: {
          kind: 'fetch',
          url: `http://127.0.0.1:${a.port}/mutate`,
          method: 'POST',
        },
      },
    });
    const child = f.engine.create('External', '', d);
    f.engine.publish(child.id);
    const parent = f.engine.create('Nested', '', workflowCall(child.id));
    f.engine.publish(parent.id);
    const suite = f.engine.testbench.createSuite({
      workflowId: parent.id,
      content: { name: 'Cases', cases: [{ id: 'a', name: 'A', input: {} }] },
    });
    const q = {
      suiteId: suite.id,
      suiteRevision: 1,
      baselineVersion: 1,
      candidateVersion: 1,
      trialSetup: {
        kind: 'local_git' as const,
        repository: f.repository,
        commit: f.commit,
      },
    };
    const p = f.engine.testbench.preview(q);
    expect(p.canStart).toBe(false);
    expect(p.blockers.join()).toContain('Fetch effects');
    expect(() =>
      f.engine.testbench.start({
        ...q,
        confirmation: p.confirmation,
        requestId: 'fake-service',
      }),
    ).toThrow('Fetch effects');
    expect(requests).toBe(0);
    expect(f.store.runs()).toHaveLength(0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

it('requires reconciliation for pending polling Scripts after restart', async () => {
  const f = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Pending probe',
    timing: {
      kind: 'poll',
      everyMs: 1000,
      path: 'ready',
      equals: true,
      check: {
        kind: 'script',
        language: 'javascript',
        command: 'return {ready:false};',
      },
    },
  });
  const c = compareDefinition(f, d);
  await until(() => {
    f.engine.pump();
    expect(
      f.store
        .runs()
        .filter((r) => r.executions.some((e) => e.check?.count === 1)),
    ).toHaveLength(2);
  });
  f.engine.stop();
  const engine = new Engine(f.store, f.repository, {
    trialRoot: join(f.root, 'trials'),
  });
  fixtures.find((x) => x.engine === f.engine)!.engine = engine;
  engine.pump();
  expect(engine.testbench.report({ id: c.id }).trials!.cleanupBlocked).toBe(2);
  for (const s of engine.testbench.report({ id: c.id }).samples) {
    expect(engine.run(s.runId!).status).toBe('cancelled');
    engine.testbench.cleanupTrial({
      id: c.id,
      sampleId: s.id,
      quiescent: true,
    });
  }
  engine.pump();
  await until(() =>
    expect(engine.testbench.report({ id: c.id }).trials!.cleanupPending).toBe(
      0,
    ),
  );
});
