import { DatabaseSync } from 'node:sqlite';
import previousRelease from './fixtures/testbench-previous-release.json';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  definitionSchema,
  diagnoseDraft,
  nodeSchema,
  validateDefinition,
  type WorkRequest,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition, itemAgent } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [],
  dirs: string[] = [];
const session = { executorId: 'harness', sessionId: 'author' };
const replacement = { ...session, sessionId: 'replacement' };
const worker = {
  workerId: 'coordinator',
  freshContext: false,
  tools: [],
  skills: [],
  session,
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function definition() {
  const d = blankDefinition();
  const node = d.nodes[1];
  if (node.kind !== 'agent') throw new Error('Expected agent');
  node.context.continuityGroup = 'author';
  node.maxAttempts = 3;
  return d;
}
function publish(e: Engine, d = definition()) {
  const w = e.create('Continuity', '', d);
  e.publish(w.id);
  return w.id;
}
function start(e: Engine, d = definition()) {
  return e.start(publish(e, d), {}).run;
}
function handoff(runId: string) {
  return {
    runId,
    group: 'author',
    expectedRevision: 1,
    session: replacement,
    actor: 'coordinator',
    reason: 'Session unavailable',
    checkpointRef: '.tasks/checkpoint.md',
  };
}
function claim(e: Engine, runId: string) {
  return e.claim(e.available(runId)[0].id, worker);
}
function complete(e: Engine, runId: string, output = {}) {
  const w = claim(e, runId);
  e.submit(w.id, w.token!, output);
  return w;
}
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  vi.useRealTimers();
});

it('saves contradictory drafts but rejects publication, with a field diagnostic', () => {
  const e = setup(),
    d = definition();
  if (d.nodes[1].kind === 'agent') d.nodes[1].context.mode = 'fresh';
  expect(definitionSchema.parse(d).nodes[1]).toMatchObject({
    context: { continuityGroup: 'author' },
  });
  expect(diagnoseDraft(d).diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'fresh_continuity_group',
      path: 'nodes.1.context.continuityGroup',
      category: 'publication',
    }),
  );
  const w = e.create('Invalid draft', '', d);
  expect(() => e.publish(w.id)).toThrow(/fresh context cannot/);
  expect(() => validateDefinition(d)).toThrow(/fresh context cannot/);
});

it('binds only successful claims and rejects conflicting executor or session declarations atomically', () => {
  const e = setup(),
    run = start(e),
    w = e.available(run.id)[0];
  expect(w.continuity).toEqual({
    runId: run.id,
    group: 'author',
    revision: 0,
    session: null,
  });
  expect(() => e.claim(w.id, { ...worker, session: undefined })).toThrow(
    /requires executorId/,
  );
  expect(
    e.contextGroups.read({ runId: run.id, group: 'author' }),
  ).toMatchObject({ revision: 0, total: 0 });
  e.store.put('work', { ...w, context: { ...w.context, tools: ['git'] } });
  expect(() => e.claim(w.id, worker)).toThrow(/Missing capabilities/);
  e.budgets.set({
    runId: run.id,
    expectedRevision: 0,
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 0 } },
    },
  });
  expect(() => e.claim(w.id, { ...worker, tools: ['git'] })).toThrow(
    /Budget blocked/,
  );
  expect(
    e.contextGroups.read({ runId: run.id, group: 'author' }),
  ).toMatchObject({ revision: 0, total: 0 });
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  const claimed = e.claim(w.id, { ...worker, tools: ['git'] });
  expect(claimed.continuity).toMatchObject({ revision: 1, session });
  e.reportFailure(claimed.id, claimed.token!, 'retry');
  for (const next of [replacement, { ...session, executorId: 'another' }]) {
    expect(() =>
      e.claim(w.id, { ...worker, tools: ['git'], session: next }),
    ).toThrow(/Context session conflict/);
    expect(e.store.get<WorkRequest>('work', w.id)).toMatchObject({
      status: 'available',
      attempt: 1,
    });
  }
  expect(e.contextGroups.read({ runId: run.id, group: 'author' }).total).toBe(
    1,
  );
});

