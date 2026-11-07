import { createHmac } from 'node:crypto';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  webhookConfigSchema,
  type Json,
  type SavedVariable,
  type WebhookConfig,
  type WebhookTrigger,
  type WorkflowDefinition,
} from '@interlock/core';
import { createHooksApp } from '../packages/server/src/hooks';
import { createApp } from '../packages/server/src/app';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const engines: Engine[] = [];
const base = '2026-11-07T12:00:00.000Z';
const secret = 'test-webhook-key-never-in-delivery-history';
const externalTask = { system: 'github', id: 'owner/repo#240' };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(base);
});
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
  const variable = engine.variables.mutate({
    action: 'create',
    name: 'webhook_key',
    kind: 'secret',
    value: secret,
  }) as SavedVariable;
  return { engine, variable };
}
function publish(
  engine: Engine,
  definition: WorkflowDefinition = blankDefinition(),
) {
  const workflow = engine.create('Webhook target', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function config(secretId: string, changes: Partial<WebhookConfig> = {}) {
  return webhookConfigSchema.parse({
    kind: 'webhook',
    name: 'Signed intake',
    authentication: {
      secretId,
      header: 'x-signature',
      prefix: 'sha256=',
      parts: [{ source: 'body' }],
    },
    deliveryId: { source: 'body', path: 'deliveryId' },
    timestamp: { source: 'body', path: 'timestamp' },
    action: {
      type: 'start',
      bindings: { event: { source: 'body', path: '' } },
    },
    rateLimit: { maxRequests: 1000, windowMs: 60000 },
    ...changes,
  });
}
function create(
  engine: Engine,
  workflowId: string,
  configuration: WebhookConfig,
  enable = true,
) {
  const created = engine.triggers.mutate({
    action: 'create',
    workflowId,
    config: configuration,
  }).trigger!;
  expect(created.kind).toBe('webhook');
  expect(created.enabled).toBe(false);
  const trigger = enable
    ? engine.triggers.mutate({
        action: 'enable',
        id: created.id,
        expectedRevision: created.revision,
      }).trigger!
    : created;
  if (trigger.kind !== 'webhook') throw new Error('Expected webhook');
  return trigger;
}
function event(deliveryId = 'delivery-1', changes: Record<string, Json> = {}) {
  return {
    deliveryId,
    timestamp: new Date().toISOString(),
    type: 'opened',
    payload: { approved: true },
    task: externalTask.id,
    ...changes,
  };
}
function signed(
  configuration: WebhookConfig,
  value: Json | string,
  headers: Record<string, string> = {},
) {
  const body = Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  );
  const material = Buffer.concat(
    configuration.authentication.parts.flatMap((part, index) => {
      const bytes =
        part.source === 'body' ? body : Buffer.from(headers[part.path]);
      return index
        ? [Buffer.from(configuration.authentication.separator), bytes]
        : [bytes];
    }),
  );
  return {
    body,
    headers: {
      ...headers,
      [configuration.authentication.header]:
        configuration.authentication.prefix +
        createHmac(configuration.authentication.algorithm, secret)
          .update(material)
          .digest('hex'),
    },
  };
}
function deliver(
  engine: Engine,
  trigger: WebhookTrigger,
  value: Json | string = event(),
  headers: Record<string, string> = {},
) {
  const request = signed(trigger, value, headers);
  const result = engine.webhooks.receive(
    trigger.id,
    request.body,
    request.headers,
  );
  return {
    ...result,
    runId: 'runId' in result ? result.runId : undefined,
    outcome: 'outcome' in result ? result.outcome : undefined,
  };
}
function inputDefinition() {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'input',
    label: 'Approval',
    outputSchema: {
      type: 'object',
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    },
  });
  return definition;
}
function taskBindings() {
  return {
    system: { source: 'literal' as const, value: 'github' },
    id: { source: 'body' as const, path: 'task' },
  };
}
function inputConfig(secretId: string, nodeId = 'agent') {
  return config(secretId, {
    action: {
      type: 'input',
      nodeId,
      externalTask: taskBindings(),
      input: {},
      bindings: { approved: { source: 'body', path: 'payload.approved' } },
    },
  });
}
function inputStatus(engine: Engine, runId: string) {
  const executionId = engine.run(runId).executions.at(-1)!.id;
  return engine.externalInputs.status({
    action: 'status',
    runId,
    executionId,
    includeValue: true,
  });
}

