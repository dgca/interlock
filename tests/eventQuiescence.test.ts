import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { Engine, type HarnessAdapter } from '@interlock/runtime';
import { Store, BackgroundFiles, type BackgroundJob } from '@interlock/storage';
import {
  blankDefinition,
  eventConfigSchema,
  nodeSchema,
  type EventTrigger,
  type Json,
} from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { batchDefinition, itemAgent } from './fixtures/batch';

const engines: Engine[] = [],
  roots: string[] = [],
  releaseJobs: (() => void)[] = [];
const servers: Server[] = [];
const worker = {
  workerId: 'external-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(fileBacked = false) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-event-quiescence-'));
  roots.push(root);
  const engine = new Engine(
    new Store(fileBacked ? join(root, 'db.sqlite') : ':memory:', {
      secretKeyFile: join(root, 'key'),
    }),
    root,
  );
  engines.push(engine);
  return { engine, root };
}
function publish(e: Engine, definition = blankDefinition()) {
  const workflow = e.create('Quiescence test', '', definition);
  e.publish(workflow.id);
  return workflow.id;
}
function reaction(e: Engine, source: string, target = publish(e)) {
  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Safe teardown',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: source },
    waitForQuiescence: true,
  });
  const trigger = e.triggers.mutate({
    action: 'create',
    workflowId: target,
    config,
  }).trigger!;
  return e.triggers.mutate({
    action: 'enable',
    id: trigger.id,
    expectedRevision: trigger.revision,
  }).trigger as EventTrigger;
}
function delivery(e: Engine, t: EventTrigger) {
  return e.store.eventDeliveries(t.id).items[0];
}
function complete(e: Engine, runId: string, output: Json = {}) {
  e.pump();
  const work = e.store.work('available', runId)[0];
  if (!work) throw new Error(`No available assignment for ${runId}`);
  const claim = e.claim(work.id, worker);
  e.submit(work.id, claim.token!, output);
  e.pump();
}
function background() {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Provisioned work',
    language: 'javascript',
    executionMode: 'background',
    timeoutMs: 10000,
    command:
      "require('node:fs').writeFileSync('started','once'); while (!require('node:fs').existsSync('release')) await new Promise(resolve=>setTimeout(resolve,25)); require('node:fs').writeFileSync('finished','once'); return {done:true};",
  });
  return definition;
}
function script(e: Engine, runId: string) {
  return e.run(runId).executions.findLast((x) => x.kind === 'script')!;
}
async function running(e: Engine, runId: string, root: string) {
  await vi.waitFor(
    () => {
      e.pump();
      expect(script(e, runId).background?.state).toBe('running');
      expect(existsSync(join(root, 'started'))).toBe(true);
    },
    { timeout: 5000, interval: 30 },
  );
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const release of releaseJobs.splice(0)) release();
  for (const e of engines.splice(0)) {
    for (const run of e.store.runs())
      for (const step of run.executions)
        if (
          step.background &&
          ['launching', 'running', 'uncertain'].includes(step.background.state)
        ) {
          try {
            e.manageScript({
              action: 'stop',
              runId: run.id,
              executionId: step.id,
            });
          } catch {}
        }
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('waits for a real detached background Script before delivering a terminal parent event', async () => {
  const { engine: e, root } = setup(true),
    child = publish(e, background()),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent);
  const source = e.start(parent, {}).run;
  const descendant = e.store.runs().find((r) => r.parentRunId === source.id)!;
  await running(e, descendant.id, root);
  expect(e.run(source.id).status).toBe('completed');
  expect(delivery(e, t)).toMatchObject({ outcome: 'pending_quiescence' });
  expect(e.quiescence(source.id).blockers.items.map((b) => b.kind)).toContain(
    'background_script',
  );
  expect(e.store.terminalBackgroundRuns()).toEqual([]);
  writeFileSync(join(root, 'release'), 'go');
  await vi.waitFor(
    () => {
      e.pump();
      expect(delivery(e, t).outcome).toBe('started');
    },
    { timeout: 5000, interval: 30 },
  );
  const step = script(e, descendant.id),
    job = e.store.get<BackgroundJob>('backgroundJobs', step.id)!;
  expect(new BackgroundFiles(e.store).read(job, 'result')?.outcome).toEqual({
    output: { done: true },
  });
  expect(readFileSync(join(root, 'finished'), 'utf8')).toBe('once');
  expect(e.quiescence(source.id).quiescent).toBe(true);
  expect(e.run(delivery(e, t).runId!).input).toMatchObject({
    runId: source.id,
    type: 'completed',
  });
  expect(e.store.terminalBackgroundRuns()).toEqual([]);
});

