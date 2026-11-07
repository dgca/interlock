import { workflowBundleSchema } from '../packages/core/src/transfer';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, webhookConfigSchema } from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const engines: Engine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
});
const setup = () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  return e;
};
function hook(e: Engine) {
  const w = e.create('Webhook portable', '', blankDefinition());
  e.publish(w.id);
  const secret = e.variables.mutate({
    action: 'create',
    name: 'Webhook_key',
    kind: 'secret',
    value: 'never-export-this',
  });
  if (!('revision' in secret)) throw new Error('Missing variable revision');
  const config = webhookConfigSchema.parse({
    kind: 'webhook',
    name: 'Webhook',
    authentication: {
      secretId: secret.id,
      header: 'x-signature',
      parts: [{ source: 'body' }],
    },
    deliveryId: { source: 'body', path: 'id' },
    timestamp: { source: 'body', path: 'time' },
    action: { type: 'start' },
  });
  const t = e.triggers.mutate({
    action: 'create',
    workflowId: w.id,
    config,
  }).trigger!;
  e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: t.revision,
  });
  return { w, secret, t };
}
it('exports webhook Secret requirements, imports disabled and excludes local history or values', () => {
  const source = setup(),
    target = setup();
  const { w, secret, t } = hook(source);
  source.webhooks.receive(t.id, Buffer.from('{"private":"payload"}'), {});
  const bundle = exportWorkflows(source.store, w.id);
  expect(bundle.formatVersion).toBe(7);
  expect(bundle.variables).toEqual([
    { id: secret.id, name: 'Webhook_key', kind: 'secret' },
  ]);
  expect(bundle.workflows[0].webhooks).toEqual([
    {
      id: t.id,
      enabled: false,
      config: expect.objectContaining({ kind: 'webhook' }),
    },
  ]);
  expect(JSON.stringify(bundle)).not.toMatch(
    /never-export-this|private|payload|receivedAt|webhookReceipts/,
  );
  importWorkflows(target.store, bundle, {
    variableBindings: { [secret.id]: { action: 'provision' } },
  });
  const imported = target.triggers.inspect(t.id);
  expect(imported.trigger.enabled).toBe(false);
  expect(imported.deliveries.total).toBe(0);
  expect(() =>
    target.triggers.mutate({
      action: 'enable',
      id: t.id,
      expectedRevision: imported.trigger.revision,
    }),
  ).toThrow('no value');
  const local = target.variables.get(secret.id);
  target.variables.mutate({
    action: 'update',
    id: local.id,
    expectedRevision: local.revision,
    value: 'local-replacement',
  });
  target.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: imported.trigger.revision,
  });
  importWorkflows(target.store, bundle, {
    force: true,
    variableBindings: { [secret.id]: { action: 'bind', variableId: local.id } },
  });
  expect(target.triggers.inspect(t.id).trigger.enabled).toBe(false);
  const downgraded = { ...bundle, formatVersion: 6 };
  expect(workflowBundleSchema.safeParse(downgraded).success).toBe(false);
  const wrongKind = structuredClone(bundle);
  wrongKind.variables![0].kind = 'config';
  expect(workflowBundleSchema.safeParse(wrongKind).success).toBe(false);
});
it('exposes webhook variable dependencies and prevents deleting its authentication Secret', () => {
  const e = setup(),
    { secret, t } = hook(e);
  const inspection = e.variables.read({ action: 'inspect', id: secret.id });
  expect(inspection).toMatchObject({
    dependencies: { triggers: { total: 1, items: [{ triggerId: t.id }] } },
  });
  expect(() =>
    e.variables.mutate({
      action: 'delete',
      id: secret.id,
      expectedRevision: secret.revision,
    }),
  ).toThrow('webhook triggers');
  e.triggers.mutate({ action: 'delete', id: t.id, expectedRevision: 2 });
  expect(() =>
    e.variables.mutate({
      action: 'delete',
      id: secret.id,
      expectedRevision: secret.revision,
    }),
  ).not.toThrow();
});
it('rolls back target starts and receipts when persisting a delivery fails', async () => {
  const e = setup(),
    { t } = hook(e);
  const { createHmac } = await import('node:crypto');
  const body = Buffer.from(
    JSON.stringify({ id: 'write-failure', time: new Date().toISOString() }),
  );
  const headers = {
    'x-signature':
      'sha256=' +
      createHmac('sha256', 'never-export-this').update(body).digest('hex'),
  };
  const collections = [
    'workflowTriggers',
    'runs',
    'work',
    'events',
    'runStarts',
    'promptCaptures',
    'webhookReceipts',
    'webhookDeliveries',
  ];
  const snapshot = () =>
    Object.fromEntries(collections.map((name) => [name, e.store.list(name)]));
  const before = snapshot();
  const original = e.store.put.bind(e.store);
  const fault = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'webhookDeliveries')
        throw new Error('injected delivery persistence failure');
      return original(collection, value);
    });
  expect(() => e.webhooks.receive(t.id, body, headers)).toThrow(
    'injected delivery persistence failure',
  );
  expect(snapshot()).toEqual(before);
  fault.mockRestore();
  expect(e.webhooks.receive(t.id, body, headers)).toMatchObject({
    status: 202,
    outcome: 'started',
  });
  expect(e.store.runs()).toHaveLength(1);
});