it('rejects unsigned identity, time, filter and action header mappings at the shared save boundary', () => {
  const valid = config('secret');
  const unsigned = { source: 'header', path: 'x-unsigned' };
  for (const patch of [
    { authentication: { ...valid.authentication, parts: [] } },
    {
      authentication: {
        ...valid.authentication,
        parts: [{ source: 'header', path: 'x-id' }],
      },
    },
    { deliveryId: unsigned },
    { timestamp: unsigned },
    { filters: [{ value: unsigned, equals: 'opened' }] },
    {
      action: {
        ...valid.action,
        externalTask: {
          system: { source: 'literal', value: 'github' },
          id: unsigned,
        },
      },
    },
    { action: { ...valid.action, bindings: { unsafe: unsigned } } },
  ])
    expect(webhookConfigSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  expect(
    webhookConfigSchema.safeParse({
      ...valid,
      authentication: {
        ...valid.authentication,
        parts: [{ source: 'header', path: 'x-unsigned' }, { source: 'body' }],
      },
      deliveryId: unsigned,
      timestamp: unsigned,
    }).success,
  ).toBe(true);
});

it('verifies exact raw bytes, HMAC algorithm and prefix before applying any action', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine);
  const trigger = create(engine, workflowId, config(variable.id));
  const body = JSON.stringify(event(), null, 2);
  const request = signed(trigger, body);
  const invalidHeaders: Record<string, string>[] = [
    {},
    { 'x-signature': 'sha256=bad' },
    { 'x-signature': request.headers['x-signature'].replace('sha256=', '') },
  ];
  for (const headers of invalidHeaders)
    expect(
      engine.webhooks.receive(trigger.id, request.body, headers),
    ).toMatchObject({ status: 401, code: 'invalid_signature' });
  expect(
    engine.webhooks.receive(
      trigger.id,
      Buffer.from(JSON.stringify(JSON.parse(body))),
      request.headers,
    ),
  ).toMatchObject({ status: 401 });
  expect(engine.store.runs()).toHaveLength(0);
  expect(
    engine.webhooks.receive(trigger.id, request.body, request.headers),
  ).toMatchObject({ status: 202, outcome: 'started' });
  expect(engine.store.runs()).toHaveLength(1);
  expect(engine.store.runs()[0].input).toEqual({ event: JSON.parse(body) });
  const sha512 = create(
    engine,
    workflowId,
    config(variable.id, {
      authentication: {
        ...trigger.authentication,
        algorithm: 'sha512',
        prefix: 'v1=',
      },
    }),
  );
  expect(deliver(engine, sha512, event('sha512'))).toMatchObject({
    status: 202,
  });
});

it('requires signatures over header delivery IDs and timestamps as well as the raw body', () => {
  const { engine, variable } = setup();
  const configuration = config(variable.id, {
    authentication: {
      secretId: variable.id,
      header: 'signature',
      algorithm: 'sha256',
      prefix: '',
      separator: '.',
      parts: [
        { source: 'header', path: 'x-id' },
        { source: 'header', path: 'x-time' },
        { source: 'body' },
      ],
    },
    deliveryId: { source: 'header', path: 'x-id' },
    timestamp: { source: 'header', path: 'x-time' },
    timestampFormat: 'unix_seconds',
  });
  const trigger = create(engine, publish(engine), configuration);
  const request = signed(
    trigger,
    { data: true },
    { 'x-id': 'id-1', 'x-time': String(Date.now() / 1000) },
  );
  expect(
    engine.webhooks.receive(trigger.id, request.body, {
      ...request.headers,
      'x-id': 'forged',
    }),
  ).toMatchObject({ status: 401 });
  expect(
    engine.webhooks.receive(trigger.id, request.body, {
      ...request.headers,
      'x-time': String(Date.now() / 1000 - 1),
    }),
  ).toMatchObject({ status: 401 });
  const missing = { ...request.headers };
  delete missing['x-time'];
  expect(
    engine.webhooks.receive(trigger.id, request.body, missing),
  ).toMatchObject({ status: 401, code: 'signed_header_missing' });
  expect(
    engine.webhooks.receive(trigger.id, request.body, request.headers),
  ).toMatchObject({ status: 202 });
});