it('keeps cancelled Script teardown pending until its authenticated stop result is observed', async () => {
  const { engine: e, root } = setup(true),
    child = publish(e, background()),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent);
  const source = e.start(parent, {}).run,
    descendant = e.store.runs().find((r) => r.parentRunId === source.id)!;
  await running(e, descendant.id, root);
  const step = script(e, descendant.id),
    job = e.store.get<BackgroundJob>('backgroundJobs', step.id)!;
  e.cancel(descendant.id);
  expect(e.run(descendant.id).status).toBe('cancelled');
  expect(e.store.terminalBackgroundRuns().map((r) => r.id)).toEqual([
    descendant.id,
  ]);
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  expect(e.quiescence(source.id).quiescent).toBe(false);
  await vi.waitFor(
    () =>
      expect(
        new BackgroundFiles(e.store).read(job, 'result')?.outcome?.error,
      ).toBe('Script stopped'),
    { timeout: 5000, interval: 30 },
  );
  await vi.waitFor(() => {
    e.pump();
    expect(delivery(e, t).outcome).toBe('started');
    expect(e.quiescence(source.id).quiescent).toBe(true);
  });
  expect(e.store.terminalBackgroundRuns()).toEqual([]);
  expect(existsSync(join(root, 'finished'))).toBe(false);
  expect(e.run(descendant.id)).not.toHaveProperty('output');
});

it('rejects a tampered Script stop receipt and requires explicit stop reconciliation', async () => {
  const { engine: e, root } = setup(true),
    child = publish(e, background()),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent);
  const source = e.start(parent, {}).run,
    descendant = e.store.runs().find((r) => r.parentRunId === source.id)!;
  await running(e, descendant.id, root);
  const step = script(e, descendant.id),
    job = e.store.get<BackgroundJob>('backgroundJobs', step.id)!;
  e.cancel(descendant.id);
  const files = new BackgroundFiles(e.store);
  await vi.waitFor(
    () =>
      expect(files.read(job, 'result')?.outcome?.error).toBe('Script stopped'),
    { timeout: 5000, interval: 30 },
  );
  // The supervisor has stopped. Corrupt its final receipt before the engine observes it.
  writeFileSync(
    join(e.store.path + '.scripts', step.id, 'result'),
    'unauthenticated stop',
  );
  e.pump();
  expect(script(e, descendant.id).background?.state).toBe('uncertain');
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  expect(e.quiescence(source.id).blockers.items.map((b) => b.kind)).toContain(
    'background_script',
  );
  expect(() =>
    e.manageScript({
      action: 'reconcile',
      runId: descendant.id,
      executionId: step.id,
      stopped: false as true,
      reason: 'invalid attestation',
    }),
  ).toThrow();
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  e.manageScript({
    action: 'reconcile',
    runId: descendant.id,
    executionId: step.id,
    stopped: true,
    reason:
      'Authenticated stop result observed before corruption; no late effect exists',
  });
  e.pump();
  expect(script(e, descendant.id).background?.state).toBe('reconciled');
  expect(delivery(e, t).outcome).toBe('started');
  expect(existsSync(join(root, 'finished'))).toBe(false);
});