it('resumes across phases, loop visits, and worker identities, preserving per-attempt history', () => {
  const e = setup(),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'plan',
      kind: 'agent',
      prompt: 'Plan',
      label: 'Plan',
      context: { continuityGroup: 'author' },
    }),
    nodeSchema.parse({
      id: 'again',
      kind: 'condition',
      label: 'Again',
      path: 'again',
      equals: true,
    }),
  );
  d.edges[1].target = 'plan';
  d.edges.push(
    { id: 'plan-again', source: 'plan', target: 'again', port: 'default' },
    { id: 'loop', source: 'again', target: 'agent', port: 'true' },
    { id: 'done', source: 'again', target: 'exit', port: 'false' },
  );
  const run = start(e, d);
  complete(e, run.id);
  for (const again of [true, false]) {
    const w = e.available(run.id)[0];
    expect(w.continuity?.session).toEqual(session);
    expect(e.workSummaries(run.id)[0].continuity).toEqual(w.continuity);
    expect(
      e.continuation.briefing({ id: run.id, limit: 20 }).available.items[0]
        .continuity,
    ).toEqual(w.continuity);
    const c = e.claim(w.id, { ...worker, workerId: 'new-coordinator' });
    e.submit(c.id, c.token!, { again });
    if (again) complete(e, run.id);
  }
  expect(e.run(run.id).status).toBe('completed');
  const history = e.contextGroups.read({
    runId: run.id,
    group: 'author',
    limit: 2,
  });
  expect(history.total).toBe(4);
  expect(history.nextOffset).toBe(2);
  expect(
    e.contextGroups.read({ runId: run.id, group: 'author', offset: 2 }).history,
  ).toHaveLength(2);
});

it('requires a revision-checked handoff, exposes the checkpoint, and makes identical retries safe', () => {
  const e = setup(),
    run = start(e),
    c = claim(e, run.id),
    input = handoff(run.id);
  expect(() => e.handoffContext(input)).toThrow(/active claim/);
  e.reportFailure(c.id, c.token!, 'session lost');
  const cursor = e.continuation.briefing({ id: run.id, limit: 20 }).cursor;
  expect(() => e.handoffContext({ ...input, checkpointRef: ' ' })).toThrow();
  expect(() => e.handoffContext({ ...input, session })).toThrow(
    /different session/,
  );
  expect(e.handoffContext(input)).toMatchObject({
    revision: 2,
    session: replacement,
    applied: true,
    checkpointRef: input.checkpointRef,
  });
  expect(e.handoffContext(input).applied).toBe(false);
  expect(() => e.handoffContext({ ...input, reason: 'different' })).toThrow(
    /revision conflict/,
  );
  const after = e.continuation.briefing({ id: run.id, limit: 20 });
  expect(after.cursor).not.toBe(cursor);
  expect(after.available.items[0].continuity).toMatchObject({
    session: replacement,
    revision: 2,
  });
  expect(e.available(run.id)[0].attempt).toBe(1);
  expect(() => claim(e, run.id)).toThrow(/session conflict/);
  const next = e.claim(c.id, { ...worker, session: replacement });
  e.submit(next.id, next.token!, {});
  expect(e.handoffContext(input).applied).toBe(false);
  expect(() =>
    e.handoffContext({ ...input, expectedRevision: 2, session }),
  ).toThrow(/completed or cancelled/);
  const history = e.contextGroups.read({
    runId: run.id,
    group: 'author',
  }).history;
  expect(history).toHaveLength(3);
  expect(history[0]).toMatchObject({ kind: 'claim', session, attempt: 1 });
  expect(history[1]).toMatchObject({
    kind: 'handoff',
    fromSession: session,
    session: replacement,
    actor: input.actor,
    checkpointRef: input.checkpointRef,
  });
  expect(history[2]).toMatchObject({
    kind: 'claim',
    session: replacement,
    attempt: 2,
  });
});

it('recovers an expired lease before handoff and leaves old tokens invalid', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  const e = setup(),
    run = start(e),
    w = e.claim(e.available(run.id)[0].id, worker, 10);
  vi.advanceTimersByTime(11000);
  expect(e.handoffContext(handoff(run.id)).revision).toBe(2);
  expect(() => e.submit(w.id, w.token!, {})).toThrow(/expired/i);
  expect(e.claim(w.id, { ...worker, session: replacement }).attempt).toBe(2);
});