it.each(['iso', 'unix_seconds', 'unix_ms'] as const)(
  'enforces inclusive past and future validity bounds for %s timestamps',
  (timestampFormat) => {
    const { engine, variable } = setup();
    const trigger = create(
      engine,
      publish(engine),
      config(variable.id, { timestampFormat, timestampWindowMs: 1000 }),
    );
    const time = (offset: number): Json =>
      timestampFormat === 'iso'
        ? new Date(Date.now() + offset).toISOString()
        : (Date.now() + offset) /
          (timestampFormat === 'unix_seconds' ? 1000 : 1);
    for (const offset of [-1001, 1001])
      expect(
        deliver(
          engine,
          trigger,
          event(`outside-${offset}`, { timestamp: time(offset) }),
        ),
      ).toMatchObject({ status: 401, code: 'timestamp_outside_window' });
    expect(
      deliver(
        engine,
        trigger,
        event('invalid-time', { timestamp: 'bad-time' }),
      ),
    ).toMatchObject({ status: 401, code: 'timestamp_outside_window' });
    for (const offset of [-1000, 1000])
      expect(
        deliver(
          engine,
          trigger,
          event(`edge-${offset}`, { timestamp: time(offset) }),
        ),
      ).toMatchObject({ status: 202 });
    expect(engine.store.runs()).toHaveLength(2);
  },
);

it('persists delivery idempotency separately from trimmed payload-free history', () => {
  const { engine, variable } = setup();
  const trigger = create(engine, publish(engine), config(variable.id));
  const original = event('original', {
    marker: 'payload-sentinel-never-in-log',
  });
  const first = deliver(engine, trigger, original);
  expect(first).toMatchObject({ status: 202, outcome: 'started' });
  expect(deliver(engine, trigger, original)).toMatchObject({
    status: 202,
    code: 'duplicate',
  });
  expect(
    deliver(engine, trigger, { ...original, marker: 'changed' }),
  ).toMatchObject({ status: 409, code: 'delivery_id_conflict' });
  for (let i = 0; i < 205; i++)
    engine.webhooks.receive(trigger.id, Buffer.from('{}'), {});
  const detail = engine.triggers.inspect(trigger.id);
  expect(detail.deliveries.total).toBe(200);
  expect(JSON.stringify(detail.deliveries)).not.toContain('payload-sentinel');
  expect(JSON.stringify(detail.deliveries)).not.toContain(secret);
  expect(JSON.stringify(detail.deliveries)).not.toContain('x-signature');
  expect(deliver(engine, trigger, original)).toMatchObject({
    status: 202,
    code: 'duplicate',
  });
  expect(engine.store.runs()).toHaveLength(1);
  expect(engine.store.list('webhookReceipts')).toHaveLength(1);
});

it('ignores nonmatching path values, counts them and stores no payload', () => {
  const { engine, variable } = setup();
  const trigger = create(
    engine,
    publish(engine),
    config(variable.id, {
      filters: [{ value: { source: 'body', path: 'type' }, equals: 'opened' }],
    }),
  );
  expect(
    deliver(
      engine,
      trigger,
      event('ignore', { type: 'closed', private: 'payload-not-retained' }),
    ),
  ).toMatchObject({ status: 202, outcome: 'ignored' });
  expect(engine.store.runs()).toHaveLength(0);
  expect(engine.triggers.inspect(trigger.id).trigger).toMatchObject({
    ignoredCount: 1,
  });
  expect(JSON.stringify(engine.store.list('webhookDeliveries'))).not.toContain(
    'payload-not-retained',
  );
  expect(deliver(engine, trigger, event('matched'))).toMatchObject({
    status: 202,
    outcome: 'started',
  });
});

it('ignores absent filter paths and blocks starts at named pause boundaries', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine);
  const trigger = create(
    engine,
    workflowId,
    config(variable.id, {
      filters: [
        { value: { source: 'body', path: 'missing.deep' }, equals: true },
      ],
    }),
  );
  expect(deliver(engine, trigger)).toMatchObject({
    status: 202,
    outcome: 'ignored',
  });
  expect(engine.store.runs()).toHaveLength(0);
  const start = create(engine, workflowId, config(variable.id));
  const hold = engine.pauses.create({
    target: { scope: 'library' },
    actor: 'tests',
    reason: 'Pause hook admission',
  });
  expect(deliver(engine, start)).toMatchObject({
    status: 409,
    code: 'workflow_paused',
  });
  expect(engine.store.runs()).toHaveLength(0);
  engine.pauses.resume(hold.id);
  expect(deliver(engine, start)).toMatchObject({ status: 202 });
});

