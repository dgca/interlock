import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { definitionSchema, nodeSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition, itemAgent } from './fixtures/batch';

const fixtures: { root: string; engines: Engine[] }[] = [];
const session = { executorId: 'harness', sessionId: 'author' };
const worker = {
  workerId: 'worker',
  freshContext: false,
  tools: [],
  skills: [],
  session,
};

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-ws-')));
  const repository = join(root, 'repo');
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repository,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repository, 'file.txt'), 'original\n');
  git('add', '.');
  git(
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-qm',
    'Base',
  );
  const fixture = { root, engines: [] as Engine[] };
  fixtures.push(fixture);
  const open = () => {
    const engine = new Engine(new Store(join(root, 'state.db')), repository);
    fixture.engines.push(engine);
    return engine;
  };
  const worktrees = () =>
    git('worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => realpathSync(line.slice(9)));
  return { root, repository, git, open, worktrees };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const f of fixtures.splice(0)) {
    for (const engine of f.engines) {
      engine.stop();
      engine.store.close();
    }
    await new Promise((r) => setTimeout(r, 30));
    rmSync(f.root, { recursive: true, force: true });
  }
});
async function until<T>(
  engine: Engine,
  check: () => T | false | undefined,
): Promise<T> {
  let error = new Error('Timed out');
  for (let i = 0; i < 300; i++) {
    engine.pump();
    try {
      const value = check();
      if (value !== false && value !== undefined) return value;
    } catch (e) {
      error = e as Error;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw error;
}
function publish(engine: Engine, definition: unknown) {
  const workflow = engine.create(
    'Workspace',
    '',
    definitionSchema.parse(definition),
  );
  engine.publish(workflow.id);
  return workflow.id;
}
const agent = (id: string) =>
  nodeSchema.parse({
    id,
    kind: 'agent',
    label: id,
    prompt: 'Work.',
    context: { continuityGroup: 'author' },
  });

it('gives concurrent runs separate worktrees, keeps continuity there, and removes them on completion', async () => {
  const f = setup();
  const engine = f.open();
  const id = publish(engine, {
    workspace: { repository: f.repository, branch: 'agent/{runId}' },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      {
        id: 'script',
        kind: 'script',
        label: 'Edit',
        language: 'javascript',
        command:
          "require('node:fs').appendFileSync('file.txt', 'run\\n'); require('node:child_process').execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-qam', 'run']); return { cwd: process.cwd() };",
      },
      agent('first'),
      agent('second'),
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'script' },
      { id: 'b', source: 'script', target: 'first' },
      { id: 'c', source: 'first', target: 'second' },
      { id: 'd', source: 'second', target: 'exit' },
    ],
  });
  const runs = [engine.start(id, {}).run.id, engine.start(id, {}).run.id];
  const paths: string[] = [];
  for (const runId of runs) {
    const first = await until(engine, () => engine.available(runId)[0]);
    const script = engine
      .run(runId)
      .executions.find((e) => e.nodeId === 'script')!;
    expect(first.resolvedCwd).toBe(script.resolvedCwd);
    paths.push(first.resolvedCwd!);
    const claimed = engine.claim(first.id, worker);
    engine.submit(first.id, claimed.token!, {});
    const second = await until(engine, () => engine.available(runId)[0]);
    // A continued session sees the directory it started in.
    expect(second.resolvedCwd).toBe(first.resolvedCwd);
    expect(readFileSync(join(first.resolvedCwd!, 'file.txt'), 'utf8')).toBe(
      'original\nrun\n',
    );
    const next = engine.claim(second.id, worker);
    engine.submit(second.id, next.token!, {});
  }
  expect(new Set(paths).size).toBe(2);
  expect(
    paths.every((path) => path.startsWith(join(f.root, 'workspaces'))),
  ).toBe(true);
  await until(engine, () => paths.every((path) => !existsSync(path)));
  expect(f.worktrees()).toEqual([realpathSync(f.repository)]);
  // The user's checkout is untouched; the run branches keep their work.
  expect(readFileSync(join(f.repository, 'file.txt'), 'utf8')).toBe(
    'original\n',
  );
  expect(f.git('branch', '--show-current')).toBe('main');
  // Removal keeps the branch and its commits.
  for (const runId of runs)
    expect(f.git('log', '-1', '--format=%s', `agent/${runId}`)).toBe('run');
});

