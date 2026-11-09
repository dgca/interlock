import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  nodeSchema,
  eventConfigSchema,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
const paths: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function setup(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.push(engine);
  return engine;
}
function workflow(engine: Engine, definition = blankDefinition()) {
  const w = engine.create('Retention', '', definition);
  engine.publish(w.id);
  return w.id;
}
function complete(
  engine: Engine,
  workflowId: string,
  ageDays = 10,
  requestId?: string,
) {
  const run = engine.start(
    workflowId,
    { secret: 'PRIVATE_HISTORY' },
    undefined,
    undefined,
    requestId ? { requestId } : undefined,
  ).run;
  for (const item of engine.available(run.id)) {
    const claim = engine.claim(item.id, {
      workerId: 'retention',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(claim.id, claim.token!, null);
  }
  const current = engine.run(run.id);
  current.createdAt = current.updatedAt = new Date(
    Date.now() - ageDays * 86_400_000,
  ).toISOString();
  engine.store.put('runs', current);
  return current;
}
function configure(
  engine: Engine,
  policy: { maxAgeDays?: number; maxCompletedRuns?: number } | null | 'inherit',
  workflowId?: string,
) {
  return engine.retention.configure({
    workflowId,
    expectedRevision: engine.retention.settings({ workflowId }).revision,
    policy,
  });
}
function kept(engine: Engine, id: string) {
  return !!engine.store.get('runs', id);
}

it('defaults to preserving history; rejects invalid, stale and unknown settings without side effects', () => {
  const e = setup(),
    id = workflow(e),
    run = complete(e, id);
  e.pump();
  expect(kept(e, run.id)).toBe(true);
  expect(e.retention.settings()).toMatchObject({
    revision: 0,
    policy: null,
    effectivePolicy: null,
    inherited: false,
  });
  expect(e.retention.settings({ workflowId: id })).toMatchObject({
    revision: 0,
    inherited: true,
    effectivePolicy: null,
  });
  expect(() => configure(e, {})).toThrow('at least one');
  expect(() => configure(e, 'inherit')).toThrow('Only workflow');
  expect(() => configure(e, { maxCompletedRuns: -1 })).toThrow();
  expect(() => configure(e, { maxAgeDays: 36501 })).toThrow();
  expect(() => configure(e, { maxAgeDays: 1 }, 'unknown')).toThrow(
    'Workflow not found',
  );
  configure(e, { maxAgeDays: 1 });
  const state = e.retention.status();
  expect(() =>
    e.retention.configure({ expectedRevision: 0, policy: null }),
  ).toThrow('changed');
  expect(e.retention.status()).toEqual(state);
  configure(e, null);
  expect(e.retention.status().nextCheckAt).toBeNull();
});

it('counts terminal whole trees across inheriting workflows, isolates overrides and applies either age or count', () => {
  const e = setup(),
    a = workflow(e),
    b = workflow(e),
    c = workflow(e),
    d = workflow(e);
  const oldest = complete(e, a, 20),
    newest = complete(e, b, 2),
    overrideOld = complete(e, c, 15),
    overrideNew = complete(e, c, 3),
    disabled = complete(e, d, 40);
  expect(e.report({}).summary.totalRuns).toBe(5);
  configure(e, { maxCompletedRuns: 1, maxAgeDays: 10 });
  configure(e, { maxCompletedRuns: 1 }, c);
  configure(e, null, d);
  e.pump();
  expect(
    [oldest, newest, overrideOld, overrideNew, disabled].map((r) =>
      kept(e, r.id),
    ),
  ).toEqual([false, true, false, true, true]);
  expect(e.report({}).summary.totalRuns).toBe(3);
  expect(e.retention.status().lastSweep).toMatchObject({
    candidates: 2,
    deletedRoots: 2,
    deletedRuns: 2,
  });
  expect(e.retention.settings({ workflowId: c })).toMatchObject({
    inherited: false,
    effectivePolicy: { maxCompletedRuns: 1 },
  });
  configure(e, 'inherit', d);
  e.pump();
  expect(kept(e, disabled.id)).toBe(false);
});

it('uses whole-tree last update and preserves active detached descendants, ancestry gaps, uncertain ownership and comparison evidence', () => {
  const e = setup(),
    child = workflow(e),
    parent = workflow(e, workflowCall(child, 'detached'));
  const active = e.start(parent, null).run;
  const safe = complete(e, child, 30),
    uncertain = complete(e, child, 30),
    compared = complete(e, child, 30),
    gap = complete(e, child, 30);
  e.store.put('uncertainOperations', {
    id: 'uncertain',
    runId: uncertain.id,
    executionId: 'operation',
    attempt: 1,
    revokedAt: new Date().toISOString(),
    reason: 'restart',
  });
  e.store.put('comparisons', {
    id: 'comparison',
    status: 'completed',
    samples: [{ runId: compared.id }],
  });
  e.store.put('runs', { ...gap, parentRunId: 'missing' });
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  expect(kept(e, safe.id)).toBe(false);
  for (const r of [active, uncertain, compared, gap])
    expect(kept(e, r.id)).toBe(true);
  expect(e.retention.status().lastSweep).toMatchObject({
    protectedTrees: 3,
    deletedRoots: 1,
  });
});

it('protected terminal trees count without displacing a retained newest tree', () => {
  const e = setup(),
    id = workflow(e),
    protectedOld = complete(e, id, 20),
    middle = complete(e, id, 10),
    newest = complete(e, id, 2);
  e.store.put('workResources', {
    id: 'resource',
    runId: protectedOld.id,
    state: 'uncertain',
  });
  configure(e, { maxCompletedRuns: 1 });
  e.pump();
  expect([protectedOld, middle, newest].map((r) => kept(e, r.id))).toEqual([
    true,
    false,
    true,
  ]);
});

it('schedules hourly, catches up bounded batches, gives recent trees an observation window and retries after restart', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  const dir = mkdtempSync(join(tmpdir(), 'interlock-retention-'));
  paths.push(dir);
  let e = setup(join(dir, 'store.sqlite'));
  const id = workflow(e);
  for (let i = 0; i < 102; i++) complete(e, id, 10);
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  expect(e.retention.status().lastSweep?.deletedRoots).toBe(100);
  expect(e.store.historyRuns()).toHaveLength(2);
  const first = e.retention.status();
  e.pump();
  expect(e.retention.status()).toEqual(first);
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  vi.advanceTimersByTime(60_000);
  e = setup(join(dir, 'store.sqlite'));
  e.pump();
  expect(e.store.historyRuns()).toHaveLength(0);
  const recent = complete(e, id, 0);
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  expect(kept(e, recent.id)).toBe(true);
  vi.advanceTimersByTime(60_000);
  e.pump();
  expect(kept(e, recent.id)).toBe(false);
  const later = complete(e, id, 10);
  e.pump();
  expect(kept(e, later.id)).toBe(true);
  vi.advanceTimersByTime(3_600_000);
  e.pump();
  expect(kept(e, later.id)).toBe(false);
});

it('rolls back every deleted document and receipt on a write failure, records error and later succeeds', () => {
  const e = setup(),
    id = workflow(e),
    a = complete(e, id, 10, 'a'),
    b = complete(e, id, 10, 'b');
  configure(e, { maxCompletedRuns: 0 });
  const ids = new Set([a.id, b.id]);
  const inventoryBefore = e.store.historyInventory(ids);
  const before = ['runs', 'work', 'events', 'usageAttempts', 'runStarts'].map(
    (c) => e.store.list(c),
  );
  const original = e.store.put.bind(e.store);
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'historyRetentionState')
        throw new Error('injected status write failure');
      return original(collection, value);
    });
  expect(() => e.retention.tick()).not.toThrow();
  expect(e.retention.status().lastError).toContain('injected status');
  expect(
    ['runs', 'work', 'events', 'usageAttempts', 'runStarts'].map((c) =>
      e.store.list(c),
    ),
  ).toEqual(before);
  expect(e.store.historyInventory(ids)).toEqual(inventoryBefore);
  spy.mockRestore();
  const remove = vi
    .spyOn(e.store, 'deleteHistoryDocuments')
    .mockImplementation(() => {
      throw new Error('injected deletion failure');
    });
  configure(e, { maxCompletedRuns: 0 });
  e.retention.tick();
  expect(e.retention.status().lastError).toContain('injected deletion');
  expect(
    ['runs', 'work', 'events', 'usageAttempts', 'runStarts'].map((c) =>
      e.store.list(c),
    ),
  ).toEqual(before);
  expect(e.store.historyInventory(ids)).toEqual(inventoryBefore);
  remove.mockRestore();
  configure(e, { maxCompletedRuns: 0 });
  e.retention.tick();
  expect(kept(e, a.id) || kept(e, b.id)).toBe(false);
  expect(e.retention.status().lastError).toBeNull();
  expect(
    e.store.list<{ deletedAt?: string }>('runStarts').every((r) => r.deletedAt),
  ).toBe(true);
});

