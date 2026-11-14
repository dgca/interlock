import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  definitionSchema,
  nodeSchema,
  type Json,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { parallelDefinition } from './fixtures/parallel';

// Partial joins, kept apart from parallel.test.ts, which is near the file limit.
const engines = new Set<Engine>();
const directories: string[] = [];
function setup(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.add(engine);
  return engine;
}
function close(engine: Engine) {
  engine.stop();
  engine.store.close();
  engines.delete(engine);
}
afterEach(() => {
  for (const engine of engines) close(engine);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});
function publish(engine: Engine, definition: object) {
  const workflow = engine.create(
    'Parallel join test',
    '',
    definitionSchema.parse(definition),
  );
  engine.publish(workflow.id);
  return workflow.id;
}
function claim(engine: Engine, runId: string, nodeId: string) {
  const work = engine.available(runId).find((item) => item.nodeId === nodeId)!;
  expect(work).toBeDefined();
  return engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
}
function submit(engine: Engine, runId: string, nodeId: string, output: Json) {
  const work = claim(engine, runId, nodeId);
  engine.submit(work.id, work.token!, output);
}
const firstOf = (joinAfter: number, extra = {}) =>
  parallelDefinition({
    keys: ['spec', 'code', 'lint'],
    concurrency: 3,
    join: { joinAfter, ...extra },
  });
function replaceBranch(
  d: ReturnType<typeof firstOf>,
  id: string,
  node: object,
) {
  const index = d.nodes.findIndex((n) => n.id === id);
  d.nodes[index < 0 ? d.nodes.length : index] = nodeSchema.parse({
    id,
    label: id,
    parallelId: 'parallel',
    parallelBranchId: id,
    ...node,
  });
}
const joinReason = /Reviews join satisfied after 1 of 3 branches/;
function expectJoinCancelled(branch: Run) {
  expect(branch.status).toBe('cancelled');
  expect(branch.cancellationReason).toMatch(joinReason);
  expect(branch.executions.at(-1)!.status).toBe('cancelled');
  expect(branch.executions.at(-1)!.error).toMatch(joinReason);
}
const groupOf = (run: Run) =>
  run.executions.find((step) => step.kind === 'parallel')!;

it('cancels the other two branches of a first 1 of 3 join and reports each branch', () => {
  const engine = setup();
  const run = engine.start(publish(engine, firstOf(1)), {}).run;
  const late = claim(engine, run.id, 'r1');
  submit(engine, run.id, 'r0', { ok: true });
  const done = engine.run(run.id);
  expect(JSON.stringify(done.output)).toBe(
    '{"results":{"spec":{"ok":true}},"branches":{"spec":"completed","code":"cancelled","lint":"cancelled"}}',
  );
  const [, ...others] = groupOf(done).childRunIds.map((id) => engine.run(id));
  expect(others).toHaveLength(2);
  for (const branch of others) expectJoinCancelled(branch);
  expect(engine.store.work(undefined, late.runId)[0].status).toBe('cancelled');
  expect(() => engine.submit(late.id, late.token!, 'late')).toThrow(
    /token|claim/i,
  );
  expect(engine.available(run.id)).toEqual([]);
});

it('continues with successes while enough branches can still succeed', () => {
  const engine = setup();
  const workflow = publish(engine, firstOf(2, { onBranchFailure: 'continue' }));
  const ok = engine.start(workflow, {}).run;
  const failing = claim(engine, ok.id, 'r0');
  engine.reportFailure(failing.id, failing.token!, 'broken');
  expect(engine.run(ok.id).status).toBe('waiting');
  submit(engine, ok.id, 'r1', 1);
  submit(engine, ok.id, 'r2', 2);
  expect(engine.run(ok.id).output).toEqual({
    results: { code: 1, lint: 2 },
    branches: { spec: 'failed', code: 'completed', lint: 'completed' },
  });

  const short = engine.start(workflow, {}).run;
  for (const node of ['r0', 'r1']) {
    const work = claim(engine, short.id, node);
    engine.reportFailure(work.id, work.token!, `${node} broken`);
  }
  expect(engine.run(short.id).status).toBe('failed');
  expect(engine.run(short.id).error).toMatch(
    /2 of 3 branches did not complete/,
  );
  const group = engine.run(short.id).executions.at(-1)!;
  expect(engine.run(group.childRunIds[2]).status).toBe('cancelled');

  // Without continue, a first 1 of 3 group still fails on the first failure.
  const strict = engine.start(publish(engine, firstOf(1)), {}).run;
  const failed = claim(engine, strict.id, 'r0');
  engine.reportFailure(failed.id, failed.token!, 'broken');
  expect(engine.run(strict.id).status).toBe('failed');
});

