import assert from 'node:assert/strict';
import { Engine } from '../../packages/runtime/src/index.ts';
import { Store } from '../../packages/storage/src/index.ts';
import { blankDefinition } from '../../packages/core/src/index.ts';
const RealDate = Date;
const epoch = RealDate.parse('2026-11-07T12:00:00Z');
let time = epoch,
  ticket,
  messages = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [time]));
  }
  static now() {
    return time;
  }
};
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/launch')) {
    ticket = JSON.parse(options.body).claimTicket;
    return Response.json({ sessionId: 'fixture-session' });
  }
  if (String(url).endsWith('/message')) {
    messages++;
    time = epoch + 5000;
    return new Response('', { status: 500 });
  }
  return Response.json({ status: 'idle' });
};
const e = new Engine(new Store(':memory:'), process.cwd());
try {
  e.executors.saveProfile({
    id: 'fixture',
    name: 'Fixture',
    harness: 'custom',
    mode: 'launcher',
    transport: 'http',
    enabled: true,
    expectedRevision: 0,
    launchUrl: 'http://fixture/launch',
    messageUrl: 'http://fixture/message',
    stopUrl: 'http://fixture/stop',
    statusUrl: 'http://fixture/status',
  });
  e.executors.start([
    {
      id: 'custom',
      detect: async () => ({ status: 'detected', command: 'fake' }),
      run: async () => ({ output: null }),
    },
  ]);
  const d = blankDefinition();
  Object.assign(d.nodes[1], {
    executor: 'fixture',
    claimedIdleStallMs: 3000,
    idleRecovery: { maxRecoveries: 1, message: 'Continue' },
    maxExecutionMs: 5000,
    maxAttempts: 2,
  });
  const w = e.create('Deadline delivery race', '', d);
  e.publish(w.id);
  const run = e.start(w.id, null).run;
  for (let n = 0; n < 300; n++) await Promise.resolve();
  const work = e.claim(e.available(run.id)[0].id, {
    workerId: 'fixture',
    claimTicket: ticket,
  });
  time = epoch + 3000;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(messages, 1);
  assert.equal(e.executors.inspect(work.id).items[0].state, 'interrupted');
  assert.ok(e.runAttention()[0].reasons.includes('recovery'));
  console.log('Deadline delivery race survived with recovery attention');
} finally {
  await e.executors.stop();
  e.stop();
  e.store.close();
}