it('rejects ambiguous signed header encodings and unsafe part layouts', () => {
  const { engine, variable } = setup();
  const valid = config(variable.id);
  for (const authentication of [
    {
      ...valid.authentication,
      parts: [{ source: 'body' }, { source: 'header', path: 'x-time' }],
    },
    {
      ...valid.authentication,
      parts: [
        { source: 'header', path: 'x-time' },
        { source: 'header', path: 'x-time' },
        { source: 'body' },
      ],
    },
    {
      ...valid.authentication,
      parts: [{ source: 'header', path: 'x-signature' }, { source: 'body' }],
    },
    {
      ...valid.authentication,
      separator: '',
      parts: [{ source: 'header', path: 'x-time' }, { source: 'body' }],
    },
  ])
    expect(
      webhookConfigSchema.safeParse({ ...valid, authentication }).success,
    ).toBe(false);
  const trigger = create(
    engine,
    publish(engine),
    config(variable.id, {
      authentication: {
        ...valid.authentication,
        parts: [{ source: 'header', path: 'x-id' }, { source: 'body' }],
      },
      deliveryId: { source: 'header', path: 'x-id' },
    }),
  );
  expect(
    deliver(engine, trigger, event(), { 'x-id': 'left.right' }).status,
  ).toBe(401);
  expect(engine.store.runs()).toHaveLength(0);
  expect(
    deliver(engine, trigger, event(), { 'x-id': 'single-id' }).status,
  ).toBe(202);
});

it('counts completed run failures once across successive successful deliveries and auto-pauses', () => {
  const { engine, variable } = setup();
  const trigger = create(
    engine,
    publish(engine),
    config(variable.id, { pauseAfterConsecutiveFailures: 2 }),
  );
  for (const id of ['first', 'second']) {
    const delivery = deliver(engine, trigger, event(id));
    expect(delivery.status).toBe(202);
    const run = engine.run(delivery.runId!);
    run.status = 'failed';
    run.error = 'deliberate fixture failure';
    engine.store.put('runs', run);
    engine.pump();
    engine.pump();
  }
  expect(engine.triggers.inspect(trigger.id).trigger).toMatchObject({
    consecutiveFailures: 2,
    autoPaused: { reason: expect.stringContaining('Triggered run failed') },
  });
  expect(engine.triggers.attention().items).toContainEqual(
    expect.objectContaining({ triggerId: trigger.id, kind: 'automatic_pause' }),
  );
  expect(deliver(engine, trigger, event('paused'))).toMatchObject({
    status: 409,
    code: 'trigger_disabled',
  });
});

it('starts through workflow capacity admission and active external-task reuse', () => {
  const { engine, variable } = setup();
  const definition = { ...blankDefinition(), maxActiveRuns: 1 };
  const workflowId = publish(engine, definition);
  const trigger = create(
    engine,
    workflowId,
    config(variable.id, {
      action: {
        type: 'start',
        input: {},
        bindings: {},
        externalTask: taskBindings(),
        onActiveExternalTask: 'reuse',
      },
    }),
  );
  const first = deliver(engine, trigger, event('one'));
  expect(first.status).toBe(202);
  expect(['started', 'queued']).toContain(first.outcome);
  expect(engine.run(first.runId!).status).toBe('waiting');
  expect(deliver(engine, trigger, event('two'))).toMatchObject({
    runId: first.runId,
  });
  expect(engine.store.runs()).toHaveLength(1);
  const next = deliver(
    engine,
    trigger,
    event('other', { task: 'owner/repo#241' }),
  );
  expect(next).toMatchObject({ status: 202, outcome: 'queued' });
  expect(engine.run(next.runId!).status).toBe('queued');
});

