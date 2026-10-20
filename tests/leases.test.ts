import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { blankDefinition, nodeSchema, type WorkRequest } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const worker = {
  workerId: 'executor',
  freshContext: false,
  tools: [],
  skills: [],
};
afterEach(() => vi.useRealTimers());

it.each([60, 300, 3600])(
  'retains a %i-second claim duration across renewals and restart',
  (duration) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    const directory = mkdtempSync(join(tmpdir(), 'interlock-lease-'));
    const path = join(directory, 'test.db');
    let store = new Store(path);
    let engine = new Engine(store, process.cwd());
    try {
      const workflow = engine.create('Lease', '', blankDefinition());
      engine.publish(workflow.id);
      const run = engine.start(workflow.id, {}).run;
      const [work] = engine.available(run.id);
      const claim = engine.claim(work.id, worker, duration);
      const renew = (seconds?: number) =>
        engine.renew(work.id, claim.token!, seconds);
      const deadline = (seconds: number) =>
        new Date(Date.now() + seconds * 1000).toISOString();
      vi.advanceTimersByTime(1000);
      expect(renew().leaseUntil).toBe(deadline(duration));
      // Explicit overrides apply once; they do not replace the original claim duration.
      expect(renew(10).leaseUntil).toBe(deadline(10));
      engine.stop();
      store.close();
      store = new Store(path);
      engine = new Engine(store, process.cwd());
      vi.advanceTimersByTime(1000);
      expect(renew().leaseUntil).toBe(deadline(duration));
      vi.advanceTimersByTime(1000);
      expect(renew().leaseUntil).toBe(deadline(duration));
      vi.advanceTimersByTime(duration * 1000);
      expect(() => renew()).toThrow('Claim expired');
      expect(() => renew(3600)).toThrow('Claim expired');
    } finally {
      engine.stop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('uses the legacy fallback and replaces the duration when work is reclaimed', () => {
  vi.useFakeTimers();
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const workflow = engine.create('Legacy claim', '', blankDefinition());
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {}).run;
    const [work] = engine.available(run.id);
    const claim = engine.claim(work.id, worker, 3600);
    const legacy = store.get<WorkRequest>('work', work.id)!;
    delete legacy.claimLeaseSeconds;
    store.put('work', legacy);
    expect(engine.renew(work.id, claim.token!).leaseUntil).toBe(
      new Date(Date.now() + 300000).toISOString(),
    );
    engine.reportFailure(work.id, claim.token!, 'Retry');
    const next = engine.claim(work.id, worker, 60);
    expect(() => engine.renew(work.id, claim.token!)).toThrow('Claim token');
    expect(engine.renew(work.id, next.token!).leaseUntil).toBe(
      new Date(Date.now() + 60000).toISOString(),
    );
    engine.cancel(run.id);
    expect(() => engine.renew(work.id, next.token!)).toThrow();
  } finally {
    engine.stop();
    store.close();
  }
});

