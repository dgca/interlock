import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { blankDefinition, type WorkRequest } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

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