it('resolves exactly one current input by external task and node ID and rejects stale signed times', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine, inputDefinition());
  const trigger = create(engine, workflowId, inputConfig(variable.id));
  expect(deliver(engine, trigger, event('none'))).toMatchObject({
    status: 409,
    code: 'input_target_not_unique',
  });
  const run = engine.start(workflowId, null, undefined, undefined, {
    externalTask,
  }).run;
  const otherTask = engine.start(workflowId, null, undefined, undefined, {
    externalTask: { ...externalTask, id: 'another' },
  }).run;
  const wrongNode = create(
    engine,
    workflowId,
    inputConfig(variable.id, 'other-node'),
  );
  expect(deliver(engine, wrongNode, event('wrong-node'))).toMatchObject({
    status: 409,
    code: 'input_target_not_unique',
  });
  expect(
    deliver(
      engine,
      trigger,
      event('old', { timestamp: new Date(Date.parse(base) - 1).toISOString() }),
    ),
  ).toMatchObject({ status: 409, code: 'event_predates_input' });
  expect(inputStatus(engine, run.id)).toMatchObject({ revision: 0 });
  const second = engine.start(workflowId, null, undefined, undefined, {
    externalTask,
  }).run;
  expect(deliver(engine, trigger, event('ambiguous'))).toMatchObject({
    status: 409,
    code: 'input_target_not_unique',
  });
  expect(inputStatus(engine, run.id)).toMatchObject({ revision: 0 });
  expect(inputStatus(engine, second.id)).toMatchObject({ revision: 0 });
  engine.cancel(second.id);
  expect(
    deliver(
      engine,
      trigger,
      event('equal-boundary', {
        timestamp: engine.run(run.id).executions.at(-1)!.startedAt,
      }),
    ),
  ).toMatchObject({ status: 202, outcome: 'submitted', runId: run.id });
  expect(inputStatus(engine, run.id)).toMatchObject({
    state: 'waiting',
    revision: 1,
    value: { approved: true },
  });
  expect(inputStatus(engine, otherTask.id)).toMatchObject({ revision: 0 });
  expect(
    deliver(
      engine,
      trigger,
      event('equal-boundary', {
        timestamp: engine.run(run.id).executions.at(-1)!.startedAt,
      }),
    ),
  ).toMatchObject({ code: 'duplicate' });
  expect(inputStatus(engine, run.id)).toMatchObject({ revision: 1 });
});

it('keeps webhook input pending while acceptance holds and workflow pauses remain authoritative', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine, inputDefinition());
  const run = engine.start(workflowId, null, undefined, undefined, {
    externalTask,
  }).run;
  const target = { runId: run.id, executionId: run.executions.at(-1)!.id };
  const trigger = create(engine, workflowId, inputConfig(variable.id));
  const holdTrigger = create(
    engine,
    workflowId,
    config(variable.id, {
      action: { type: 'hold', externalTask: taskBindings() },
    }),
  );
  expect(deliver(engine, holdTrigger, event('hold'))).toMatchObject({
    status: 202,
    outcome: 'held',
  });
  expect(deliver(engine, trigger, event('submit-held'))).toMatchObject({
    status: 202,
    outcome: 'submitted',
  });
  expect(() =>
    engine.externalInputs.mutate({
      action: 'accept',
      ...target,
      expectedRevision: 1,
    }),
  ).toThrow(/hold/i);
  engine.externalInputs.mutate({
    action: 'release',
    runId: run.id,
    expectedRevision: 1,
  });
  const pause = engine.pauses.create({
    target: { scope: 'workflow', workflowId },
    actor: 'tests',
    reason: 'Verify acceptance gate',
  });
  expect(() =>
    engine.externalInputs.mutate({
      action: 'accept',
      ...target,
      expectedRevision: 1,
    }),
  ).toThrow(/paused/i);
  expect(deliver(engine, trigger, event('paused-hook'))).toMatchObject({
    status: 202,
    code: 'submitted',
  });
  expect(inputStatus(engine, run.id)).toMatchObject({
    revision: 2,
    state: 'waiting',
  });
  engine.pauses.resume(pause.id);
  engine.externalInputs.mutate({
    action: 'accept',
    ...target,
    expectedRevision: 2,
  });
  expect(engine.run(run.id).status).toBe('completed');
});

