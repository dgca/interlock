import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
let e: Engine;
let tempDir: string;
const worker = {
  workerId: 'launched',
  freshContext: false,
  tools: [],
  skills: [],
};
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};
let ticket = '',
  launchCount = 0,
  messageCount = 0,
  stopCount = 0,
  status = 'idle';
let onStatus: (() => Response | Promise<Response> | undefined) | undefined;
let onMessage: (() => void) | undefined, onStop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-07T12:00:00Z');
  tempDir = mkdtempSync(join(tmpdir(), 'interlock-idle-'));
  e = new Engine(new Store(join(tempDir, 'db')), process.cwd());
  ticket = '';
  launchCount = messageCount = stopCount = 0;
  status = 'idle';
  onMessage = onStop = onStatus = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const path = String(url);
      if (path.endsWith('/launch')) {
        launchCount++;
        ticket = JSON.parse(options.body).claimTicket;
        return Response.json({ sessionId: 'session-' + launchCount });
      }
      if (path.endsWith('/message')) {
        messageCount++;
        expect(JSON.parse(options.body).message).toBe('Continue now');
        onMessage?.();
        return Response.json({ ok: true });
      }
      if (path.endsWith('/stop')) {
        stopCount++;
        onStop?.();
        return Response.json({ ok: true });
      }
      return onStatus?.() ?? Response.json({ status });
    }),
  );
  e.executors.saveProfile({
    id: 'launcher',
    harness: 'custom',
    name: 'Fake launcher',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'http',
    launchUrl: 'http://fake/launch',
    messageUrl: 'http://fake/message',
    stopUrl: 'http://fake/stop',
    statusUrl: 'http://fake/status',
  });
  e.executors.start([
    {
      id: 'custom',
      detect: async () => ({ status: 'detected', command: 'fake' }),
      run: async () => ({ output: null }),
    },
  ]);
});
afterEach(async () => {
  await e.executors.stop();
  e.stop();
  e.store.close();
  rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function start(extra: Record<string, unknown> = {}) {
  const d = blankDefinition();
  Object.assign(
    d.nodes.find((n) => n.kind === 'agent')!,
    {
      executor: 'launcher',
      claimedIdleStallMs: 3000,
      idleRecovery: { maxRecoveries: 1, message: 'Continue now' },
      maxAttempts: 3,
      maxExecutionMs: 100000,
      ...extra,
    },
  );
  const w = e.create('Recovery', '', definitionSchema.parse(d));
  e.publish(w.id);
  const r = e.start(w.id, null).run;
  await settle();
  expect(launchCount).toBe(1);
  const work = e.available(r.id)[0];
  const claim = e.claim(work.id, { ...worker, claimTicket: ticket });
  return { r, claim };
}
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
  e.pump();
  await settle();
}
it('executes one nudge then confirmed stop and relaunch through ordinary budgets and fresh tickets', async () => {
  const { r, claim } = await start();
  await tick(3000);
  expect(messageCount).toBe(1);
  expect(e.executors.inspect(claim.id).items[0].recoveryEvents).toMatchObject([
    { errorClass: 'idle', action: 'nudge' },
  ]);
  expect(stopCount).toBe(0);
  onStop = () => {
    status = 'ended';
  };
  await tick(3000);
  expect(stopCount).toBe(1);
  expect(launchCount).toBe(2);
  expect(e.executors.inspect(claim.id).history).toContainEqual(
    expect.objectContaining({ id: `${claim.id}:1`, state: 'failed' }),
  );
  const work = e.store.work()[0];
  expect(work).toMatchObject({
    status: 'available',
    attempt: 1,
    idleRecoveryCount: 1,
    maxExecutionMs: 100000,
  });
  expect(() => e.claim(work.id, { ...worker, claimTicket: 'wrong' })).toThrow(
    /ticket/i,
  );
  const c = e.claim(work.id, { ...worker, claimTicket: ticket });
  expect(c.attempt).toBe(2);
  status = 'idle';
  await tick(9000);
  expect(messageCount).toBe(1);
  expect(stopCount).toBe(1);
  expect(e.run(r.id).status).toBe('waiting');
  expect(() => e.submit(claim.id, claim.token!, null)).toThrow();
});
it('renewal while a nudge is being delivered cancels escalation and does not reset its cap', async () => {
  const { claim } = await start();
  onMessage = () => {
    e.renew(claim.id, claim.token!);
  };
  await tick(3000);
  expect(messageCount).toBe(1);
  await tick(10000);
  expect(stopCount).toBe(0);
  expect(e.store.work()[0]).toMatchObject({
    idleRecoveryCount: 1,
    status: 'claimed',
  });
});
it('requires explicit reconciliation after an unconfirmed stop and preserves uncertain resources', async () => {
  const { claim } = await start();
  await tick(3000);
  await tick(3000);
  expect(stopCount).toBe(1);
  expect(launchCount).toBe(1);
  expect(e.store.work()[0].status).toBe('held');
  expect(() => e.renew(claim.id, claim.token!)).toThrow();
});
it('does not restart completed or paused work after a nudge', async () => {
  const { r, claim } = await start();
  onMessage = () => {
    e.submit(claim.id, claim.token!, null);
  };
  await tick(3000);
  await tick(6000);
  expect(messageCount).toBe(1);
  expect(stopCount).toBe(0);
  expect(e.run(r.id).status).toBe('completed');
  expect(launchCount).toBe(1);
});
it('freezes escalation while paused and rechecks progress after asynchronous stop', async () => {
  const { r, claim } = await start();
  await tick(3000);
  const p = e.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'pause',
  });
  await tick(10000);
  expect(stopCount).toBe(0);
  e.pauses.resume(p.id);
  onStop = () => {
    status = 'ended';
    e.renew(claim.id, claim.token!);
  };
  await tick(3000);
  expect(stopCount).toBe(1);
  expect(launchCount).toBe(1);
  expect(e.store.work()[0].status).toBe('claimed');
  expect(e.run(r.id).status).toBe('waiting');
});