it('reclaims file-backed pages for reuse, preserves durable trigger receipts and avoids history payloads in status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-retention-space-'));
  paths.push(dir);
  const e = setup(join(dir, 'store.sqlite')),
    id = workflow(e),
    run = complete(e, id, 10);
  const current = e.run(run.id);
  current.input = { payload: 'x'.repeat(2_000_000) };
  e.store.put('runs', current);
  for (const collection of ['eventTriggerReceipts'])
    e.store.put(collection, {
      id: collection,
      runId: run.id,
      hash: 'retained',
    });
  const before = e.store.storageSpace();
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  const status = e.retention.status();
  expect(status.storage.reusableBytes).toBeGreaterThan(before.reusableBytes);
  expect(status.storage.databaseBytes).toBeGreaterThan(0);
  for (const collection of ['eventTriggerReceipts'])
    expect(e.store.list(collection)).toHaveLength(1);
  expect(JSON.stringify(status)).not.toContain('PRIVATE_HISTORY');
  expect(status.lastSweep!.removedDocumentBytes).toBeGreaterThan(2_000_000);
  const refill = complete(e, id, 0);
  const refilled = e.run(refill.id);
  refilled.input = { payload: 'y'.repeat(1_000_000) };
  e.store.put('runs', refilled);
  const reused = e.store.storageSpace();
  expect(reused.databaseBytes).toBe(status.storage.databaseBytes);
  expect(reused.reusableBytes).toBeLessThan(status.storage.reusableBytes);
  console.log(
    'retention SQLite space evidence',
    JSON.stringify({
      before,
      afterDeletion: status.storage,
      afterReuse: reused,
    }),
  );
});