it('shares the workspace with Batch items and removes it after the tree is cancelled', async () => {
  const f = setup();
  const engine = f.open();
  const definition = batchDefinition(itemAgent());
  const id = publish(engine, {
    ...definition,
    workspace: { repository: f.repository },
  });
  const runId = engine.start(id, [1, 2]).run.id;
  const work = await until(engine, () => {
    const items = engine.available();
    return items.length === 2 && items;
  });
  const path = engine.workspaces.get(runId)!.path;
  expect(work.map((w) => w.resolvedCwd)).toEqual([path, path]);
  engine.claim(work[0].id, { ...worker, session: undefined });
  engine.cancelRunTree({ id: runId, reason: 'stop' });
  // A revoked claim may still be writing until someone confirms it stopped.
  for (let i = 0; i < 5; i++) {
    engine.pump();
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(existsSync(path)).toBe(true);
  engine.manageWorkResources({
    action: 'release',
    workId: work[0].id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'test',
  });
  await until(engine, () => !existsSync(path));
  expect(f.worktrees()).toEqual([realpathSync(f.repository)]);
});

it('reconciles after a restart without touching directories Interlock did not create', async () => {
  const f = setup();
  const first = f.open();
  const id = publish(first, {
    workspace: { repository: f.repository },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      agent('work'),
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'work' },
      { id: 'b', source: 'work', target: 'exit' },
    ],
  });
  const runId = first.start(id, {}).run.id;
  await until(first, () => first.available(runId)[0]);
  const path = first.workspaces.get(runId)!.path;
  // Simulate a crash: no cleanup runs, and a leftover checkout lost its record.
  first.stop();
  const workspaces = join(f.root, 'workspaces');
  const orphan = '00000000-0000-4000-8000-000000000000';
  f.git('worktree', 'add', '-q', '-b', 'orphan', join(workspaces, orphan));
  writeFileSync(
    join(workspaces, `${orphan}.owner.json`),
    JSON.stringify({ id: orphan, ownerToken: 'x', repository: f.repository }),
  );
  // Directories under valid run IDs that Interlock cannot prove it made.
  const unmarked = '11111111-1111-4111-8111-111111111111';
  const linked = '22222222-2222-4222-8222-222222222222';
  const outside = join(f.root, 'outside');
  mkdirSync(join(workspaces, unmarked));
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  symlinkSync(outside, join(workspaces, linked));
  writeFileSync(
    join(workspaces, `${linked}.owner.json`),
    JSON.stringify({ id: linked, ownerToken: 'x', repository: f.repository }),
  );
  const second = f.open();
  await until(second, () => !existsSync(join(workspaces, orphan)));
  expect(existsSync(path)).toBe(true);
  second.cancelRunTree({ id: runId, reason: 'stop' });
  await until(second, () => !existsSync(path));
  expect(f.worktrees()).toEqual([realpathSync(f.repository)]);
  expect(existsSync(join(workspaces, unmarked))).toBe(true);
  expect(readFileSync(join(workspaces, linked, 'keep.txt'), 'utf8')).toBe(
    'keep',
  );
  f.git('rev-parse', '--verify', 'orphan');
});

it('keeps a worktree with uncommitted changes on completion and on cancel', async () => {
  const f = setup();
  const engine = f.open();
  const id = publish(engine, {
    workspace: { repository: f.repository },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      {
        id: 'script',
        kind: 'script',
        label: 'Edit',
        language: 'javascript',
        command:
          "require('node:fs').writeFileSync('new.txt', 'x'); return input;",
      },
      agent('work'),
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'script' },
      { id: 'b', source: 'script', target: 'work' },
      { id: 'c', source: 'work', target: 'exit' },
    ],
  });
  const completed = engine.start(id, {}).run.id;
  const cancelled = engine.start(id, {}).run.id;
  const work = await until(engine, () => engine.available(completed)[0]);
  await until(engine, () => engine.available(cancelled)[0]);
  const claimed = engine.claim(work.id, worker);
  engine.submit(work.id, claimed.token!, {});
  engine.cancelRunTree({ id: cancelled, reason: 'stop' });
  for (const runId of [completed, cancelled]) {
    await until(
      engine,
      () => engine.workspaces.get(runId)?.state === 'retained',
    );
    const { workspace } = engine.inspect(runId);
    expect(workspace?.error).toMatch(/uncommitted changes/);
    expect(readFileSync(join(workspace!.path, 'new.txt'), 'utf8')).toBe('x');
  }
});

