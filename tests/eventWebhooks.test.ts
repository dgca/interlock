import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  eventConfigSchema,
  type EventTrigger,
  type Json,
  type SavedVariable,
} from '@interlock/core';

const engines: Engine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});

function setup(
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
) {
  const engine = new Engine(new Store(':memory:'), process.cwd(), {
    ...(fetchFn ? { webhookFetch: fetchFn } : {}),
  });
  engines.push(engine);
  return engine;
}

function publish(engine: Engine, definition = blankDefinition()) {
  const w = engine.create('Event Webhook Test', '', definition);
  engine.publish(w.id);
  return w.id;
}

function completeRun(engine: Engine, runId: string, output: Json = {}) {
  const w = engine.store.work('available', runId)[0];
  if (!w) throw new Error('No available work');
  const claim = engine.claim(w.id, {
    workerId: 'test-worker',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(w.id, claim.token!, output);
  engine.pump();
}

it('dispatches HMAC-signed POST webhook on run completion and settles delivery', async () => {
  const requests: { url: string; init: RequestInit; body: string }[] = [];
  const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init, body: init.body as string });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const engine = setup(mockFetch);
  const sourceId = publish(engine);

  // Create secret variable
  const secret = engine.variables.mutate({
    action: 'create',
    name: 'webhook-secret',
    kind: 'secret',
    value: 'super-secret-signing-key',
  }) as SavedVariable;

  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Outbound alert webhook',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: sourceId },
    action: {
      type: 'webhook',
      url: 'https://pager.example.com/api/v1/alert',
      secretId: secret.id,
      headers: {
        'x-custom-header': 'custom-value',
      },
      timeoutMs: 3000,
    },
  });

  const triggerRecord = engine.triggers.mutate({
    action: 'create',
    workflowId: sourceId,
    config,
  }).trigger!;

  engine.triggers.mutate({
    action: 'enable',
    id: triggerRecord.id,
    expectedRevision: triggerRecord.revision,
  });

  const run = engine.start(sourceId, { testInput: 'hello' }).run;
  completeRun(engine, run.id, { done: true });
  await engine.drain();

  expect(requests).toHaveLength(1);
  const req = requests[0];
  expect(req.url).toBe('https://pager.example.com/api/v1/alert');
  expect(req.init.method).toBe('POST');

  const headers = req.init.headers as Record<string, string>;
  expect(headers['content-type']).toBe('application/json');
  expect(headers['x-interlock-event']).toBe('completed');
  expect(headers['x-custom-header']).toBe('custom-value');
  expect(headers['x-interlock-delivery']).toBeDefined();
  expect(headers['x-interlock-timestamp']).toBeDefined();

  // Verify HMAC signature
  const body = req.body;
  const expectedSig = createHmac('sha256', 'super-secret-signing-key')
    .update(body)
    .digest('hex');
  expect(headers['x-interlock-signature-256']).toBe(expectedSig);
  expect(headers['x-interlock-signature']).toBe(`sha256=${expectedSig}`);

  const parsedBody = JSON.parse(body);
  expect(parsedBody.type).toBe('completed');
  expect(parsedBody.runId).toBe(run.id);
  expect(parsedBody.workflowId).toBe(sourceId);

  // Check delivery outcome in storage
  const deliveries = engine.store.eventDeliveries(triggerRecord.id).items;
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].outcome).toBe('delivered');
  expect(deliveries[0].settled).toBe(true);

  // Trigger state check
  const updatedTrigger = engine.store.get<EventTrigger>(
    'workflowTriggers',
    triggerRecord.id,
  )!;
  expect(updatedTrigger.consecutiveFailures).toBe(0);
  expect(updatedTrigger.lastFireAt).toBeDefined();
});

it('dispatches unsigned webhook when secretId is omitted', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response('OK', { status: 200 });
  });

  const engine = setup(mockFetch);
  const sourceId = publish(engine);

  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Unsigned webhook',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: sourceId },
    action: {
      type: 'webhook',
      url: 'https://chat.example.com/webhook',
    },
  });

  const triggerRecord = engine.triggers.mutate({
    action: 'create',
    workflowId: sourceId,
    config,
  }).trigger!;

  engine.triggers.mutate({
    action: 'enable',
    id: triggerRecord.id,
    expectedRevision: triggerRecord.revision,
  });

  const run = engine.start(sourceId, {}).run;
  completeRun(engine, run.id);
  await engine.drain();

  expect(requests).toHaveLength(1);
  const headers = requests[0].init.headers as Record<string, string>;
  expect(headers['x-interlock-signature']).toBeUndefined();
  expect(headers['x-interlock-signature-256']).toBeUndefined();
  expect(headers['x-interlock-event']).toBe('completed');

  const deliveries = engine.store.eventDeliveries(triggerRecord.id).items;
  expect(deliveries[0].outcome).toBe('delivered');
});

