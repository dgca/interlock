import { afterEach, expect, it } from 'vitest';
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
          "require('node:fs').appendFileSync('file.txt', 'run\\n'); return { cwd: process.cwd() };",
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
  for (const runId of runs) f.git('rev-parse', '--verify', `agent/${runId}`);
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
  mkdirSync(join(workspaces, 'foreign'));
  writeFileSync(join(workspaces, 'foreign.owner.json'), '{}');
  const second = f.open();
  await until(second, () => !existsSync(join(workspaces, orphan)));
  expect(existsSync(path)).toBe(true);
  second.cancelRunTree({ id: runId, reason: 'stop' });
  await until(second, () => !existsSync(path));
  expect(f.worktrees()).toEqual([realpathSync(f.repository)]);
  expect(existsSync(join(workspaces, 'foreign'))).toBe(true);
  f.git('rev-parse', '--verify', 'orphan');
});
