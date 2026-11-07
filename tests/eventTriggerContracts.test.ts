import { expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  eventConfigSchema,
  scheduleReadSchema,
  triggerConfig,
  triggerConfigSchema,
  type EventDelivery,
  type EventTrigger,
  type Run,
} from '@interlock/core';
import { workflowBundleSchema } from '../packages/core/src/transfer';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { importSelection } from '../packages/runtime/src/importSelection';

const config = () =>
  eventConfigSchema.parse({
    kind: 'event',
    name: 'Cleanup',
    events: ['completed'],
    scope: { type: 'library' },
  });
const eventTrigger = (
  workflowId: string,
  extra: Partial<EventTrigger> = {},
): EventTrigger => ({
  ...config(),
  id: 'event-trigger',
  workflowId,
  revision: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  consecutiveFailures: 3,
  ...extra,
});

it('validates event selections and terminal-only controls through the shared union', () => {
  expect(config()).toMatchObject({
    maxTriggerDepth: 2,
    waitForQuiescence: false,
    pauseAfterConsecutiveFailures: null,
  });
  expect(triggerConfigSchema.parse(config())).toEqual(config());
  expect(
    scheduleReadSchema.parse({ action: 'list', kind: 'event' }),
  ).toMatchObject({ kind: 'event' });
  expect(
    eventConfigSchema.parse({
      ...config(),
      scope: { type: 'workflow', workflowId: 'source' },
    }).scope,
  ).toEqual({ type: 'workflow', workflowId: 'source', includeChildren: false });
  expect(
    eventConfigSchema.parse({
      ...config(),
      events: ['failed', 'cancelled'],
      waitForQuiescence: true,
    }),
  ).toMatchObject({ waitForQuiescence: true });
  for (const invalid of [
    { events: [] },
    { events: ['completed', 'completed'] },
    { events: ['stalled'], waitForQuiescence: true },
    { events: ['needs_attention'], exitNodeId: 'exit' },
    { events: ['completed', 'failed'], exitNodeId: 'exit' },
    { maxTriggerDepth: 0 },
    { maxTriggerDepth: 21 },
    { scope: { type: 'workflow' } },
  ])
    expect(() =>
      eventConfigSchema.parse({ ...config(), ...invalid }),
    ).toThrow();
  expect(triggerConfig(eventTrigger('target'))).toEqual(config());
});

it('queries full descendants and only forward continuations without looping', () => {
  const store = new Store(':memory:');
  const run = (id: string, parentRunId?: string, nextRunId?: string) =>
    ({
      id,
      parentRunId,
      chain: nextRunId ? { nextRunId } : undefined,
      executions: [{ id: `${id}-execution` }],
    }) as Run;
  try {
    for (const value of [
      run('prior', undefined, 'source'),
      run('source', undefined, 'continued'),
      run('child', 'source'),
      run('detached', 'child', 'detached-next'),
      { ...run('detached-next'), parentMode: 'detached' as const },
      run('continued', undefined, 'source'),
      run('later-child', 'continued'),
      run('unrelated'),
    ])
      store.put('runs', value);
    const tree = store.sourceRunTree('source');
    expect(tree.map((r) => r.id).sort()).toEqual(
      [
        'source',
        'continued',
        'child',
        'detached',
        'detached-next',
        'later-child',
      ].sort(),
    );
    expect(tree.every((r) => r.executions.length === 1)).toBe(true);
    expect(store.sourceRunTree('missing')).toEqual([]);
  } finally {
    store.close();
  }
});

it('bounds settled logs without trimming pending deliveries or durable receipts', () => {
  const store = new Store(':memory:');
  const delivery = (id: string, settled: boolean): EventDelivery => ({
    id,
    eventId: id,
    triggerId: 'trigger',
    workflowId: 'target',
    sourceRunId: 'source',
    occurredAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    outcome: settled ? 'suppressed' : 'pending_quiescence',
    settled,
  });
  try {
    for (let i = 0; i < 205; i++) {
      store.put('eventDeliveries', delivery(`settled-${i}`, true));
      store.put('eventTriggerReceipts', {
        id: `receipt-${i}`,
        eventId: `settled-${i}`,
        triggerId: 'trigger',
      });
    }
    store.put('eventDeliveries', delivery('pending', false));
    store.trimEventDeliveries('trigger');
    expect(store.eventDeliveries('trigger').total).toBe(201);
    expect(store.eventDeliveries('trigger', 0, 20).nextOffset).toBe(20);
    expect(store.pendingEventDeliveries().map((d) => d.id)).toEqual([
      'pending',
    ]);
    expect(store.list('eventTriggerReceipts')).toHaveLength(205);
    store.deleteEventHistory('trigger');
    expect(store.eventDeliveries('trigger').total).toBe(0);
    expect(store.list('eventTriggerReceipts')).toHaveLength(205);
  } finally {
    store.close();
  }
});