it('fails a run whose branch already exists and leaves that branch alone', async () => {
  const f = setup();
  const engine = f.open();
  const id = publish(engine, {
    workspace: { repository: f.repository },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      agent('work'),
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'work' },
      { id: 'b', source: 'work', target: 'exit' },
    ],
  });
  f.git(
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Mine',
  );
  const mine = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-q', 'HEAD~1');
  const runId = engine.start(id, {}).run.id;
  // Git runs asynchronously, so the branch exists before the run checks it.
  f.git('branch', `interlock/${runId}`, mine);
  await until(engine, () => engine.run(runId).status === 'failed');
  expect(engine.run(runId).error).toMatch(/already exists/);
  expect(f.git('rev-parse', `interlock/${runId}`)).toBe(mine);
  expect(f.worktrees()).toEqual([realpathSync(f.repository)]);
});

it('runs hooks in the checkout and keeps a failed run’s checkout when asked', async () => {
  const f = setup();
  const engine = f.open();
  const log = join(f.root, 'removed.log');
  const id = publish(engine, {
    workspace: {
      repository: f.repository,
      retention: 'keep_on_failure',
      hooks: {
        // Minimal mode withholds server variables except the named ones.
        afterCreate: {
          environmentMode: 'minimal',
          environmentPassthrough: ['HOOK_PASSED'],
          command:
            'echo "created${HOOK_SECRET:-}${HOOK_PASSED}" > hook.txt && echo hook.txt >> "$(git rev-parse --git-path info/exclude)"',
        },
        beforeRemove: {
          command: `echo "$INTERLOCK_WORKSPACE_PATH $(cat hook.txt)" >> ${JSON.stringify(log)}`,
        },
      },
    },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      {
        id: 'script',
        kind: 'script',
        label: 'Check',
        language: 'javascript',
        command:
          "if (input.fail) throw new Error('fail'); return require('node:fs').readFileSync('hook.txt', 'utf8');",
      },
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'script' },
      { id: 'b', source: 'script', target: 'exit' },
    ],
  });
  vi.stubEnv('HOOK_SECRET', ' secret');
  vi.stubEnv('HOOK_PASSED', ' passed');
  const failed = engine.start(id, { fail: true }).run.id;
  const passed = engine.start(id, {}).run.id;
  await until(
    engine,
    () =>
      engine.workspaces.get(failed)?.state === 'retained' &&
      engine.workspaces.get(passed)?.state === 'removed',
  );
  expect(engine.run(passed).output).toBe('created passed\n');
  expect(existsSync(engine.workspaces.get(failed)!.path)).toBe(true);
  expect(readFileSync(log, 'utf8')).toBe(
    `${engine.workspaces.get(passed)!.path} created passed\n`,
  );
});

it('holds a run until a person approves an imported workspace hook', async () => {
  const f = setup();
  const engine = f.open();
  const definition = definitionSchema.parse({
    workspace: {
      repository: f.repository,
      hooks: { afterCreate: { command: 'touch approved.txt' } },
    },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      agent('work'),
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'work' },
      { id: 'b', source: 'work', target: 'exit' },
    ],
  });
  const workflow = engine.create('Imported', '', definition);
  engine.scriptApprovals.record(workflow.id, [], [workflow.draft]);
  engine.publish(workflow.id);
  const runId = engine.start(workflow.id, {}).run.id;
  engine.pump();
  const run = engine.run(runId);
  expect(run.status).toBe('waiting');
  expect(engine.workspaces.get(runId)).toBeUndefined();
  engine.scriptApprovals.approve({
    runId,
    executionId: run.executions[0].id,
  });
  const work = await until(engine, () => engine.available(runId)[0]);
  expect(existsSync(join(work.resolvedCwd!, 'approved.txt'))).toBe(true);
});
