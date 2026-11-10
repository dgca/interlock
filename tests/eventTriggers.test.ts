import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  eventConfigSchema,
  nodeSchema,
  type EventConfig,
  type EventDelivery,
  type EventTrigger,
  type Json,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const engines: Engine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  vi.useRealTimers();
});
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
function publish(
  engine: Engine,
  definition = blankDefinition(),
  ownerWorkflowId?: string,
) {
  const w = engine.create('Event test', '', definition, ownerWorkflowId);
  engine.publish(w.id);
  return w.id;
}
function immediate() {
  const d = blankDefinition();
  d.nodes = d.nodes.filter((n) => n.kind !== 'agent');
  d.edges = [
    { id: 'entry-exit', source: 'entry', target: 'exit', port: 'default' },
  ];
  return d;
}
function config(sourceId?: string, changes: Partial<EventConfig> = {}) {
  return eventConfigSchema.parse({
    kind: 'event',
    name: 'Event handler',
    events: ['completed'],
    scope: sourceId
      ? { type: 'workflow', workflowId: sourceId }
      : { type: 'library' },
    ...changes,
  });
}
function trigger(engine: Engine, target: string, c: EventConfig) {
  const t = engine.triggers.mutate({
    action: 'create',
    workflowId: target,
    config: c,
  }).trigger!;
  expect(t.enabled).toBe(false);
  return engine.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: t.revision,
  }).trigger as EventTrigger;
}
function complete(engine: Engine, runId: string, output: Json = {}) {
  const w = engine.store.work('available', runId)[0];
  if (!w) throw new Error('No available work');
  const claim = engine.claim(w.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(w.id, claim.token!, output);
  engine.pump();
}
function deliveries(engine: Engine, t: EventTrigger) {
  return engine.store.eventDeliveries(t.id).items;
}
function start(engine: Engine, id: string, input: Json = {}) {
  const r = engine.start(id, input);
  engine.pump();
  return r.run;
}

it.each(['update', 'force import'])(
  'removes omitted event filters during full configuration replacement by %s',
  (operation) => {
    const e = setup(),
      definition = blankDefinition();
    Object.assign(
      definition.nodes.find((node) => node.kind === 'agent')!,
      {
        maxAttempts: 1,
      },
    );
    const source = publish(e, definition),
      target = publish(e),
      t = trigger(
        e,
        target,
        config(source, {
          exitNodeId: 'exit',
          action: { type: 'workflow' },
          tags: { purpose: 'old' },
        }),
      );
    const previous = {
      ...t,
      consecutiveFailures: 2,
      lastFireAt: '2026-01-01T00:00:00Z',
      previousRunId: 'previous-handler',
    };
    e.store.put('workflowTriggers', previous);
    const replacement = config(undefined, { events: ['failed'] });
    if (operation === 'update') {
      e.triggers.mutate({
        action: 'update',
        id: t.id,
        expectedRevision: t.revision,
        config: replacement,
      });
    } else {
      const bundle = exportWorkflows(e.store, target);
      bundle.workflows.find(
        (workflow) => workflow.id === target,
      )!.eventTriggers![0].config = replacement;
      importWorkflows(e.store, bundle, { force: true });
    }
    const saved = e.store.get<EventTrigger>('workflowTriggers', t.id)!;
    expect(saved).not.toHaveProperty('exitNodeId');
    expect(saved).not.toHaveProperty('action');
    expect(saved).not.toHaveProperty('tags');
    expect(saved).toMatchObject({
      id: t.id,
      workflowId: target,
      createdAt: t.createdAt,
      revision: t.revision + 1,
      enabled: operation === 'update',
      consecutiveFailures: operation === 'update' ? 2 : 0,
      events: ['failed'],
      scope: { type: 'library' },
    });
    if (operation === 'update') {
      expect(saved.lastFireAt).toBe(previous.lastFireAt);
      expect(saved.previousRunId).toBe(previous.previousRunId);
    } else {
      expect(saved.lastFireAt).toBeUndefined();
      expect(saved.previousRunId).toBeUndefined();
      e.triggers.mutate({
        action: 'enable',
        id: saved.id,
        expectedRevision: saved.revision,
      });
    }
    expect(() => exportWorkflows(e.store, target)).not.toThrow();
    const run = start(e, source);
    const work = e.store.work('available', run.id)[0];
    const claim = e.claim(work.id, {
      workerId: 'event-replacement-test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    e.reportFailure(work.id, claim.token!, 'Source failed');
    e.pump();
    expect(e.run(run.id).status).toBe('failed');
    const [delivery] = deliveries(e, saved);
    expect(delivery).toMatchObject({
      sourceRunId: run.id,
      outcome: 'started',
    });
    expect(e.run(delivery.runId!).input).toMatchObject({
      type: 'failed',
      runId: run.id,
    });
  },
);

it('delivers a compact completed payload once, with published version, task and causal identity', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source, { exitNodeId: 'exit' }));
  const run = e.start(
    source,
    { private: 'must not copy' },
    undefined,
    undefined,
    { externalTask: { system: 'github', id: 'repo#241', title: 'Lifecycle' } },
  ).run;
  complete(e, run.id, { privateOutput: 'must not copy' });
  const [d] = deliveries(e, t);
  expect(d.outcome).toBe('started');
  const handler = e.run(d.runId!);
  expect(handler.input).toMatchObject({
    type: 'completed',
    runId: run.id,
    workflowId: source,
    version: 1,
    externalTask: { id: 'repo#241' },
  });
  expect(handler.triggerChain).toEqual([t.id]);
  expect(handler.input).not.toHaveProperty('input');
  expect(JSON.stringify(handler.input)).not.toContain('must not copy');
  expect(e.triggers.inspect(t.id).deliveries.items[0]).not.toHaveProperty(
    'payload',
  );
  const event = e.store
    .events(run.id)
    .find((event) => event.type === 'run.completed')!;
  e.triggers.events.capture(e.run(run.id), event);
  e.pump();
  expect(deliveries(e, t)).toHaveLength(1);
  expect(e.store.list('eventTriggerReceipts')).toHaveLength(1);
});