it('handles HTTP error responses, marks delivery failed, and pauses after consecutive failures', async () => {
  const mockFetch = vi.fn(async () => {
    return new Response('Bad Gateway', {
      status: 502,
      statusText: 'Bad Gateway',
    });
  });

  const engine = setup(mockFetch);
  const sourceId = publish(engine);

  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Failing webhook',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: sourceId },
    pauseAfterConsecutiveFailures: 2,
    action: {
      type: 'webhook',
      url: 'https://broken.example.com/webhook',
    },
  });

  const triggerRecord = engine.triggers.mutate({
    action: 'create',
    workflowId: sourceId,
    config,
  }).trigger!;

  engine.triggers.mutate({
    action: 'enable',
    id: triggerRecord.id,
    expectedRevision: triggerRecord.revision,
  });

  // First failure
  const run1 = engine.start(sourceId, {}).run;
  completeRun(engine, run1.id);
  await engine.drain();

  let deliveries = engine.store.eventDeliveries(triggerRecord.id).items;
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].outcome).toBe('failed');
  expect(deliveries[0].error).toContain('HTTP 502');

  let updatedTrigger = engine.store.get<EventTrigger>(
    'workflowTriggers',
    triggerRecord.id,
  )!;
  expect(updatedTrigger.consecutiveFailures).toBe(1);
  expect(updatedTrigger.autoPaused).toBeUndefined();

  // Second failure -> triggers autoPaused
  const run2 = engine.start(sourceId, {}).run;
  completeRun(engine, run2.id);
  await engine.drain();

  deliveries = engine.store.eventDeliveries(triggerRecord.id).items;
  expect(deliveries).toHaveLength(2);
  expect(deliveries[1].outcome).toBe('failed');

  updatedTrigger = engine.store.get<EventTrigger>(
    'workflowTriggers',
    triggerRecord.id,
  )!;
  expect(updatedTrigger.consecutiveFailures).toBe(2);
  expect(updatedTrigger.autoPaused).toBeDefined();
  expect(updatedTrigger.autoPaused?.reason).toContain(
    'Paused after 2 consecutive failures',
  );
});

it('handles network timeouts gracefully without failing engine execution', async () => {
  const mockFetch = vi.fn(async () => {
    throw new Error('Connection refused: ECONNREFUSED');
  });

  const engine = setup(mockFetch);
  const sourceId = publish(engine);

  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Network failure webhook',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: sourceId },
    action: {
      type: 'webhook',
      url: 'https://unreachable.local/webhook',
    },
  });

  const triggerRecord = engine.triggers.mutate({
    action: 'create',
    workflowId: sourceId,
    config,
  }).trigger!;

  engine.triggers.mutate({
    action: 'enable',
    id: triggerRecord.id,
    expectedRevision: triggerRecord.revision,
  });

  const run = engine.start(sourceId, {}).run;
  completeRun(engine, run.id);
  await engine.drain();

  const deliveries = engine.store.eventDeliveries(triggerRecord.id).items;
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].outcome).toBe('failed');
  expect(deliveries[0].error).toContain('Connection refused');
});

it('rejects trigger creation or enabling when secretId does not reference a Secret variable', () => {
  const engine = setup();
  const sourceId = publish(engine);

  // Config variable, not a Secret
  const configVar = engine.variables.mutate({
    action: 'create',
    name: 'config-var',
    kind: 'config',
    value: 'not-a-secret',
  }) as SavedVariable;

  const config = eventConfigSchema.parse({
    kind: 'event',
    name: 'Invalid secret webhook',
    events: ['completed'],
    scope: { type: 'workflow', workflowId: sourceId },
    action: {
      type: 'webhook',
      url: 'https://test.local/webhook',
      secretId: configVar.id,
    },
  });

  expect(() =>
    engine.triggers.mutate({
      action: 'create',
      workflowId: sourceId,
      config,
    }),
  ).toThrow('Webhook action authentication requires a Secret variable');
});

it('reports outbound enablement on unpublished targets consistently with enabling', () => {
  const engine = setup();
  const workflow = engine.create(
    'Unpublished outbound alerts',
    '',
    blankDefinition(),
  );
  const outbound = engine.triggers.mutate({
    action: 'create',
    workflowId: workflow.id,
    config: eventConfigSchema.parse({
      kind: 'event',
      name: 'Alerts',
      events: ['failed'],
      scope: { type: 'library' },
      action: { type: 'webhook', url: 'https://example.test/notify' },
    }),
  }).trigger!;
  const handler = engine.triggers.mutate({
    action: 'create',
    workflowId: workflow.id,
    config: eventConfigSchema.parse({
      kind: 'event',
      name: 'Handler',
      events: ['failed'],
      scope: { type: 'library' },
    }),
  }).trigger!;
  expect(engine.triggers.inspect(outbound.id).trigger.canEnable).toBe(true);
  expect(engine.triggers.inspect(handler.id).trigger.canEnable).toBe(false);
  expect(
    engine.triggers.mutate({
      action: 'enable',
      id: outbound.id,
      expectedRevision: 1,
    }).trigger?.enabled,
  ).toBe(true);
  engine.update(workflow.id, { archived: true });
  expect(engine.triggers.inspect(outbound.id).trigger.canEnable).toBe(false);
});