it('preserves pending recovery allowance and requires reconciliation after a real database reopen', async () => {
  const { claim } = await start();
  await tick(3000);
  expect(messageCount).toBe(1);
  await e.executors.stop();
  e.stop();
  e.store.close();
  e = new Engine(new Store(join(tempDir, 'db')), process.cwd());
  e.executors.start([
    {
      id: 'custom',
      detect: async () => ({ status: 'detected', command: 'fake' }),
      run: async () => ({ output: null }),
    },
  ]);
  await settle();
  await tick(10000);
  expect(e.store.work()[0]).toMatchObject({
    status: 'held',
    attempt: 1,
    idleRecoveryCount: 1,
  });
  expect(e.runAttention()[0].reasons).toContain('recovery');
  expect(messageCount).toBe(1);
  expect(stopCount).toBe(0);
  expect(launchCount).toBe(1);
  expect(() => e.renew(claim.id, claim.token!)).toThrow();
});

it('does not consume a launch ticket when resource admission rolls back the claim', async () => {
  const { claim } = await start();
  e.submit(claim.id, claim.token!, null);
  const d = blankDefinition();
  Object.assign(
    d.nodes.find((n) => n.kind === 'agent')!,
    { resources: [{ source: 'literal', value: 'rollback-resource' }] },
  );
  const wf = e.create('Resource owner', '', definitionSchema.parse(d));
  e.publish(wf.id);
  const rr = e.start(wf.id, null).run;
  const owner = e.claim(e.available(rr.id)[0].id, worker);
  e.submit(owner.id, owner.token!, null);
  const other = blankDefinition();
  Object.assign(
    other.nodes.find((n) => n.kind === 'agent')!,
    {
      executor: 'launcher',
      resources: [{ source: 'literal', value: 'rollback-resource' }],
    },
  );
  const ww = e.create('Ticket resource', '', definitionSchema.parse(other));
  e.publish(ww.id);
  const run = e.start(ww.id, null).run;
  await settle();
  const work = e.available(run.id)[0];
  const capturedTicket = ticket;
  const rr2 = e.start(wf.id, null).run;
  const owner2 = e.claim(e.available(rr2.id)[0].id, worker);
  expect(() =>
    e.claim(work.id, { ...worker, claimTicket: capturedTicket }),
  ).toThrow(/resource/i);
  e.submit(owner2.id, owner2.token!, null);
  const launched = e.claim(work.id, { ...worker, claimTicket: capturedTicket });
  expect(launched.attempt).toBe(1);
});

it('ignores a stale status poll after confirmed recovery launches a new session', async () => {
  const { claim } = await start();
  await tick(3000);
  let resolveOld: (value: Response) => void = () => {};
  onStatus = () => {
    onStatus = undefined;
    return new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
  };
  onStop = () => {
    status = 'ended';
  };
  await tick(3000);
  expect(launchCount).toBe(2);
  const current = e.claim(claim.id, { ...worker, claimTicket: ticket });
  expect(current.attempt).toBe(2);
  resolveOld(Response.json({ status: 'ended' }));
  await settle();
  expect(e.executors.inspect(claim.id).items[0].state).toBe('running');
  expect(e.store.work()[0].status).toBe('claimed');
});