it('rolls back target writes if delivery receipt persistence fails, then permits an exact retry', () => {
  const { engine, variable } = setup();
  const trigger = create(engine, publish(engine), config(variable.id));
  const collections = [
    'runs',
    'work',
    'events',
    'runStarts',
    'webhookReceipts',
    'webhookDeliveries',
    'webhookOutcomes',
    'workflowTriggers',
  ];
  const snapshot = () =>
    Object.fromEntries(
      collections.map((name) => [name, engine.store.list(name)]),
    );
  const before = snapshot();
  const original = engine.store.put.bind(engine.store);
  const injected = vi
    .spyOn(engine.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'webhookReceipts')
        throw new Error('injected receipt write failure');
      return original(collection, value);
    });
  expect(() => deliver(engine, trigger)).toThrow(
    'injected receipt write failure',
  );
  expect(snapshot()).toEqual(before);
  injected.mockRestore();
  expect(deliver(engine, trigger)).toMatchObject({
    status: 202,
    outcome: 'started',
  });
  expect(engine.store.runs()).toHaveLength(1);
});

it('cancels only active runs of the matching task in the trigger workflow', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine);
  const otherWorkflow = publish(engine);
  const matched = engine.start(workflowId, {}, undefined, undefined, {
    externalTask,
  }).run;
  const otherTask = engine.start(workflowId, {}, undefined, undefined, {
    externalTask: { ...externalTask, id: 'other' },
  }).run;
  const elsewhere = engine.start(otherWorkflow, {}, undefined, undefined, {
    externalTask,
  }).run;
  const trigger = create(
    engine,
    workflowId,
    config(variable.id, {
      action: { type: 'cancel', externalTask: taskBindings() },
    }),
  );
  expect(deliver(engine, trigger)).toMatchObject({
    status: 202,
    outcome: 'cancelled',
  });
  expect(engine.run(matched.id).status).toBe('cancelled');
  expect(engine.run(otherTask.id).status).toBe('waiting');
  expect(engine.run(elsewhere.id).status).toBe('waiting');
});

it('rejects disabled, unset and non-Secret authentication while leaving valid controls usable', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine);
  const configVariable = engine.variables.mutate({
    action: 'create',
    name: 'not_a_secret',
    kind: 'config',
    value: secret,
  }) as SavedVariable;
  expect(() => create(engine, workflowId, config(configVariable.id))).toThrow(
    /Secret/,
  );
  const unset = engine.variables.mutate({
    action: 'create',
    name: 'unset_secret',
    kind: 'secret',
  }) as SavedVariable;
  const unready = create(engine, workflowId, config(unset.id), false);
  expect(() =>
    engine.triggers.mutate({
      action: 'enable',
      id: unready.id,
      expectedRevision: unready.revision,
    }),
  ).toThrow(/no value/);
  const trigger = create(engine, workflowId, config(variable.id));
  const disabled = engine.variables.mutate({
    action: 'update',
    id: variable.id,
    expectedRevision: variable.revision,
    enabled: false,
  }) as SavedVariable;
  expect(deliver(engine, trigger)).toMatchObject({
    status: 401,
    code: 'secret_unavailable',
  });
  engine.variables.mutate({
    action: 'update',
    id: variable.id,
    expectedRevision: disabled.revision,
    enabled: true,
  });
  expect(deliver(engine, trigger)).toMatchObject({ status: 202 });
  expect(() =>
    engine.variables.mutate({
      action: 'delete',
      id: variable.id,
      expectedRevision: disabled.revision + 1,
    }),
  ).toThrow(/webhook/);
});

it('enforces per-trigger body and fixed-window rate limits without disabling on unsigned noise', () => {
  const { engine, variable } = setup();
  const trigger = create(
    engine,
    publish(engine),
    config(variable.id, {
      maxBodyBytes: 200,
      rateLimit: { maxRequests: 3, windowMs: 1000 },
      pauseAfterConsecutiveFailures: 1,
    }),
  );
  expect(
    engine.webhooks.receive(trigger.id, Buffer.alloc(201), {}),
  ).toMatchObject({ status: 413 });
  expect(
    engine.webhooks.receive(trigger.id, Buffer.from('{}'), {}),
  ).toMatchObject({ status: 401 });
  expect(deliver(engine, trigger, event('valid'))).toMatchObject({
    status: 202,
  });
  expect(deliver(engine, trigger, event('limited'))).toMatchObject({
    status: 429,
    code: 'rate_limited',
  });
  expect(
    engine.triggers.inspect(trigger.id).trigger.autoPaused,
  ).toBeUndefined();
  vi.setSystemTime(Date.parse(base) + 1000);
  expect(deliver(engine, trigger, event('new-window'))).toMatchObject({
    status: 202,
  });
});

