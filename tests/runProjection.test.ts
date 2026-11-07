import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  externalTaskSchema,
  type WorkRequest,
} from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const setup = () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  return e;
};
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
});
function publish(e: Engine, definition = blankDefinition()) {
  const w = e.create('Projection', '', definition);
  e.publish(w.id);
  return w.id;
}
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
function mutateWork(e: Engine, runId: string, fields: Partial<WorkRequest>) {
  const work = e.store.work().find((w) => w.runId === runId)!;
  e.store.put('work', { ...work, ...fields });
  return work;
}

it('validates bounded stage and title and includes the title in start identity', () => {
  expect(
    nodeSchema.parse({ ...blankDefinition().nodes[1], stage: ' Build ' }).stage,
  ).toBe('Build');
  for (const stage of ['', ' ', 'x'.repeat(201)])
    expect(() =>
      nodeSchema.parse({ ...blankDefinition().nodes[1], stage }),
    ).toThrow();
  const task = { system: 'github', id: '231', title: ' Build projection ' };
  expect(externalTaskSchema.parse(task).title).toBe('Build projection');
  for (const title of ['', ' ', 'x'.repeat(201)])
    expect(() => externalTaskSchema.parse({ ...task, title })).toThrow();
  const e = setup(),
    id = publish(e);
  const start = e.startSummary(id, {}, undefined, 20, undefined, {
    requestId: 'title',
    externalTask: task,
  });
  expect(start.externalTask?.title).toBe('Build projection');
  expect(() =>
    e.startSummary(id, {}, undefined, 20, undefined, {
      requestId: 'title',
      externalTask: { ...task, title: 'Changed' },
    }),
  ).toThrow();
});

it('projects the deepest active waited stage and falls back through unlabeled children', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1].stage = 'Build';
  const leaf = publish(e, d),
    middleDef = workflowCall(leaf);
  middleDef.nodes[1].stage = 'Plan';
  const middle = publish(e, middleDef),
    rootDef = workflowCall(middle);
  rootDef.nodes[1].stage = 'Intake';
  const root = e.start(publish(e, rootDef), {}).run.id;
  expect(e.projectRun(root)).toMatchObject({
    stage: 'Build',
    actor: 'agent',
    waiting: { kind: 'claim_queue' },
  });
  const version = e.store.getVersion(leaf, 1)!;
  delete version.definition.nodes[1].stage;
  e.store.version(version);
  expect(e.projectRun(root).stage).toBe('Plan');
  const work = e.claim(e.available(root)[0].id, worker);
  expect(e.projectRun(root)).toMatchObject({ actor: 'agent', waiting: null });
  e.submit(work.id, work.token!, {});
  expect(e.projectRun(root)).toEqual({
    stage: null,
    waiting: null,
    actor: 'engine',
  });
});

it('does not roll up detached children and chooses sibling stages deterministically', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1].stage = 'Independent';
  const detached = publish(e, d),
    caller = workflowCall(detached, 'detached', true);
  caller.nodes.find((n) => n.id === 'after')!.stage = 'Parent';
  const root = e.start(publish(e, caller), {}).run.id;
  expect(e.projectRun(root).stage).toBe('Parent');
  const batch = e.start(publish(e, batchDefinition()), ['a', 'b']).run.id;
  const children = e.store
    .runs()
    .filter((r) => r.parentRunId === batch)
    .sort((a, b) => a.id.localeCompare(b.id));
  const v = e.store.getVersion(children[0].workflowId, 1)!;
  v.definition.nodes.find((n) => n.id === 'work')!.stage = 'Review';
  e.store.version(v);
  // Equal timestamps exercise the final run-id tie; input detail identifies the selected branch.
  for (const r of children) {
    r.executions.at(-1)!.startedAt = '2026-01-01T00:00:00.000Z';
    e.store.put('runs', r);
  }
  expect(e.projectRun(batch).waiting?.detail.runId).toBe(children[0].id);
  expect(e.projectRun(batch).stage).toBe('Review');
});

it('reports person only when all branches require human action', () => {
  const e = setup(),
    root = e.start(publish(e, batchDefinition()), [1, 2]).run.id;
  const children = e.store.runs().filter((r) => r.parentRunId === root);
  const heldAt = '2026-01-01T00:00:00.000Z';
  const hold = {
    revision: 1,
    category: 'other' as const,
    reason: 'Decision',
    checkpointRef: 'test',
    heldAt,
    actor: 'operator',
  };
  mutateWork(e, children[0].id, { status: 'held', hold });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'agent',
    waiting: { kind: 'claim_queue', detail: { runId: children[1].id } },
  });
  mutateWork(e, children[1].id, { status: 'held', hold });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'person',
    waiting: { kind: 'hold', since: heldAt },
  });
  mutateWork(e, children[1].id, {
    status: 'available',
    hold: undefined,
    executor: 'managed',
    managedExecution: { profileId: 'managed', state: 'queued' },
  });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'engine',
    waiting: { kind: 'managed_launch' },
  });
});