it('converges after a restart between branch results and the join, keeping simultaneous completions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-parallel-'));
  directories.push(dir);
  const path = join(dir, 'runs.sqlite');
  let engine = setup(path);
  const run = engine.start(publish(engine, firstOf(1)), {}).run;
  const a = claim(engine, run.id, 'r0'),
    b = claim(engine, run.id, 'r1');
  // A stopped engine records results but never advances the parent.
  engine.stop();
  engine.submit(a.id, a.token!, 'a');
  engine.submit(b.id, b.token!, 'b');
  expect(engine.run(run.id).status).toBe('waiting');
  close(engine);
  engine = setup(path);
  engine.pump();
  const done = engine.run(run.id);
  expect(done.output).toEqual({
    results: { spec: 'a', code: 'b' },
    branches: { spec: 'completed', code: 'completed', lint: 'cancelled' },
  });
  const lint = engine.run(groupOf(done).childRunIds[2]);
  expect(lint.status).toBe('cancelled');
  expect(
    engine.store.work(undefined, lint.id).map((work) => work.status),
  ).toEqual(['cancelled']);
  expect(engine.available()).toEqual([]);
});

it('cancels waited child workflows and their Batch items but leaves detached work alone', () => {
  const engine = setup();
  const detachedChild = publish(engine, {
    nodes: [
      { id: 'entry', label: 'Input', kind: 'entry' },
      {
        id: 'detached-work',
        label: 'Detached work',
        kind: 'agent',
        prompt: 'Keep working.',
      },
      { id: 'exit', label: 'Output', kind: 'exit' },
    ],
    edges: [
      { id: 'start', source: 'entry', target: 'detached-work' },
      { id: 'finish', source: 'detached-work', target: 'exit' },
    ],
  });
  const batch = publish(engine, {
    nodes: [
      { id: 'entry', kind: 'entry', label: 'In' },
      { id: 'items', kind: 'batch', label: 'Items', itemsPath: 'items' },
      {
        id: 'item',
        kind: 'agent',
        label: 'Item',
        prompt: 'Handle the item.',
        batchId: 'items',
      },
      { id: 'exit', kind: 'exit', label: 'Out' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'items' },
      { id: 'item', source: 'items', port: 'item', target: 'item' },
      { id: 'end', source: 'item', target: 'items', targetHandle: 'end' },
      { id: 'out', source: 'items', port: 'complete', target: 'exit' },
    ],
  });
  const d = firstOf(1);
  replaceBranch(d, 'r0', { kind: 'workflow', workflowId: batch, version: 1 });
  replaceBranch(d, 'r2', {
    kind: 'workflow',
    workflowId: detachedChild,
    version: 1,
    mode: 'detached',
  });
  replaceBranch(d, 'follow', {
    kind: 'agent',
    prompt: 'Continue.',
    parallelBranchId: 'r2',
  });
  Object.assign(
    d.edges.find((e) => e.id === 'join-r2')!,
    {
      target: 'follow',
      targetHandle: 'default',
    },
  );
  d.edges.push({
    id: 'join-follow',
    source: 'follow',
    target: 'parallel',
    port: 'default',
    targetHandle: 'join',
  });
  const run = engine.start(publish(engine, d), { items: [1, 2] }).run;
  const detached = engine
    .available(run.id)
    .find((w) => w.nodeId === 'detached-work')!;
  expect(
    engine.available(run.id).filter((w) => w.nodeId === 'item'),
  ).toHaveLength(2);
  submit(engine, run.id, 'r1', 'winner');
  const group = groupOf(engine.run(run.id));
  const cancelled = engine.store
    .runTrees(new Set([group.childRunIds[0], group.childRunIds[2]]))
    .filter((r) => r.id !== detached.runId);
  // Two branches, the waited child workflow and its two Batch items.
  expect(cancelled).toHaveLength(5);
  for (const member of cancelled) {
    expect(member.status).toBe('cancelled');
    expect(member.cancellationReason).toMatch(joinReason);
  }
  expect(engine.run(detached.runId).status).toBe('waiting');
  expect(engine.available(run.id).map((w) => w.id)).toEqual([detached.id]);
});