it('retains managed interruption until the actual adapter exits and stop is explicitly confirmed', async () => {
  const { engine: e } = setup();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: null });
  e.executors.saveProfile({
    id: 'codex',
    name: 'Test Codex',
    harness: 'codex',
    enabled: true,
    expectedRevision: 0,
  });
  let release!: () => void;
  const adapter: HarnessAdapter = {
    id: 'codex',
    detect: async () => ({ status: 'detected', command: '/fake/codex' }),
    run: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
        releaseJobs.push(resolve);
      });
      throw new Error('actual adapter stopped');
    },
  };
  e.executors.start([adapter]);
  const definition = blankDefinition();
  definition.executor = 'codex';
  const child = publish(e, definition),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent),
    source = e.start(parent, {}).run;
  const descendant = e.store.runs().find((r) => r.parentRunId === source.id)!;
  await vi.waitFor(() =>
    expect(
      e.store.work(undefined, descendant.id)[0]?.managedExecution?.state,
    ).toBe('running'),
  );
  const work = e.store.work(undefined, descendant.id)[0],
    record = e.executors.inspect(work.id).items[0];
  e.cancel(descendant.id);
  e.executors.stopExecution(record.id);
  expect(e.quiescence(source.id).blockers.items.map((b) => b.kind)).toContain(
    'managed_execution',
  );
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  expect(() => e.executors.confirmStopped(record.id, true)).toThrow(
    'still stopping',
  );
  release();
  await vi.waitFor(() =>
    expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
  );
  e.pump();
  expect(delivery(e, t).outcome).toBe('started');
  expect(e.quiescence(source.id).quiescent).toBe(true);
});

it('retains uncertain resource ownership in a detached tree until the exact attempt is released', () => {
  const { engine: e } = setup(),
    definition = blankDefinition();
  definition.nodes.find((n) => n.kind === 'agent')!.resources = [
    { source: 'literal', value: 'temporary-worktree' },
  ];
  const child = publish(e, definition),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent),
    source = e.start(parent, {}).run;
  const descendant = e.store.runs().find((r) => r.parentRunId === source.id)!,
    work = e.store.work('available', descendant.id)[0];
  e.claim(work.id, worker);
  e.cancel(descendant.id);
  const inspection = e.manageWorkResources({
    action: 'inspect',
    workId: work.id,
  });
  if (!('reservations' in inspection))
    throw new Error('Expected resource inspection');
  expect(inspection.reservations).toMatchObject([
    { state: 'uncertain', attempt: 1 },
  ]);
  expect(e.quiescence(source.id).blockers.items.map((b) => b.kind)).toEqual(
    expect.arrayContaining(['resource_reservation', 'uncertain_claim']),
  );
  e.manageWorkResources({
    action: 'release',
    workId: work.id,
    expectedAttempt: 2,
    confirmStopped: true,
    actor: 'wrong attempt',
  });
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  e.manageWorkResources({
    action: 'release',
    workId: work.id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'external worker and all worktree processes stopped',
  });
  expect(delivery(e, t).outcome).toBe('started');
  expect(e.quiescence(source.id).quiescent).toBe(true);
});

it('retains an interrupted unresourced Fetch until the remote operation is confirmed stopped', async () => {
  const { engine: e } = setup();
  let started = false,
    finished = false,
    release!: () => void;
  const remote = new Promise<void>((resolve) => {
    release = resolve;
    releaseJobs.push(resolve);
  });
  const server = createServer(async (request, response) => {
    if (request.url === '/control') {
      response.setHeader('content-type', 'application/json');
      response.end('{}');
      return;
    }
    started = true;
    await remote;
    finished = true;
    response.setHeader('content-type', 'application/json');
    response.end('{}');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected local server address');
  const base = `http://127.0.0.1:${address.port}`;
  const fetchDefinition = (path: string) => {
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'fetch',
      label: 'Remote side effect',
      url: base + path,
      timeoutMs: 5000,
    });
    return d;
  };
  const control = e.start(publish(e, fetchDefinition('/control')), {}).run;
  await vi.waitFor(() => {
    e.pump();
    expect(e.run(control.id).status).toBe('completed');
  });
  expect(e.quiescence(control.id).quiescent).toBe(true);
  const child = publish(e, fetchDefinition('/remote')),
    parent = publish(e, workflowCall(child, 'detached')),
    t = reaction(e, parent),
    source = e.start(parent, {}).run;
  const descendant = e.store.runs().find((r) => r.parentRunId === source.id)!;
  await vi.waitFor(() => expect(started).toBe(true));
  const execution = e
    .run(descendant.id)
    .executions.find((x) => x.kind === 'fetch')!;
  expect(execution.resources).toBeUndefined();
  e.cancel(descendant.id);
  await vi.waitFor(() =>
    expect(e.quiescence(source.id).blockers.items.map((b) => b.kind)).toContain(
      'uncertain_operation',
    ),
  );
  expect(finished).toBe(false);
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  const inspection = e.manageWorkResources({
    action: 'inspect',
    runId: descendant.id,
    executionId: execution.id,
  });
  expect(inspection).toMatchObject({
    reservations: [],
    uncertainOperations: [{ attempt: 1, executionId: execution.id }],
  });
  await vi.waitFor(() =>
    expect(
      e.quiescence(source.id).blockers.items.map((b) => b.kind),
    ).not.toContain('local_operation'),
  );
  e.manageWorkResources({
    action: 'release',
    runId: descendant.id,
    executionId: execution.id,
    expectedAttempt: 2,
    confirmStopped: true,
    actor: 'wrong attempt',
  });
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  release();
  await vi.waitFor(() => expect(finished).toBe(true));
  e.manageWorkResources({
    action: 'release',
    runId: descendant.id,
    executionId: execution.id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'remote operation has stopped',
  });
  expect(delivery(e, t).outcome).toBe('started');
  expect(e.quiescence(source.id).quiescent).toBe(true);
});