it('filters workflow and exit scope, observes future events only and rejects missing sources', () => {
  const e = setup(),
    source = publish(e),
    other = publish(e),
    target = publish(e);
  const prior = start(e, source);
  complete(e, prior.id);
  const t = trigger(e, target, config(source));
  e.pump();
  expect(deliveries(e, t)).toHaveLength(0);
  const unrelated = start(e, other);
  complete(e, unrelated.id);
  expect(deliveries(e, t)).toHaveLength(0);
  expect(() => trigger(e, target, config('missing'))).toThrow(
    /source workflow/,
  );
  expect(() =>
    trigger(e, target, config(source, { exitNodeId: 'missing' })),
  ).toThrow(/Exit node/);
  const filtered = trigger(e, target, config(source, { exitNodeId: 'exit' }));
  const run = start(e, source);
  complete(e, run.id);
  expect(deliveries(e, filtered)).toHaveLength(1);
});

it('matches owned children only when requested and library scope across workflows', () => {
  const e = setup(),
    source = publish(e),
    child = publish(e, blankDefinition(), source),
    target = publish(e);
  const exact = trigger(e, target, config(source));
  const owned = trigger(
    e,
    target,
    config(source, {
      scope: { type: 'workflow', workflowId: source, includeChildren: true },
    }),
  );
  const library = trigger(e, target, config());
  const r = start(e, child);
  complete(e, r.id);
  expect(deliveries(e, exact)).toHaveLength(0);
  expect(deliveries(e, owned)).toHaveLength(1);
  expect(deliveries(e, library)).toHaveLength(1);
});

it('captures failed nodes with bounded errors and cancellation transitions', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source, { events: ['failed', 'cancelled'] }));
  const r = start(e, source);
  const w = e.store.work('available', r.id)[0];
  const c = e.claim(w.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  // Consume the configured failure allowance through the actual claim API.
  e.reportFailure(w.id, c.token!, 'failure '.repeat(1000));
  if (e.run(r.id).status !== 'failed') {
    const retry = e.claim(w.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    e.reportFailure(w.id, retry.token!, 'failure '.repeat(1000));
  }
  e.pump();
  const failed = deliveries(e, t).find(
    (d) => (e.run(d.runId!).input as any).type === 'failed',
  )!;
  expect(e.run(failed.runId!).input).toMatchObject({
    failingNode: { id: 'agent' },
  });
  expect((e.run(failed.runId!).input as any).error.length).toBeLessThanOrEqual(
    1000,
  );
  const cancelled = start(e, source);
  e.cancel(cancelled.id);
  expect(
    deliveries(e, t).some(
      (d) => (e.run(d.runId!).input as any).type === 'cancelled',
    ),
  ).toBe(true);
});

