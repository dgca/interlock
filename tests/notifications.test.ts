import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  type DesktopNotification,
} from '@interlock/core';

const engines: Engine[] = [];
const epoch = Date.parse('2026-11-07T12:00:00Z');
const at = (ms: number) => vi.setSystemTime(epoch + ms);

beforeEach(() => {
  vi.useFakeTimers();
  at(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  delete process.env.INTERLOCK_DESKTOP_NOTIFICATIONS;
  vi.useRealTimers();
});

function createStallWorkflow(engine: Engine, name = 'Stall WF') {
  const d = blankDefinition();
  Object.assign(
    d.nodes.find((n) => n.kind === 'agent')!,
    {
      unclaimedStallMs: 100,
    },
  );
  const w = engine.create(name, '', definitionSchema.parse(d));
  engine.publish(w.id);
  return w;
}

it('does not send desktop notifications when disabled by default', () => {
  const notifications: DesktopNotification[] = [];
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    desktopNotifier: (n) => notifications.push(n),
  });
  engines.push(engine);

  const w = createStallWorkflow(engine);
  const run = engine.start(w.id, null).run;
  at(100);
  engine.pump();

  expect(engine.runAttention()).toMatchObject([
    { runId: run.id, reasons: ['stalled'] },
  ]);
  expect(notifications).toHaveLength(0);
});

it('sends a desktop notification when a run enters Needs attention if enabled', () => {
  const notifications: DesktopNotification[] = [];
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    desktopNotifications: true,
    desktopNotifier: (n) => notifications.push(n),
  });
  engines.push(engine);

  const w = createStallWorkflow(engine, 'Stalled Run WF');
  const run = engine.start(w.id, null).run;
  at(100);
  engine.pump();

  expect(notifications).toHaveLength(1);
  const notification = notifications[0];
  expect(notification.runId).toBe(run.id);
  expect(notification.workflowId).toBe(w.id);
  expect(notification.workflowName).toBe('Stalled Run WF');
  expect(notification.title).toBe('Interlock: Needs attention');
  expect(notification.reasons).toEqual(['stalled']);
  expect(notification.message).toContain(run.id.slice(0, 8));
  expect(notification.message).toContain('Stalled Run WF');
});

it('enables desktop notifications via INTERLOCK_DESKTOP_NOTIFICATIONS env var', () => {
  process.env.INTERLOCK_DESKTOP_NOTIFICATIONS = '1';
  const notifications: DesktopNotification[] = [];
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    desktopNotifier: (n) => notifications.push(n),
  });
  engines.push(engine);

  const w = createStallWorkflow(engine);
  engine.start(w.id, null);
  at(100);
  engine.pump();

  expect(notifications).toHaveLength(1);
});

it('does not emit duplicate notifications on repeated pump ticks while attention persists', () => {
  const notifications: DesktopNotification[] = [];
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    desktopNotifications: true,
    desktopNotifier: (n) => notifications.push(n),
  });
  engines.push(engine);

  const w = createStallWorkflow(engine);
  engine.start(w.id, null);
  at(100);
  engine.pump();
  expect(notifications).toHaveLength(1);

  // Subsequent pumps while state remains in Needs attention
  at(150);
  engine.pump();
  at(200);
  engine.pump();
  expect(notifications).toHaveLength(1);
});

it('re-notifies if attention is resolved and then re-enters', () => {
  const notifications: DesktopNotification[] = [];
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    desktopNotifications: true,
    desktopNotifier: (n) => notifications.push(n),
  });
  engines.push(engine);

  const w = createStallWorkflow(engine);
  const run = engine.start(w.id, null).run;
  const work = engine.available(run.id)[0];
  at(100);
  engine.pump();
  expect(notifications).toHaveLength(1);

  // Claim work: clears unclaimed stall attention
  const claim = engine.claim(work.id, {
    workerId: 'worker-1',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.pump();
  expect(engine.runAttention()).toEqual([]);

  // Another run entering attention triggers another notification
  const run2 = engine.start(w.id, null).run;
  at(200);
  engine.pump();
  expect(notifications).toHaveLength(2);
  expect(notifications[1].runId).toBe(run2.id);
});