it.each(['wait', 'detached'] as const)(
  'inherits causal identity into %s child workflow runs',
  (mode) => {
    const { engine: e } = setup(),
      source = publish(e),
      child = publish(e),
      handler = publish(e, workflowCall(child, mode)),
      t = reaction(e, source, handler);
    const root = e.start(source, {}).run;
    complete(e, root.id);
    const handlerId = delivery(e, t).runId!,
      descendant = e.store.runs().find((r) => r.parentRunId === handlerId)!;
    expect(e.run(handlerId).triggerChain).toEqual([t.id]);
    expect(descendant.triggerChain).toEqual([t.id]);
    complete(e, descendant.id);
    expect(e.quiescence(handlerId).quiescent).toBe(true);
  },
);

it('inherits causal identity into Batch item runs after transforming an event payload', async () => {
  const { engine: e } = setup(),
    source = publish(e),
    definition = batchDefinition(itemAgent());
  definition.nodes.splice(
    1,
    0,
    nodeSchema.parse({
      id: 'items',
      kind: 'script',
      label: 'Select items',
      language: 'javascript',
      command: 'return [input.runId, input.workflowId];',
    }),
  );
  definition.edges.find((edge) => edge.source === 'entry')!.target = 'items';
  definition.edges.push({
    id: 'items-batch',
    source: 'items',
    target: 'batch',
    port: 'default',
  });
  const handler = publish(e, definition),
    t = reaction(e, source, handler),
    root = e.start(source, {}).run;
  complete(e, root.id);
  const handlerId = delivery(e, t).runId!;
  await vi.waitFor(() => {
    e.pump();
    expect(
      e.store.runs().filter((r) => r.parentRunId === handlerId),
    ).toHaveLength(2);
  });
  const items = e.store.runs().filter((r) => r.parentRunId === handlerId);
  expect(
    items.every(
      (r) =>
        r.batchNodeId === 'batch' &&
        JSON.stringify(r.triggerChain) === JSON.stringify([t.id]),
    ),
  ).toBe(true);
  for (const item of items) complete(e, item.id);
  expect(e.run(handlerId).status).toBe('completed');
});

it('keeps causal identity and quiescence across forward continue-as-new successors', () => {
  const { engine: e } = setup(),
    source = publish(e),
    definition = blankDefinition();
  definition.nodes[definition.nodes.length - 1] = nodeSchema.parse({
    ...definition.nodes.at(-1)!,
    continueAsNew: { maxRuns: 2 },
  });
  const handler = publish(e, definition),
    initial = reaction(e, source, handler),
    cleanup = reaction(e, handler),
    root = e.start(source, {}).run;
  complete(e, root.id);
  const first = delivery(e, initial).runId!;
  complete(e, first, { checkpoint: 1 });
  const second = e.run(first).chain!.nextRunId!;
  expect(e.run(second).triggerChain).toEqual([initial.id]);
  expect(e.quiescence(first).runCount).toBe(2);
  expect(e.quiescence(first).quiescent).toBe(false);
  expect(delivery(e, cleanup)).toMatchObject({
    sourceRunId: first,
    outcome: 'pending_quiescence',
  });
  e.cancel(second);
  e.pump();
  expect(delivery(e, cleanup).outcome).toBe('started');
  expect(e.run(delivery(e, cleanup).runId!).triggerChain).toEqual([
    initial.id,
    cleanup.id,
  ]);
  expect(e.quiescence(first).quiescent).toBe(true);
});