it('captures stalled and needs_attention transitions without repeating the attention state on every pump', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-07T00:00:00Z');
  const e = setup(),
    definition = blankDefinition();
  Object.assign(
    definition.nodes.find((n) => n.kind === 'agent')!,
    { unclaimedStallMs: 1000 },
  );
  const source = publish(e, definition),
    target = publish(e),
    t = trigger(
      e,
      target,
      config(source, { events: ['stalled', 'needs_attention'] }),
    );
  const r = start(e, source);
  vi.setSystemTime(Date.now() + 1001);
  e.pump();
  e.pump();
  e.pump();
  expect(deliveries(e, t)).toHaveLength(2);
  expect(
    deliveries(e, t)
      .map((d) => (e.run(d.runId!).input as any).type)
      .sort(),
  ).toEqual(['needs_attention', 'stalled']);
  complete(e, r.id);
  e.pump();
  expect(deliveries(e, t)).toHaveLength(2);
});

it('suppresses a trigger already in a persisted causal chain and honors the default depth of two', () => {
  const e = setup(),
    a = publish(e),
    b = publish(e),
    c = publish(e),
    d = publish(e);
  const ab = trigger(e, b, config(a));
  const ba = trigger(e, a, config(b));
  const bc = trigger(e, c, config(b));
  const cd = trigger(e, d, config(c));
  const root = start(e, a);
  complete(e, root.id);
  const first = deliveries(e, ab)[0];
  complete(e, first.runId!);
  const loop = deliveries(e, ba)[0];
  expect(e.run(loop.runId!).triggerChain).toEqual([ab.id, ba.id]);
  complete(e, loop.runId!);
  expect(
    deliveries(e, ab).some((x) => x.reason === 'trigger_already_in_chain'),
  ).toBe(true);
  complete(e, deliveries(e, bc)[0].runId!);
  expect(deliveries(e, cd)[0]).toMatchObject({
    outcome: 'suppressed',
    reason: 'max_trigger_depth',
  });
  expect(e.store.runs().filter((r) => r.workflowId === d)).toHaveLength(0);
});

it('defers terminal teardown for active detached descendants and inherited trigger chains', () => {
  const e = setup(),
    child = publish(e),
    parent = immediate();
  parent.nodes.splice(
    1,
    0,
    nodeSchema.parse({
      id: 'dispatch',
      kind: 'workflow',
      label: 'Detached',
      workflowId: child,
      version: 1,
      mode: 'detached',
    }),
  );
  parent.edges = [
    { id: 'a', source: 'entry', target: 'dispatch', port: 'default' },
    { id: 'b', source: 'dispatch', target: 'exit', port: 'default' },
  ];
  const source = publish(e, parent),
    target = publish(e),
    t = trigger(e, target, config(source, { waitForQuiescence: true }));
  const r = start(e, source);
  expect(e.run(r.id).status).toBe('completed');
  expect(deliveries(e, t)[0]).toMatchObject({ outcome: 'pending_quiescence' });
  const descendant = e.store.runs().find((run) => run.parentRunId === r.id)!;
  expect(descendant.parentMode).toBe('detached');
  complete(e, descendant.id);
  e.pump();
  expect(deliveries(e, t)[0].outcome).toBe('started');
  // Causal identity is also inherited by independently dispatched work.
  const hand = e.run(deliveries(e, t)[0].runId!);
  expect(hand.triggerChain).toEqual([t.id]);
});

it('retains revoked claims without resource names until exact stop confirmation', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(
      e,
      target,
      config(source, { events: ['cancelled'], waitForQuiescence: true }),
    );
  const r = start(e, source),
    work = e.store.work('available', r.id)[0];
  e.claim(work.id, {
    workerId: 'external',
    freshContext: false,
    tools: [],
    skills: [],
  });
  expect(() =>
    e.manageWorkResources({
      action: 'release',
      workId: work.id,
      expectedAttempt: 1,
      confirmStopped: true,
      actor: 'test',
    }),
  ).toThrow(/active claim/);
  e.cancel(r.id);
  expect(deliveries(e, t)[0].outcome).toBe('pending_quiescence');
  expect(
    e.continuation.briefing({ id: r.id, limit: 20 }).uncertainClaims?.total,
  ).toBe(1);
  expect(e.quiescence(r.id).quiescent).toBe(false);
  e.manageWorkResources({
    action: 'release',
    workId: work.id,
    expectedAttempt: 2,
    confirmStopped: true,
    actor: 'wrong attempt',
  });
  expect(deliveries(e, t)[0].outcome).toBe('pending_quiescence');
  e.manageWorkResources({
    action: 'release',
    workId: work.id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'test stopped original',
  });
  expect(deliveries(e, t)[0].outcome).toBe('started');
});