it('merges selected webhook bundles without dropping configurations or hiding conflicts', async () => {
  const { importSelection, inspectImportDocument } =
    await import('../packages/runtime/src/importSelection');
  const source = setup(),
    target = setup(),
    { w, secret, t } = hook(source);
  source.modelAliases.mutate({
    action: 'create',
    name: 'portable-builder',
    description: 'Builder requirement',
    candidates: [{ model: 'fixture-model' }],
  });
  const definition = structuredClone(source.workflow(w.id).draft);
  if (definition.nodes[1].kind !== 'agent') throw new Error('Expected Agent');
  definition.nodes[1].model = 'portable-builder';
  source.update(w.id, {
    draft: definition,
    draftRevision: source.workflow(w.id).draftRevision,
  });
  source.publish(w.id);
  const first = exportWorkflows(source.store, w.id);
  const original = first.workflows[0].webhooks![0].config;
  const second = source.triggers.mutate({
    action: 'create',
    workflowId: w.id,
    config: { ...original, name: 'Second webhook' },
  }).trigger!;
  const additional = exportWorkflows(source.store, w.id);
  additional.workflows[0].webhooks = additional.workflows[0].webhooks!.filter(
    (h) => h.id === second.id,
  );
  expect(inspectImportDocument(first).name).toBe(w.name);
  importSelection(target, [first, additional], {
    [secret.id]: { action: 'provision' },
  });
  expect(
    target.triggers
      .list(w.id)
      .items.map((h) => h.id)
      .sort(),
  ).toEqual([t.id, second.id].sort());
  expect(target.triggers.list(w.id).items.every((h) => !h.enabled)).toBe(true);
  expect(first.modelAliases).toEqual([
    { name: 'portable-builder', description: 'Builder requirement' },
  ]);
  expect(target.modelAliases.get('portable-builder')).toBeUndefined();
  const aliasConflict = structuredClone(first);
  aliasConflict.modelAliases![0].description = 'Conflicting alias requirement';
  expect(() =>
    importSelection(target, [first, aliasConflict], {
      [secret.id]: { action: 'bind', variableId: secret.id },
    }),
  ).toThrow('model alias requirement');
  const conflict = structuredClone(first);
  conflict.workflows[0].webhooks![0].config.name = 'Conflicting configuration';
  const before = [
    'workflows',
    'versions',
    'workflowTriggers',
    'variables',
    'variableBindings',
  ].map((c) => target.store.list(c));
  expect(() =>
    importSelection(target, [additional, conflict, first], {
      [secret.id]: { action: 'bind', variableId: secret.id },
    }),
  ).toThrow(/conflict.*webhook/i);
  expect(
    [
      'workflows',
      'versions',
      'workflowTriggers',
      'variables',
      'variableBindings',
    ].map((c) => target.store.list(c)),
  ).toEqual(before);
});