it('recovers durable pending event and pruned pair receipts through separate SQLite connections', () => {
  const { engine: original, root } = setup(true);
  const sourceId = publish(original),
    targetId = publish(original),
    t = reaction(original, sourceId, targetId);
  const pause = original.pauses.create({
    target: { scope: 'workflow', workflowId: targetId },
    actor: 'test',
    reason: 'restart gate',
  });
  const source = original.start(sourceId, {}).run;
  complete(original, source.id);
  expect(delivery(original, t).outcome).toBe('pending_pause');
  const receiptId = delivery(original, t).id;
  original.stop();
  original.store.close();
  engines.splice(engines.indexOf(original), 1);
  const reopen = () => {
    const e = new Engine(
      new Store(join(root, 'db.sqlite'), { secretKeyFile: join(root, 'key') }),
      root,
    );
    engines.push(e);
    return e;
  };
  const recovered = reopen();
  recovered.pauses.resume(pause.id);
  recovered.pump();
  recovered.pump();
  const dispatched = delivery(recovered, t);
  expect(dispatched.id).toBe(receiptId);
  expect(dispatched.outcome).toBe('started');
  expect(recovered.run(dispatched.runId!).triggerChain).toEqual([t.id]);
  complete(recovered, dispatched.runId!);
  recovered.store.trimEventDeliveries(t.id, 0);
  expect(recovered.store.eventDeliveries(t.id).total).toBe(0);
  recovered.stop();
  recovered.store.close();
  engines.splice(engines.indexOf(recovered), 1);
  const again = reopen();
  const event = again.store
    .events(source.id)
    .find((event) => event.type === 'run.completed')!;
  again.triggers.events.capture(again.run(source.id), event);
  again.pump();
  expect(
    again.store.runs().filter((run) => run.workflowId === targetId),
  ).toHaveLength(1);
  expect(again.store.eventDeliveries(t.id).total).toBe(0);
  expect(again.store.list('eventTriggerReceipts')).toHaveLength(1);
});

it('keeps a foreground Script interrupted by restart uncertain after its old process exits', async () => {
  const { engine: original, root } = setup(true);
  const marker = join(root, 'foreground-pid');
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Foreground worker',
    language: 'javascript',
    timeoutMs: 60000,
    command: `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); await new Promise(resolve => setTimeout(resolve, 60000)); return {};`,
  });
  const child = publish(original, definition),
    parent = publish(original, workflowCall(child, 'detached')),
    t = reaction(original, parent);
  const source = original.start(parent, {}).run;
  await vi.waitFor(() => expect(existsSync(marker)).toBe(true));
  const pid = Number(readFileSync(marker, 'utf8'));
  const descendant = original.store
    .runs()
    .find((run) => run.parentRunId === source.id)!;
  const execution = descendant.executions.find(
    (step) => step.kind === 'script',
  )!;
  expect(delivery(original, t).outcome).toBe('pending_quiescence');
  original.stop();
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  original.store.close();
  engines.splice(engines.indexOf(original), 1);
  const recovered = new Engine(
    new Store(join(root, 'db.sqlite'), { secretKeyFile: join(root, 'key') }),
    root,
  );
  engines.push(recovered);
  recovered.pump();
  expect(recovered.run(descendant.id).status).toBe('failed');
  expect(recovered.quiescence(source.id).blockers.items).toContainEqual(
    expect.objectContaining({
      kind: 'uncertain_operation',
      executionId: execution.id,
    }),
  );
  expect(delivery(recovered, t).outcome).toBe('pending_quiescence');
  const released = recovered.manageWorkResources({
    action: 'release',
    runId: descendant.id,
    executionId: execution.id,
    expectedAttempt: 1,
    confirmStopped: true,
    actor: 'test verified old PID exited',
  });
  expect(released).toMatchObject({
    applied: true,
    uncertainOperationsReleased: 1,
  });
  expect(delivery(recovered, t).outcome).toBe('started');
});