it('queues delivery behind target pauses and uses ordinary admission when resumed', () => {
  const e = setup(),
    source = publish(e),
    targetDef = blankDefinition();
  targetDef.maxActiveRuns = 1;
  const target = publish(e, targetDef);
  start(e, target);
  const t = trigger(e, target, config(source)),
    hold = e.pauses.create({
      target: { scope: 'workflow', workflowId: target },
      actor: 'test',
      reason: 'maintenance',
    });
  const r = start(e, source);
  complete(e, r.id);
  expect(deliveries(e, t)[0].outcome).toBe('pending_pause');
  e.pauses.resume(hold.id);
  e.pump();
  expect(deliveries(e, t)[0].outcome).toBe('queued');
  expect(e.run(deliveries(e, t)[0].runId!).status).toBe('queued');
});

it('auto-pauses failed starts, retains pending events, and retries future delivery after explicit enable', () => {
  const e = setup(),
    source = publish(e),
    invalid = blankDefinition();
  invalid.inputSchema = { type: 'string' };
  const target = publish(e, invalid),
    t = trigger(
      e,
      target,
      config(source, { pauseAfterConsecutiveFailures: 1 }),
    );
  const r = start(e, source);
  complete(e, r.id);
  expect(deliveries(e, t)[0]).toMatchObject({
    outcome: 'failed',
    settled: true,
  });
  expect(e.triggers.inspect(t.id).trigger.autoPaused).toBeDefined();
  const next = start(e, source);
  complete(e, next.id);
  expect(deliveries(e, t).some((d) => d.outcome === 'pending_pause')).toBe(
    true,
  );
  const current = e.triggers.inspect(t.id).trigger;
  e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: current.revision,
  });
  e.pump();
  expect(deliveries(e, t).filter((d) => d.outcome === 'failed')).toHaveLength(
    2,
  );
});

it('settles failed handler runs into the shared automatic failure pause', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(
      e,
      target,
      config(source, { pauseAfterConsecutiveFailures: 1 }),
    );
  const r = start(e, source);
  complete(e, r.id);
  const handler = deliveries(e, t)[0].runId!;
  for (let i = 0; i < 2; i++) {
    const w = e.store.work('available', handler)[0];
    const c = e.claim(w.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    e.reportFailure(w.id, c.token!, 'handler failed ' + 'x'.repeat(1500));
  }
  e.pump();
  expect(e.triggers.inspect(t.id).trigger).toMatchObject({
    consecutiveFailures: 1,
    autoPaused: { reason: expect.stringContaining('handler failed') },
  });
  expect(deliveries(e, t)[0]).toMatchObject({
    settled: true,
    runStatus: 'failed',
    error: ('handler failed ' + 'x'.repeat(1500)).slice(0, 1000),
  });
  expect(e.triggers.inspect(t.id).deliveries.items[0]).toMatchObject({
    error: ('handler failed ' + 'x'.repeat(1500)).slice(0, 1000),
  });
});

it('suppresses pending work on disable and never replays transitions observed while disabled', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source));
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: target },
    actor: 'test',
    reason: 'hold',
  });
  const first = start(e, source);
  complete(e, first.id);
  const disabled = e.triggers.mutate({
    action: 'disable',
    id: t.id,
    expectedRevision: t.revision,
  }).trigger!;
  e.pump();
  expect(deliveries(e, t)[0]).toMatchObject({
    outcome: 'suppressed',
    reason: 'trigger_disabled',
  });
  const ignored = start(e, source);
  complete(e, ignored.id);
  expect(deliveries(e, t)).toHaveLength(1);
  e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: disabled.revision,
  });
  e.pauses.resume(hold.id);
  e.pump();
  expect(e.store.runs().filter((r) => r.workflowId === target)).toHaveLength(0);
});

it('persists pending delivery and causal identity across engine restart without another handler', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source));
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: target },
    actor: 'test',
    reason: 'restart',
  });
  const first = start(e, source);
  complete(e, first.id);
  const original = deliveries(e, t)[0];
  e.stop();
  const restarted = new Engine(e.store, process.cwd());
  engines.splice(engines.indexOf(e), 1, restarted);
  restarted.pauses.resume(hold.id);
  restarted.pump();
  restarted.pump();
  expect(deliveries(restarted, t)).toHaveLength(1);
  expect(deliveries(restarted, t)[0].id).toBe(original.id);
  expect(
    restarted.store.runs().filter((r) => r.workflowId === target),
  ).toHaveLength(1);
  expect(
    restarted.run(deliveries(restarted, t)[0].runId!).triggerChain,
  ).toEqual([t.id]);
});