it('retains complete chains until every member ages out, then removes all members together including cancelled history', () => {
  const e = setup(),
    definition = blankDefinition();
  definition.nodes[2] = nodeSchema.parse({
    id: 'exit',
    kind: 'exit',
    label: 'Checkpoint',
    continueAsNew: { maxRuns: 2 },
  });
  const id = workflow(e, definition),
    root = complete(e, id, 10);
  const next = e.store.runs().find((r) => r.chain?.index === 2)!;
  configure(e, { maxAgeDays: 1 });
  e.pump();
  expect(kept(e, root.id)).toBe(true);
  e.cancel(next.id);
  e.pump();
  expect(kept(e, root.id)).toBe(true);
  const ended = e.run(next.id);
  ended.updatedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  e.store.put('runs', ended);
  configure(e, { maxAgeDays: 1 });
  e.pump();
  expect(kept(e, root.id) || kept(e, next.id)).toBe(false);
  expect(e.store.list('runChains')).toEqual([]);
});

it('keeps pending lifecycle source evidence through quiescence and preserves the real trigger receipt after dispatch and cleanup', () => {
  const e = setup(),
    source = workflow(e),
    target = workflow(e);
  let trigger = e.triggers.mutate({
    action: 'create',
    workflowId: target,
    config: eventConfigSchema.parse({
      kind: 'event',
      name: 'Retained event',
      events: ['completed'],
      scope: { type: 'workflow', workflowId: source },
      waitForQuiescence: true,
    }),
  }).trigger!;
  trigger = e.triggers.mutate({
    action: 'enable',
    id: trigger.id,
    expectedRevision: trigger.revision,
  }).trigger!;
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: target },
    actor: 'test',
    reason: 'hold handler',
  });
  const run = complete(e, source, 10);
  configure(e, { maxCompletedRuns: 0 }, source);
  e.pump();
  expect(kept(e, run.id)).toBe(true);
  expect(
    e.history.preview({ rootRunIds: [run.id] }).items[0].blockers.join(' '),
  ).toContain('Pending lifecycle');
  expect(e.store.list('eventTriggerReceipts')).toHaveLength(1);
  e.pauses.resume(hold.id);
  e.pump();
  configure(e, { maxCompletedRuns: 0 }, source);
  e.pump();
  expect(kept(e, run.id)).toBe(false);
  expect(e.store.list('eventTriggerReceipts')).toHaveLength(1);
  expect(e.store.runs().filter((r) => r.workflowId === target)).toHaveLength(1);
});

it.each(['scheduleFires', 'eventDeliveries'])(
  'preserves unobserved %s history until its outcome settles',
  (collection) => {
    const e = setup(),
      id = workflow(e),
      run = complete(e, id, 10);
    e.store.put(collection, {
      id: 'pending',
      runId: run.id,
      sourceRunId: run.id,
      settled: false,
    });
    configure(e, { maxCompletedRuns: 0 });
    e.retention.tick();
    expect(kept(e, run.id)).toBe(true);
    expect(
      e.history.preview({ rootRunIds: [run.id] }).items[0].blockers.join(' '),
    ).toContain('Trigger outcomes');
    e.store.remove(collection, 'pending');
    configure(e, { maxCompletedRuns: 0 });
    e.retention.tick();
    expect(kept(e, run.id)).toBe(false);
  },
);