it('maps managed attention, budgets, resources and input without exposing payloads', () => {
  const e = setup(),
    root = e.start(publish(e), {}).run.id;
  mutateWork(e, root, {
    managedExecution: { profileId: 'm', state: 'needs_human' },
  });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'person',
    waiting: { kind: 'human_request' },
  });
  mutateWork(e, root, {
    managedExecution: undefined,
    budgetBlocked: { runIds: [root], since: '2026-01-01T00:00:00Z' },
  });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'person',
    waiting: { kind: 'budget', since: '2026-01-01T00:00:00Z' },
  });
  const owner = {
    name: 'shared',
    workId: 'other',
    runId: 'other',
    attempt: 1,
    state: 'claimed' as const,
    acquiredAt: '2026-01-01T00:00:00Z',
  };
  mutateWork(e, root, {
    budgetBlocked: undefined,
    resourceBlocked: { owners: [owner] },
  });
  expect(e.projectRun(root)).toMatchObject({
    actor: 'engine',
    waiting: { kind: 'resource' },
  });
  mutateWork(e, root, {
    resourceBlocked: { owners: [{ ...owner, state: 'uncertain' }] },
  });
  expect(e.projectRun(root).actor).toBe('person');
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'External',
    kind: 'input',
    stage: 'Accept',
  });
  const input = e.start(publish(e, d), {}).run.id;
  expect(e.projectRun(input)).toMatchObject({
    stage: 'Accept',
    actor: 'agent',
    waiting: { kind: 'input_node' },
  });
});

it('keeps poll output bounded and since stable, and shares projection across APIs and event snapshots', async () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Timer',
    stage: 'Accept',
    timing: { kind: 'duration', ms: 60000 },
  });
  const root = e.start(publish(e, d), {}).run.id;
  expect(e.projectRun(root)).toMatchObject({
    actor: 'engine',
    waiting: { kind: 'timer' },
  });
  const run = e.run(root);
  const step = run.executions.at(-1)!;
  step.nextCheckAt = step.resumeAt;
  step.check = {
    count: 1,
    at: step.startedAt,
    output: { large: 'x'.repeat(5000) },
  };
  e.store.put('runs', run);
  const projected = e.projectRun(root);
  expect(projected.waiting).toMatchObject({
    kind: 'poll',
    since: step.startedAt,
    detail: { lastCheck: { count: 1, truncated: true } },
  });
  expect(projected.waiting!.detail.lastCheck!.output!.length).toBe(512);
  expect(e.projectRun(root)).toEqual(projected);
  const api = appRouter.createCaller({ engine: e });
  expect((await api.runs.find({})).find((r) => r.id === root)).toMatchObject(
    projected,
  );
  expect(
    (await api.runs.summaries({})).items.find((r) => r.id === root),
  ).toMatchObject(projected);
  expect(e.inspect(root).run).toMatchObject(projected);
  expect(e.continuation.briefing({ id: root, limit: 20 }).run).toMatchObject(
    projected,
  );
  expect(e.continuation.summary(root, 20)).toMatchObject(projected);
  step.check.output = '😀'.repeat(400);
  e.store.put('runs', run);
  const multibyte = e.continuation.summary(root, 20);
  expect(multibyte.waiting!.detail.lastCheck!.output!.length).toBe(512);
  expect(multibyte.waiting!.detail.lastCheck!.truncated).toBe(true);
  expect(
    e
      .inspect(root)
      .events.every(
        (event) => 'stage' in event && 'waiting' in event && 'actor' in event,
      ),
  ).toBe(true);
});

it('retains stage and waiting since after reopening persisted history', () => {
  const temp = mkdtempSync(join(tmpdir(), 'interlock-projection-'));
  const path = join(temp, 'test.db');
  let e = new Engine(new Store(path), process.cwd());
  try {
    const d = blankDefinition();
    d.nodes[1].stage = 'Build';
    const id = e.start(publish(e, d), {}).run.id;
    const before = e.projectRun(id);
    e.stop();
    e.store.close();
    e = new Engine(new Store(path), process.cwd());
    expect(e.projectRun(id)).toEqual(before);
  } finally {
    e.stop();
    e.store.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