it('retains bindings and history through restart and explicit failed-run retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-context-'));
  dirs.push(dir);
  const path = join(dir, 'test.sqlite'),
    e = setup(path),
    d = definition();
  if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
  const run = start(e, d),
    w = claim(e, run.id);
  e.reportFailure(w.id, w.token!, 'session lost');
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const restored = setup(path);
  expect(
    restored.contextGroups.read({ runId: run.id, group: 'author' }),
  ).toMatchObject({ revision: 1, total: 1, session });
  restored.handoffContext(handoff(run.id));
  restored.retry(run.id);
  expect(() => claim(restored, run.id)).toThrow(/session conflict/);
  const next = restored.claim(restored.available(run.id)[0].id, {
    ...worker,
    session: replacement,
  });
  restored.submit(next.id, next.token!, {});
  expect(
    restored.inspect(run.id).work.find((w) => w.id === next.id)?.continuity
      ?.revision,
  ).toBe(2);
  expect(
    restored.contextGroups.read({ runId: run.id, group: 'author' }).total,
  ).toBe(3);
});

it('keeps fresh reviewers outside author groups and preserves ungrouped legacy claims', () => {
  const e = setup(),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'review',
      kind: 'agent',
      prompt: 'Review',
      label: 'Review',
      context: { mode: 'fresh' },
    }),
  );
  d.edges[1].target = 'review';
  d.edges.push({
    id: 'out',
    source: 'review',
    target: 'exit',
    port: 'default',
  });
  const run = start(e, d);
  complete(e, run.id);
  const review = e.available(run.id)[0];
  expect(review.continuity).toBeUndefined();
  expect(review.executionInstructions).toMatch(/isolated/);
  expect(() => e.claim(review.id, worker)).toThrow(/fresh context/);
  const c = e.claim(review.id, {
    ...worker,
    freshContext: true,
    session: undefined,
  });
  e.submit(c.id, c.token!, {});
  expect(e.contextGroups.read({ runId: run.id, group: 'author' }).total).toBe(
    1,
  );
  const legacy = start(e, blankDefinition());
  expect(
    e.claim(e.available(legacy.id)[0].id, { ...worker, session: undefined })
      .continuity,
  ).toBeUndefined();
});

it.each(['wait', 'detached'] as const)(
  'keeps %s child invocations and independent roots unbound',
  (mode) => {
    const e = setup(),
      child = publish(e),
      parent = workflowCall(child, mode, true);
    const after = parent.nodes.find((n) => n.id === 'after');
    if (after?.kind === 'agent') after.context.continuityGroup = 'author';
    const root = e.start(publish(e, parent), {}).run;
    const firstChild = e.available(root.id).find((w) => w.runId !== root.id)!;
    const childClaim = e.claim(firstChild.id, worker);
    e.submit(childClaim.id, childClaim.token!, {});
    const parentWork = e.available(root.id).find((w) => w.runId === root.id)!;
    expect(parentWork.continuity?.session).toBeNull();
    e.claim(parentWork.id, { ...worker, session: replacement });
    const other = e.start(child, {}).run;
    expect(e.available(other.id)[0].continuity?.session).toBeNull();
    expect(
      e.contextGroups.read({ runId: firstChild.runId, group: 'author' })
        .session,
    ).toEqual(session);
  },
);

it('scopes equal group names independently in concurrent Batch items', () => {
  const e = setup(),
    item = itemAgent();
  if (item.kind === 'agent') item.context.continuityGroup = 'author';
  const root = e.start(publish(e, batchDefinition(item)), [1, 2]).run;
  const [a, b] = e.available(root.id);
  e.claim(a.id, worker);
  expect(e.available(root.id)[0].continuity?.session).toBeNull();
  e.claim(b.id, { ...worker, session: replacement });
  expect(
    e.contextGroups.read({ runId: root.id, group: 'author' }).revision,
  ).toBe(0);
});

it('deletes context history with workflow run history and bounds reads', () => {
  const e = setup(),
    run = start(e);
  complete(e, run.id);
  expect(() =>
    e.contextGroups.read({ runId: run.id, group: 'author', limit: 101 }),
  ).toThrow();
  expect(() =>
    e.contextGroups.read({ runId: 'missing', group: 'author' }),
  ).toThrow(/Run not found/);
  e.deleteWorkflow(run.workflowId);
  expect(e.store.list('contextGroups')).toEqual([]);
  expect(e.store.list('contextEvents')).toEqual([]);
});