it.each([10, 1800, 3600])(
  'honors a configured %i-second lease, explicit overrides, and fallback',
  (duration) => {
    vi.useFakeTimers();
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
    try {
      const d = blankDefinition();
      d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], leaseSeconds: duration });
      const w = engine.create('Configured', '', d);
      engine.publish(w.id);
      const run = engine.startSummary(w.id, {});
      expect(run.nextWork.items[0]).toMatchObject({ leaseSeconds: duration });
      expect(engine.workSummaries(run.runId)[0]).toMatchObject({
        leaseSeconds: duration,
      });
      const claim = engine.claim(run.nextWork.items[0].id, worker);
      expect(claim.claimLeaseSeconds).toBe(duration);
      expect(Date.parse(claim.leaseUntil!) - Date.now()).toBe(duration * 1000);
      engine.reportFailure(claim.id, claim.token!, 'Try again');
      const override = engine.claim(claim.id, worker, 60);
      expect(override.claimLeaseSeconds).toBe(60);
      expect(override.leaseSeconds).toBe(duration);
      expect(
        Date.parse(engine.renew(claim.id, override.token!).leaseUntil!) -
          Date.now(),
      ).toBe(60_000);
      engine.submit(claim.id, override.token!, {});
      const legacy = engine.create('Unconfigured', '', blankDefinition());
      expect(legacy.draft.nodes[1]).not.toHaveProperty('leaseSeconds');
      engine.publish(legacy.id);
      const old = engine.start(legacy.id, {}).run;
      const fallback = engine.claim(engine.available(old.id)[0].id, worker);
      expect(fallback.claimLeaseSeconds).toBe(300);
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it('keeps published node defaults for pending and subsequent assignments across restart', () => {
  vi.useFakeTimers();
  const dir = mkdtempSync(join(tmpdir(), 'interlock-node-lease-'));
  const path = join(dir, 'state.db');
  let store = new Store(path),
    engine = new Engine(store, process.cwd());
  try {
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], leaseSeconds: 1800 });
    d.nodes.push(nodeSchema.parse({ ...d.nodes[1], id: 'second' }));
    d.edges = [
      { id: 'a', source: 'entry', target: 'agent', port: 'default' },
      { id: 'b', source: 'agent', target: 'second', port: 'default' },
      { id: 'c', source: 'second', target: 'exit', port: 'default' },
    ];
    const w = engine.create('Pinned defaults', '', d);
    engine.publish(w.id);
    const run = engine.start(w.id, {}).run;
    const first = engine.available(run.id)[0];
    const edit = engine.editDraft(
      w.id,
      w.draftRevision,
      ['agent', 'second'].map((id) => ({
        op: 'update_node',
        id,
        set: { leaseSeconds: 60 },
      })),
    );
    expect(edit.applied).toBe(true);
    engine.publish(w.id);
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store, process.cwd());
    const claim = engine.claim(first.id, worker);
    expect(claim.claimLeaseSeconds).toBe(1800);
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store, process.cwd());
    vi.advanceTimersByTime(1000);
    expect(
      Date.parse(engine.renew(first.id, claim.token!).leaseUntil!) - Date.now(),
    ).toBe(1800000);
    engine.submit(first.id, claim.token!, {});
    const next = engine.claim(engine.available(run.id)[0].id, worker);
    expect(next.claimLeaseSeconds).toBe(1800);
    const newRun = engine.start(w.id, {}).run;
    expect(
      engine.claim(engine.available(newRun.id)[0].id, worker).claimLeaseSeconds,
    ).toBe(60);
    const target = new Store(':memory:');
    const imported = new Engine(target, process.cwd());
    try {
      importWorkflows(target, exportWorkflows(store, w.id));
      const oldVersion = imported.start(w.id, {}, 1).run;
      expect(
        imported.claim(imported.available(oldVersion.id)[0].id, worker)
          .claimLeaseSeconds,
      ).toBe(1800);
      expect(imported.workflow(w.id).draft.nodes[1]).toMatchObject({
        leaseSeconds: 60,
      });
    } finally {
      imported.stop();
      target.close();
    }
  } finally {
    engine.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects invalid configured durations without changing a draft', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  try {
    const w = engine.create('Bounds', '', blankDefinition());
    for (const leaseSeconds of [0, 9, 3601, 10.5, '300', null]) {
      expect(() =>
        nodeSchema.parse({ ...w.draft.nodes[1], leaseSeconds }),
      ).toThrow();
      expect(
        engine.editDraft(w.id, w.draftRevision, [
          { op: 'update_node', id: 'agent', set: { leaseSeconds } },
        ]).applied,
      ).toBe(false);
      expect(engine.workflow(w.id)).toEqual(w);
    }
    expect(
      engine.editDraft(w.id, w.draftRevision, [
        { op: 'update_node', id: 'agent', set: { leaseSeconds: 10 } },
      ]).applied,
    ).toBe(true);
    const current = engine.workflow(w.id);
    expect(
      engine.editDraft(w.id, current.draftRevision, [
        { op: 'update_node', id: 'agent', unset: ['leaseSeconds'] },
      ]).applied,
    ).toBe(true);
    expect(engine.workflow(w.id).draft.nodes[1]).not.toHaveProperty(
      'leaseSeconds',
    );
  } finally {
    engine.stop();
    store.close();
  }
});

it('reports each expiration once while preserving attempts and token rejection', () => {
  vi.useFakeTimers();
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  try {
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], leaseSeconds: 60 });
    const w = engine.create('Expiring', '', d);
    engine.publish(w.id);
    const run = engine.start(w.id, {}).run;
    const claim = engine.claim(engine.available(run.id)[0].id, worker);
    const renewed = engine.renew(claim.id, claim.token!, 10);
    vi.advanceTimersByTime(10000);
    expect(() => engine.renew(claim.id, claim.token!)).toThrow('Claim expired');
    expect(() => engine.submit(claim.id, claim.token!, {})).toThrow(
      'Claim expired',
    );
    engine.pump();
    engine.pump();
    let events = engine
      .inspect(run.id)
      .events.filter((e) => e.type === 'work.lease_expired');
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain(claim.id);
    expect(events[0].message).toContain(renewed.leaseUntil);
    expect(events[0].message).toContain('attempt 1/2');
    expect(events[0].message).toContain('Another attempt is available');
    expect(events[0].message).not.toContain(claim.token);
    expect(engine.available(run.id)[0]).toMatchObject({
      attempt: 1,
      leaseSeconds: 60,
    });
    const second = engine.claim(claim.id, worker);
    expect(second.token).not.toBe(claim.token);
    expect(second.claimLeaseSeconds).toBe(60);
    expect(() => engine.submit(claim.id, claim.token!, {})).toThrow(
      'Claim token',
    );
    vi.advanceTimersByTime(60000);
    engine.pump();
    engine.pump();
    events = engine
      .inspect(run.id)
      .events.filter((e) => e.type === 'work.lease_expired');
    expect(events).toHaveLength(2);
    expect(events[1].message).toContain('attempt 2/2');
    expect(events[1].message).toContain('No attempts remain');
    expect(engine.run(run.id)).toMatchObject({
      status: 'failed',
      error: 'Worker lease expired',
    });
    expect(
      engine.inspect(run.id).events.filter((e) => e.type === 'work.retry'),
    ).toHaveLength(1);
    engine.retry(run.id);
    const retry = engine.claim(engine.available(run.id)[0].id, worker);
    engine.reportFailure(retry.id, retry.token!, 'Worker reported');
    expect(
      engine
        .inspect(run.id)
        .events.filter((e) => e.type === 'work.lease_expired'),
    ).toHaveLength(2);
    const final = engine.claim(retry.id, worker);
    engine.submit(final.id, final.token!, {});
    expect(engine.submit(final.id, final.token!, {}).run.status).toBe(
      'completed',
    );
    expect(() =>
      engine.submit(final.id, final.token!, { different: true }),
    ).toThrow();
  } finally {
    engine.stop();
    store.close();
  }
});