it('cancels branches waiting on external input or a timer', () => {
  const engine = setup();
  const d = firstOf(1);
  replaceBranch(d, 'r1', { kind: 'input' });
  replaceBranch(d, 'r2', {
    kind: 'wait',
    timing: { kind: 'duration', ms: 600_000 },
  });
  const run = engine.start(publish(engine, d), {}).run;
  const [, input, timer] = groupOf(engine.run(run.id)).childRunIds.map((id) =>
    engine.run(id),
  );
  expect(timer.executions.at(-1)!.resumeAt).toBeDefined();
  submit(engine, run.id, 'r0', 'done');
  for (const branch of [input, timer])
    expectJoinCancelled(engine.run(branch.id));
  expect(() =>
    engine.externalInputs.mutate({
      action: 'submit',
      runId: input.id,
      executionId: input.executions.at(-1)!.id,
      requestId: 'late',
      expectedRevision: 0,
      value: 'late',
    }),
  ).toThrow();
  expect(engine.run(run.id).status).toBe('completed');
});

it('waits through a pause and closes holds on the branches it cancels', () => {
  const engine = setup();
  const workflow = publish(engine, firstOf(1));
  const run = engine.start(workflow, {}).run;
  const winner = claim(engine, run.id, 'r0');
  const held = engine.available(run.id).find((w) => w.nodeId === 'r1')!;
  engine.manageWorkHold({
    action: 'hold',
    workId: held.id,
    expectedAttempt: held.attempt,
    expectedRevision: 0,
    actor: 'coordinator',
    category: 'provider_limit',
    reason: 'Provider unavailable',
    checkpointRef: 'artifact://checkpoint',
  });
  const pause = engine.pauses.create({
    target: { scope: 'workflow', workflowId: workflow },
    actor: 'deploy',
    reason: 'maintenance',
  });
  engine.submit(winner.id, winner.token!, 'first');
  // The pause gates the group boundary, so siblings keep their state.
  expect(engine.run(run.id).status).toBe('waiting');
  expect(engine.store.get<WorkRequest>('work', held.id)!.status).toBe('held');
  engine.pauses.resume(pause.id);
  engine.pump();
  expect(engine.run(run.id).output).toMatchObject({
    branches: { spec: 'completed', code: 'cancelled', lint: 'cancelled' },
  });
  const work = engine.store.get<WorkRequest>('work', held.id)!;
  expect(work.status).toBe('cancelled');
  expect(work.hold).toBeUndefined();
});

it('joins each visit of a re-entered first 1 of 2 group independently', () => {
  const engine = setup();
  const d = parallelDefinition({ join: { joinAfter: 1 } });
  d.nodes.push(
    nodeSchema.parse({
      id: 'round',
      label: 'Next round',
      kind: 'switch',
      path: 'branches.code',
      cases: [{ port: 'again', equals: 'cancelled' }],
      default: 'done',
    }),
  );
  d.edges.find((e) => e.id === 'out')!.target = 'round';
  d.edges.push(
    { id: 'again', source: 'round', port: 'again', target: 'parallel' },
    { id: 'done', source: 'round', port: 'done', target: 'exit' },
  );
  const run = engine.start(publish(engine, d), {}).run;
  const stale = claim(engine, run.id, 'r1');
  submit(engine, run.id, 'r0', 'first');
  const groups = () =>
    engine.run(run.id).executions.filter((e) => e.kind === 'parallel');
  expect(groups()).toHaveLength(2);
  expect(engine.run(stale.runId).status).toBe('cancelled');
  submit(engine, run.id, 'r1', 'second');
  expect(engine.run(run.id).output).toEqual({
    results: { code: 'second' },
    branches: { spec: 'cancelled', code: 'completed' },
  });
  expect(groups()[1].childRunIds).not.toContain(stale.runId);
});