it('reconciles an ended managed attention hold before cancelled-source teardown', async () => {
  const { engine: e } = setup();
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Recovery test',
    enabled: true,
    expectedRevision: 0,
    transientRetry: { maxRetries: 1, windowMs: 30000, initialBackoffMs: 0 },
  });
  let attempts = 0;
  e.executors.start([
    {
      id: 'codex',
      detect: async () => ({ status: 'detected', command: '/fake/codex' }),
      run: async () => {
        attempts++;
        throw new Error('HTTP 429 rate limit');
      },
    },
  ]);
  const definition = blankDefinition();
  definition.executor = 'codex';
  const sourceId = publish(e, definition),
    target = publish(e);
  const created = e.triggers.mutate({
    action: 'create',
    workflowId: target,
    config: eventConfigSchema.parse({
      kind: 'event',
      name: 'Cancelled teardown',
      events: ['cancelled'],
      scope: { type: 'workflow', workflowId: sourceId },
      waitForQuiescence: true,
    }),
  }).trigger!;
  const t = e.triggers.mutate({
    action: 'enable',
    id: created.id,
    expectedRevision: created.revision,
  }).trigger as EventTrigger;
  const source = e.start(sourceId, {}).run;
  await vi.waitFor(() => {
    const work = e.store.work(undefined, source.id)[0];
    expect(work?.status).toBe('held');
    expect(e.executors.inspect(work.id).items[0]).toMatchObject({
      state: 'needs_human',
      endedAt: expect.any(String),
      requests: [],
    });
  });
  expect(attempts).toBe(2);
  const work = e.store.work(undefined, source.id)[0],
    record = e.executors.inspect(work.id).items[0];
  e.cancel(source.id);
  e.pump();
  expect(delivery(e, t).outcome).toBe('pending_quiescence');
  expect(e.quiescence(source.id).blockers.items).toEqual([
    expect.objectContaining({
      kind: 'managed_execution',
      executionId: record.id,
    }),
  ]);
  await vi.waitFor(async () =>
    expect(
      await e.executors.manage({
        action: 'reconcile',
        executionId: record.id,
        confirmStopped: true,
      }),
    ).toMatchObject({ applied: true }),
  );
  e.pump();
  expect(e.executors.inspect(work.id).items[0].state).toBe('failed');
  expect(e.quiescence(source.id).quiescent).toBe(true);
  expect(delivery(e, t).outcome).toBe('started');
});

it('rejects reconciliation for a live managed permission request', async () => {
  const { engine: e } = setup();
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Live request test',
    enabled: true,
    expectedRevision: 0,
  });
  e.executors.start([
    {
      id: 'codex',
      detect: async () => ({ status: 'detected', command: '/fake/codex' }),
      run: async (input) => {
        await input.request({
          kind: 'permission',
          title: 'Use tool',
          detail: 'Wait for user permission',
        });
        return { output: {} };
      },
    },
  ]);
  const definition = blankDefinition();
  definition.executor = 'codex';
  const source = e.start(publish(e, definition), {}).run;
  await vi.waitFor(() =>
    expect(e.store.work(undefined, source.id)[0]?.managedExecution?.state).toBe(
      'needs_human',
    ),
  );
  const work = e.store.work(undefined, source.id)[0],
    record = e.executors.inspect(work.id).items[0];
  expect(record.endedAt).toBeUndefined();
  await expect(
    e.executors.manage({
      action: 'reconcile',
      executionId: record.id,
      confirmStopped: true,
    }),
  ).rejects.toThrow();
  expect(e.executors.inspect(work.id).items[0].state).toBe('needs_human');
  expect(e.quiescence(source.id).blockers.items).toContainEqual(
    expect.objectContaining({
      kind: 'managed_execution',
      executionId: record.id,
    }),
  );
  e.executors.stopExecution(record.id);
  e.cancel(source.id);
  await vi.waitFor(() =>
    expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
  );
});