it('rolls event start and receipt state back together when delivery persistence fails', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source));
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: target },
    actor: 'test',
    reason: 'fault control',
  });
  const r = start(e, source);
  complete(e, r.id);
  e.pauses.resume(hold.id);
  const before = {
    runs: e.store.runs(),
    deliveries: e.store.list('eventDeliveries'),
    receipts: e.store.list('runStarts'),
    triggers: e.store.workflowTriggers(),
  };
  const put = e.store.put.bind(e.store);
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'eventDeliveries' && (value as EventDelivery).runId)
        throw new Error('injected delivery write');
      return put(collection, value);
    });
  expect(() => e.pump()).toThrow('injected delivery write');
  spy.mockRestore();
  expect({
    runs: e.store.runs(),
    deliveries: e.store.list('eventDeliveries'),
    receipts: e.store.list('runStarts'),
    triggers: e.store.workflowTriggers(),
  }).toEqual(before);
  e.pump();
  expect(deliveries(e, t)[0].outcome).toBe('started');
  expect(e.store.runs().filter((r) => r.workflowId === target)).toHaveLength(1);
});

it('preserves dedupe after the visible settled delivery is pruned', () => {
  const e = setup(),
    source = publish(e),
    target = publish(e),
    t = trigger(e, target, config(source));
  const r = start(e, source);
  complete(e, r.id);
  const d = deliveries(e, t)[0];
  complete(e, d.runId!);
  e.pump();
  e.store.trimEventDeliveries(t.id, 0);
  expect(deliveries(e, t)).toHaveLength(0);
  e.triggers.events.capture(
    e.run(r.id),
    e.store.events(r.id).find((x) => x.type === 'run.completed')!,
  );
  e.pump();
  expect(deliveries(e, t)).toHaveLength(0);
  expect(
    e.store.runs().filter((run) => run.workflowId === target),
  ).toHaveLength(1);
});

it('keeps quiescence pending after lease expiry until the revoked attempt is confirmed stopped', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-07T00:00:00Z');
  const e = setup(),
    definition = blankDefinition();
  Object.assign(
    definition.nodes.find((n) => n.kind === 'agent')!,
    { maxAttempts: 1 },
  );
  const source = publish(e, definition),
    target = publish(e),
    t = trigger(
      e,
      target,
      config(source, { events: ['failed'], waitForQuiescence: true }),
    ),
    r = start(e, source),
    w = e.store.work('available', r.id)[0];
  e.claim(
    w.id,
    { workerId: 'external', freshContext: false, tools: [], skills: [] },
    10,
  );
  vi.setSystemTime(Date.now() + 10001);
  e.pump();
  expect(e.run(r.id).status).toBe('failed');
  expect(deliveries(e, t)[0].outcome).toBe('pending_quiescence');
  e.manageWorkResources({
    action: 'release',
    workId: w.id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'test',
  });
  expect(deliveries(e, t)[0].outcome).toBe('started');
});

it('captures publish-pinned prompts in event-started handlers while retaining causal identity', () => {
  const e = setup(),
    source = publish(e);
  const prompt = e.prompts.create({
    name: 'Pinned handler',
    description: '',
    content: 'Pinned handler guidance',
  });
  const definition = blankDefinition();
  definition.pinPromptsAtPublish = true;
  Object.assign(
    definition.nodes.find((node) => node.kind === 'agent')!,
    { promptIds: [prompt.id] },
  );
  const target = publish(e, definition),
    t = trigger(e, target, config(source));
  e.prompts.update(prompt.id, prompt.revision, {
    ...prompt,
    content: 'Latest unpinned guidance',
  });
  const root = start(e, source);
  complete(e, root.id);
  const handler = e.run(deliveries(e, t)[0].runId!);
  expect(handler.promptSnapshots).toEqual([
    expect.objectContaining({
      id: prompt.id,
      revision: prompt.revision,
      content: 'Pinned handler guidance',
    }),
  ]);
  expect(handler.triggerChain).toEqual([t.id]);
  expect(e.available(handler.id)[0].prompt).toContain(
    'Pinned handler guidance',
  );
  expect(e.available(handler.id)[0].prompt).not.toContain(
    'Latest unpinned guidance',
  );
});