it('exports source dependencies and imports disabled event configuration with reset history', () => {
  const source = new Store(':memory:'),
    target = new Store(':memory:');
  const engine = new Engine(source, process.cwd());
  try {
    const handler = engine.create('Handler'),
      observed = engine.create('Observed');
    engine.publish(handler.id);
    engine.publish(observed.id);
    const trigger = eventTrigger(handler.id, {
      scope: {
        type: 'workflow',
        workflowId: observed.id,
        includeChildren: true,
      },
      waitForQuiescence: true,
    });
    source.put('workflowTriggers', trigger);
    const bundle = JSON.parse(
      JSON.stringify(exportWorkflows(source, handler.id)),
    ) as ReturnType<typeof exportWorkflows>;
    expect(bundle.formatVersion).toBe(8);
    expect(bundle.workflows.map((w) => w.id)).toContain(observed.id);
    const portable = bundle.workflows.find((w) => w.id === handler.id)!
      .eventTriggers![0];
    expect(portable.enabled).toBe(false);
    expect(Object.keys(portable).sort()).toEqual(['config', 'enabled', 'id']);
    portable.enabled = true;
    importWorkflows(target, bundle);
    expect(
      target.get<EventTrigger>('workflowTriggers', trigger.id),
    ).toMatchObject({ enabled: false, consecutiveFailures: 0 });
    expect(
      triggerConfig(target.get<EventTrigger>('workflowTriggers', trigger.id)!),
    ).toEqual(triggerConfig(trigger));
    target.put('eventDeliveries', {
      id: 'old',
      triggerId: trigger.id,
      settled: false,
    });
    target.put('workflowTriggers', {
      ...target.get<EventTrigger>('workflowTriggers', trigger.id)!,
      enabled: true,
      autoPaused: { at: 'now', reason: 'old' },
      previousRunId: 'old',
      lastFireAt: 'old',
    });
    importWorkflows(target, bundle);
    expect(target.eventDeliveries(trigger.id).total).toBe(0);
    expect(
      target.get<EventTrigger>('workflowTriggers', trigger.id),
    ).toMatchObject({ enabled: false, consecutiveFailures: 0 });
    expect(
      target.get<EventTrigger>('workflowTriggers', trigger.id)?.previousRunId,
    ).toBeUndefined();
    expect(
      target.get<EventTrigger>('workflowTriggers', trigger.id)?.autoPaused,
    ).toBeUndefined();
    expect(() =>
      workflowBundleSchema.parse({ ...bundle, formatVersion: 7 }),
    ).toThrow('formatVersion 8');
    expect(() =>
      workflowBundleSchema.parse({
        ...bundle,
        workflows: bundle.workflows.filter((w) => w.id !== observed.id),
      }),
    ).toThrow('source workflow');
  } finally {
    engine.stop();
    source.close();
    target.close();
  }
});

it('preserves event triggers in selected-set imports and rejects conflicting configurations atomically', () => {
  const source = new Store(':memory:'),
    target = new Store(':memory:');
  const engine = new Engine(source, process.cwd()),
    local = new Engine(target, process.cwd());
  try {
    const handler = engine.create('Handler');
    engine.publish(handler.id);
    source.put('workflowTriggers', eventTrigger(handler.id));
    const bundle = exportWorkflows(source, handler.id);
    importSelection(local, [bundle, bundle]);
    expect(target.workflowTriggers(handler.id)).toHaveLength(1);
    expect(target.workflowTriggers(handler.id)[0].kind).toBe('event');
    const conflicting = structuredClone(bundle);
    conflicting.workflows[0].eventTriggers![0].config.maxTriggerDepth = 3;
    const before = target.workflowTriggers(handler.id);
    expect(() => importSelection(local, [bundle, conflicting])).toThrow(
      'conflict for event trigger',
    );
    expect(target.workflowTriggers(handler.id)).toEqual(before);
  } finally {
    engine.stop();
    local.stop();
    source.close();
    target.close();
  }
});

it('rolls back imported workflow, trigger and history writes when trigger persistence fails', () => {
  const source = new Store(':memory:'),
    target = new Store(':memory:');
  const engine = new Engine(source, process.cwd());
  try {
    const handler = engine.create('Handler');
    engine.publish(handler.id);
    source.put('workflowTriggers', eventTrigger(handler.id));
    const bundle = exportWorkflows(source, handler.id);
    const before = target.workflows();
    const put = target.put.bind(target);
    const failure = vi
      .spyOn(target, 'put')
      .mockImplementation((collection, value) => {
        if (collection === 'workflowTriggers')
          throw new Error('injected trigger write failure');
        return put(collection, value);
      });
    expect(() => importWorkflows(target, bundle)).toThrow(
      'injected trigger write failure',
    );
    failure.mockRestore();
    expect(target.workflows()).toEqual(before);
    expect(target.getVersion(handler.id, 1)).toBeUndefined();
    expect(target.workflowTriggers()).toEqual([]);
    importWorkflows(target, bundle);
    expect(target.workflowTriggers()).toHaveLength(1);
  } finally {
    engine.stop();
    source.close();
    target.close();
  }
});