it('uses the latest child update for age and retains archived workflow definitions while cleaning its history', () => {
  const e = setup(),
    child = workflow(e),
    parent = workflow(e, workflowCall(child, 'wait'));
  const run = complete(e, parent, 30);
  const descendant = e.store.runs().find((r) => r.parentRunId === run.id)!;
  descendant.updatedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  e.store.put('runs', descendant);
  configure(e, { maxAgeDays: 10 }, parent);
  e.pump();
  expect(kept(e, run.id)).toBe(true);
  descendant.updatedAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
  e.store.put('runs', descendant);
  const workflowRecord = e.workflow(parent);
  e.store.put('workflows', { ...workflowRecord, archived: true });
  configure(e, { maxAgeDays: 10 }, parent);
  e.pump();
  expect(kept(e, run.id) || kept(e, descendant.id)).toBe(false);
  expect(e.workflow(parent).archived).toBe(true);
  expect(e.store.getVersion(parent, 1)).toBeDefined();
});

it('preserves trees with missing recorded continuation or child history', () => {
  const e = setup(),
    id = workflow(e),
    chain = complete(e, id, 10),
    child = complete(e, id, 10),
    control = complete(e, id, 10);
  chain.chain = { rootRunId: chain.id, index: 1, nextRunId: 'missing-next' };
  child.executions[0].childRunIds = ['missing-child'];
  e.store.put('runs', chain);
  e.store.put('runs', child);
  configure(e, { maxCompletedRuns: 0 });
  e.retention.tick();
  expect([chain, child, control].map((r) => kept(e, r.id))).toEqual([
    true,
    true,
    false,
  ]);
});

it('preserves completed prerequisites while a paused queued run needs their success history', () => {
  const e = setup(),
    source = workflow(e),
    target = workflow(e),
    upstream = complete(e, source, 10, 'prerequisite');
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: target },
    actor: 'test',
    reason: 'queue',
  });
  const waiting = e.start(target, null, undefined, undefined, {
    after: [{ requestId: 'prerequisite' }],
  }).run;
  expect(e.run(waiting.id).status).toBe('queued');
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  expect(kept(e, upstream.id)).toBe(true);
  expect(
    e.history
      .preview({ rootRunIds: [upstream.id] })
      .items[0].blockers.join(' '),
  ).toContain('Queued admission');
  e.pauses.resume(hold.id);
  e.pump();
  expect(e.run(waiting.id).status).toBe('waiting');
  configure(e, { maxCompletedRuns: 0 });
  e.pump();
  expect(kept(e, upstream.id)).toBe(false);
});

it.each(['none', 'library', 'workflow'] as const)(
  'updates the persisted deadline after policy workflow deletion with remaining %s policy',
  (remaining) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const dir = mkdtempSync(join(tmpdir(), 'interlock-retention-delete-'));
    paths.push(dir);
    const path = join(dir, 'store.sqlite');
    let e = setup(path);
    const deleted = workflow(e),
      survivor = workflow(e);
    configure(e, { maxCompletedRuns: 0 }, deleted);
    if (remaining === 'library') configure(e, { maxCompletedRuns: 0 });
    if (remaining === 'workflow')
      configure(e, { maxCompletedRuns: 0 }, survivor);
    // Establish a future persisted deadline, then add old history before it is due.
    e.pump();
    const nextCheckAt = e.retention.status().nextCheckAt;
    expect(nextCheckAt).toBe('2030-01-01T01:00:00.000Z');
    const run = complete(e, survivor, 10);
    e.deleteWorkflow(deleted);
    expect(
      e.store.get('historyRetention', `workflow:${deleted}`),
    ).toBeUndefined();
    expect(e.retention.status().nextCheckAt).toBe(
      remaining === 'none' ? null : nextCheckAt,
    );
    const afterDeletion = e.retention.status();
    e.pump();
    expect(e.retention.status()).toEqual(afterDeletion);
    expect(kept(e, run.id)).toBe(true);
    e.stop();
    e.store.close();
    engines.splice(engines.indexOf(e), 1);
    e = setup(path);
    e.pump();
    expect(e.retention.status().nextCheckAt).toBe(
      remaining === 'none' ? null : nextCheckAt,
    );
    vi.setSystemTime(new Date('2030-01-01T02:00:00Z'));
    e.pump();
    expect(kept(e, run.id)).toBe(remaining === 'none');
    expect(e.retention.status().nextCheckAt).toBe(
      remaining === 'none' ? null : '2030-01-01T03:00:00.000Z',
    );
  },
);
