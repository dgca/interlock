import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { blankDefinition, nodeSchema, type WorkRequest } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

const worker = {
  workerId: 'worker',
  freshContext: false,
  tools: [],
  skills: [],
};
afterEach(() => vi.useRealTimers());
function setup(
  store = new Store(':memory:'),
  budget: number | undefined = 3,
  maxAttempts = 2,
) {
  const engine = new Engine(store, process.cwd());
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    ...definition.nodes[1],
    maxAttempts,
    maxLeaseExpiries: budget,
    leaseSeconds: 10,
  });
  const workflow = engine.create('Recovery', '', definition);
  engine.publish(workflow.id);
  const run = engine.start(workflow.id, {}).run;
  const work = engine.available(run.id)[0];
  return { engine, store, workflow, run, work };
}

it('separates failure and expiry budgets while claims remain monotonic', () => {
  vi.useFakeTimers();
  const { engine, store, run, work } = setup();
  try {
    const first = engine.claim(work.id, worker);
    vi.advanceTimersByTime(9999);
    expect(engine.renew(first.id, first.token!, 10).leaseUntil).toBe(
      new Date(Date.now() + 10000).toISOString(),
    );
    vi.advanceTimersByTime(10000);
    expect(() => engine.submit(first.id, first.token!, {})).toThrow(
      'currently available again',
    );
    expect(store.get<WorkRequest>('work', work.id)).toMatchObject({
      status: 'available',
      attempt: 1,
      leaseExpiryCount: 1,
      failureCount: 0,
    });
    expect(engine.workSummaries(run.id)[0]).toMatchObject({
      maxLeaseExpiries: 3,
      failureCount: 0,
      leaseExpiryCount: 1,
    });
    expect(
      engine.continuation.summary(run.id, 20).nextWork.items[0],
    ).toMatchObject({ maxLeaseExpiries: 3, leaseExpiryCount: 1 });
    expect(JSON.stringify(engine.inspect(run.id))).not.toContain('tokenHash');
    const second = engine.claim(work.id, worker);
    expect(second).not.toHaveProperty('expiredClaims');
    engine.reportFailure(second.id, second.token!, 'bad result');
    const third = engine.claim(work.id, worker);
    expect(third).toMatchObject({
      attempt: 3,
      leaseExpiryCount: 1,
      failureCount: 1,
    });
    vi.advanceTimersByTime(10000);
    expect(() => engine.renew(third.id, third.token!)).toThrow(
      'failures 1/2, expiries 2/3',
    );
    expect(() => engine.submit(first.id, first.token!, {})).toThrow(
      'reclaimed after this claim expired',
    );
    const fourth = engine.claim(work.id, worker);
    engine.submit(fourth.id, fourth.token!, { done: true });
    vi.advanceTimersByTime(20000);
    expect(
      engine.submit(fourth.id, fourth.token!, { done: true }).run.status,
    ).toBe('completed');
    expect(() => engine.submit(first.id, first.token!, {})).toThrow(
      'Assignment is completed',
    );
    expect(
      engine
        .inspect(run.id)
        .events.filter((e) => e.type === 'work.lease_expired'),
    ).toHaveLength(2);
  } finally {
    engine.stop();
    store.close();
  }
});