it('round trips group declarations without exporting run session identities', () => {
  const e = setup(),
    run = start(e);
  complete(e, run.id);
  const bundle = exportWorkflows(e.store, run.workflowId);
  expect(JSON.stringify(bundle)).not.toContain('sessionId');
  const target = setup();
  importWorkflows(target.store, bundle);
  const imported = target.start(run.workflowId, {}).run;
  expect(target.available(imported.id)[0]).toMatchObject({
    context: { continuityGroup: 'author' },
    continuity: { revision: 0, session: null },
  });
});

it('rolls back the first binding and audit event if claim persistence fails', () => {
  const e = setup(),
    run = start(e);
  vi.spyOn(e.usage, 'claimed').mockImplementationOnce(() => {
    throw new Error('write failed');
  });
  expect(() => claim(e, run.id)).toThrow('write failed');
  expect(
    e.contextGroups.read({ runId: run.id, group: 'author' }),
  ).toMatchObject({ revision: 0, session: null, total: 0 });
  expect(e.available(run.id)[0]).toMatchObject({
    attempt: 0,
    status: 'available',
  });
  expect(e.run(run.id).contextRevision).toBeUndefined();
  expect(claim(e, run.id).continuity?.revision).toBe(1);
});

it('wakes waiting coordinators when a handoff occurs between Agent phases', async () => {
  const e = setup(),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'pause',
      kind: 'wait',
      label: 'Pause',
      timing: { kind: 'duration', ms: 60000 },
    }),
  );
  d.edges[1].target = 'pause';
  d.edges.push({ id: 'end', source: 'pause', target: 'exit', port: 'default' });
  const run = start(e, d),
    c = complete(e, run.id);
  expect(e.available(run.id)).toHaveLength(0);
  const before = e.continuation.briefing({ id: run.id, limit: 20 });
  const wait = e.continuation.wait({
    id: run.id,
    limit: 20,
    cursor: before.cursor,
    timeoutMs: 1000,
  });
  e.handoffContext(handoff(run.id));
  expect(await wait).toMatchObject({ changed: true, timedOut: false });
  expect(
    e.inspect(run.id).work.find((w) => w.id === c.id)?.continuity?.session,
  ).toEqual(session);
  e.handoffContext({ ...handoff(run.id), expectedRevision: 2, session });
  expect(() => e.handoffContext(handoff(run.id))).toThrow(/revision conflict/);
  e.cancel(run.id);
  expect(() =>
    e.handoffContext({ ...handoff(run.id), expectedRevision: 3 }),
  ).toThrow(/completed or cancelled/);
});

it('opens a previous-release database unchanged and persists new groups across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-context-legacy-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite'),
    db = new DatabaseSync(path);
  db.exec(previousRelease.schema.join(';\n'));
  db.exec(
    'INSERT INTO migrations VALUES (1),(2),(3); INSERT INTO continuation_sequence VALUES (1,0);',
  );
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  db.close();
  const e = setup(path);
  expect(e.store.migration).toEqual({ from: 3, to: 3 });
  for (const [collection, records] of Object.entries(previousRelease.documents))
    expect(e.store.list(collection)).toEqual(records);
  const active = e.store.work().find((w) => w.status === 'claimed')!;
  e.submit(active.id, 'testbench-fixture-token', { resumed: true });
  expect(e.run(active.runId).status).toBe('completed');
  const run = start(e),
    c = claim(e, run.id);
  e.reportFailure(c.id, c.token!, 'session lost');
  e.handoffContext(handoff(run.id));
  const record = e.contextGroups.read({ runId: run.id, group: 'author' });
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const restored = setup(path);
  expect(
    restored.contextGroups.read({ runId: run.id, group: 'author' }),
  ).toEqual(record);
  expect(restored.handoffContext(handoff(run.id)).applied).toBe(false);
  expect(restored.available(run.id)[0].continuity).toMatchObject({
    session: replacement,
    checkpointRef: '.tasks/checkpoint.md',
  });
});