it('exports only disabled webhook configuration and Secret requirements, importing disabled without logs', () => {
  const { engine, variable } = setup();
  const workflowId = publish(engine);
  const trigger = create(engine, workflowId, config(variable.id));
  expect(deliver(engine, trigger)).toMatchObject({ status: 202 });
  const bundle = exportWorkflows(engine.store, workflowId);
  expect(bundle.formatVersion).toBe(7);
  expect(bundle.workflows[0].webhooks?.[0]).toMatchObject({
    id: trigger.id,
    enabled: false,
  });
  expect(bundle.variables).toContainEqual({
    id: variable.id,
    name: variable.name,
    kind: 'secret',
  });
  const serialized = JSON.stringify(bundle);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain('webhookReceipts');
  expect(serialized).not.toContain('webhookDeliveries');
  const { engine: imported } = setup();
  importWorkflows(imported.store, bundle, {
    variableBindings: {
      [variable.id]: {
        action: 'bind',
        variableId: imported.store.list<SavedVariable>('variables')[0].id,
      },
    },
  });
  expect(imported.triggers.inspect(trigger.id).trigger.enabled).toBe(false);
  expect(imported.triggers.inspect(trigger.id).deliveries.total).toBe(0);
});

it('mounts only hooks on a real ingress listener and preserves primary host/origin checks', async () => {
  const { engine, variable } = setup();
  const trigger = create(engine, publish(engine), config(variable.id));
  const server = serve({
    fetch: createHooksApp(engine).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No hooks listener');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of [
      '/',
      '/index.html',
      '/health',
      '/events',
      '/mcp',
      '/trpc/workflows.list',
    ]) {
      expect((await fetch(url + path)).status).toBe(404);
      expect(
        (await fetch(url + path, { method: 'POST', body: '{}' })).status,
      ).toBe(404);
    }
    expect((await fetch(`${url}/hooks/${trigger.id}`)).status).toBe(404);
    const request = signed(trigger, event('http-control'));
    const result = await fetch(`${url}/hooks/${trigger.id}`, {
      method: 'POST',
      body: request.body,
      headers: request.headers,
    });
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ code: 'started' });
    const local = createApp(engine);
    expect(
      (
        await local.request(`http://remote.example/hooks/${trigger.id}`, {
          method: 'POST',
          body: request.body,
          headers: request.headers,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await local.request(`http://localhost/hooks/${trigger.id}`, {
          method: 'POST',
          body: request.body,
          headers: { ...request.headers, origin: 'https://remote.example' },
        })
      ).status,
    ).toBe(403);
    const localRequest = signed(trigger, event('local-control'));
    expect(
      (
        await local.request(`http://localhost/hooks/${trigger.id}`, {
          method: 'POST',
          body: localRequest.body,
          headers: localRequest.headers,
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await fetch(`${url}/hooks/${trigger.id}`, {
          method: 'POST',
          body: Buffer.alloc(trigger.maxBodyBytes + 1),
        })
      ).status,
    ).toBe(413);
    const streamed = await fetch(`${url}/hooks/${trigger.id}`, {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(trigger.maxBodyBytes));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toMatchObject({ code: 'body_too_large' });
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('charges HTTP oversized-body rejections against the same persisted request rate', () => {
  const { engine, variable } = setup();
  const trigger = create(
    engine,
    publish(engine),
    config(variable.id, { rateLimit: { maxRequests: 1, windowMs: 1000 } }),
  );
  expect(engine.webhooks.rejectBody(trigger.id)).toMatchObject({ status: 413 });
  expect(
    deliver(engine, trigger, event('blocked-after-body-limit')),
  ).toMatchObject({ status: 429, code: 'rate_limited' });
  vi.setSystemTime(Date.parse(base) + 1000);
  expect(deliver(engine, trigger, event('next-window'))).toMatchObject({
    status: 202,
  });
});