it.each(['expiry', 'failure'] as const)(
  'exhausts only the configured %s budget',
  (reason) => {
    vi.useFakeTimers();
    const { engine, store, run, work } = setup(undefined, 2, 1);
    try {
      const first = engine.claim(work.id, worker);
      vi.advanceTimersByTime(10000);
      expect(() => engine.renew(first.id, first.token!)).toThrow(
        'currently available again',
      );
      const second = engine.claim(work.id, worker);
      if (reason === 'expiry') {
        vi.advanceTimersByTime(10000);
        expect(() => engine.submit(second.id, second.token!, {})).toThrow(
          'Lease expiry budget exhausted',
        );
      } else engine.reportFailure(second.id, second.token!, 'Explicit failure');
      expect(engine.run(run.id)).toMatchObject({
        status: 'failed',
        error:
          reason === 'expiry'
            ? 'Lease expiry budget exhausted'
            : 'Explicit failure',
      });
      expect(() => engine.renew(first.id, first.token!)).toThrow(
        'Assignment failed',
      );
      expect(() => engine.claim(work.id, worker)).toThrow(
        'Work is not available',
      );
      expect(store.get<WorkRequest>('work', work.id)).toMatchObject({
        attempt: 2,
        leaseExpiryCount: reason === 'expiry' ? 2 : 1,
        failureCount: reason === 'expiry' ? 0 : 1,
      });
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it('persists receipts and captured policy across restart and draft publication', () => {
  vi.useFakeTimers();
  const directory = mkdtempSync(join(tmpdir(), 'interlock-recovery-'));
  const db = join(directory, 'test.db');
  let { engine, store, work, run, workflow } = setup(new Store(db));
  try {
    const first = engine.claim(work.id, worker);
    vi.advanceTimersByTime(10000);
    engine.pump();
    engine.editDraft(workflow.id, workflow.draftRevision, [
      { op: 'update_node', id: 'agent', set: { maxLeaseExpiries: 1 } },
    ]);
    engine.publish(workflow.id);
    engine.stop();
    store.close();
    store = new Store(db);
    engine = new Engine(store, process.cwd());
    expect(() => engine.renew(work.id, first.token!)).toThrow('expiries 1/3');
    const second = engine.claim(work.id, worker);
    vi.advanceTimersByTime(10000);
    engine.pump();
    expect(() => engine.submit(first.id, first.token!, {})).toThrow(
      'reclaimed after this claim expired',
    );
    expect(() => engine.submit(second.id, 'unknown', {})).toThrow(
      'Claim token does not match',
    );
    const before = store.get('work', work.id);
    expect(() => engine.submit(first.id, first.token!, {})).toThrow();
    expect(store.get('work', work.id)).toEqual(before);
    engine.cancel(run.id);
    expect(() => engine.renew(second.id, second.token!)).toThrow(
      'Assignment is cancelled',
    );
    const next = engine.start(workflow.id, {}).run;
    expect(engine.available(next.id)[0].maxLeaseExpiries).toBe(1);
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('reports the unclaimed timeout instead of suggesting reclaim', () => {
  vi.useFakeTimers();
  const { engine, store, workflow } = setup();
  try {
    const definition = structuredClone(workflow.draft);
    definition.nodes[1] = nodeSchema.parse({
      ...definition.nodes[1],
      unclaimedTimeoutMs: 1000,
    });
    definition.edges.push({
      id: 'timeout',
      source: 'agent',
      target: 'exit',
      port: 'timeout',
    });
    engine.update(workflow.id, {
      draft: definition,
      draftRevision: workflow.draftRevision,
    });
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {}).run;
    const claim = engine.claim(engine.available(run.id)[0].id, worker);
    vi.advanceTimersByTime(10000);
    engine.pump();
    vi.advanceTimersByTime(1000);
    expect(() => engine.submit(claim.id, claim.token!, {})).toThrow(
      'Assignment is timed_out',
    );
  } finally {
    engine.stop();
    store.close();
  }
});

it('validates separate-budget bounds without changing the draft', () => {
  const { engine, store, workflow } = setup();
  try {
    for (const maxLeaseExpiries of [0, 11, 1.5, '3', null]) {
      const before = engine.workflow(workflow.id);
      expect(
        engine.editDraft(workflow.id, before.draftRevision, [
          { op: 'update_node', id: 'agent', set: { maxLeaseExpiries } },
        ]).applied,
      ).toBe(false);
      expect(engine.workflow(workflow.id)).toEqual(before);
    }
  } finally {
    engine.stop();
    store.close();
  }
});

it('commits expiry when the deadline crosses after the initial timer pump', () => {
  vi.useFakeTimers();
  const { engine, store, work } = setup();
  try {
    const claim = engine.claim(work.id, worker);
    vi.setSystemTime(Date.parse(claim.leaseUntil!) - 1);
    const pump = engine.pump.bind(engine);
    const spy = vi.spyOn(engine, 'pump').mockImplementation(() => {
      pump();
      vi.advanceTimersByTime(1);
    });
    expect(() => engine.renew(work.id, claim.token!)).toThrow(
      'currently available again',
    );
    spy.mockRestore();
    expect(store.get<WorkRequest>('work', work.id)).toMatchObject({
      status: 'available',
      leaseExpiryCount: 1,
    });
    const replacement = engine.claim(work.id, worker);
    expect(engine.submit(work.id, replacement.token!, {}).run.status).toBe(
      'completed',
    );
  } finally {
    engine.stop();
    store.close();
  }
});
