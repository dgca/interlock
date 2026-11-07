import { afterEach, beforeEach, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import {
  blankDefinition,
  eventConfigSchema,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { exportWorkflows } from '../packages/runtime/src/transfer';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

let store: Store;
let engine: Engine;
let server: ServerType;
let url: string;

beforeEach(async () => {
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  server = serve({
    fetch: createApp(engine).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  url = `http://127.0.0.1:${address.port}`;
  process.env.INTERLOCK_URL = url;
});

afterEach(async () => {
  delete process.env.INTERLOCK_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  engine.stop();
  store.close();
});

function createWorkflowWithCall(
  name: string,
  childId?: string,
): { id: string; draft: WorkflowDefinition } {
  const draft = blankDefinition();
  if (childId) {
    draft.nodes.splice(
      1,
      1,
      nodeSchema.parse({
        id: 'call-0',
        kind: 'workflow',
        label: 'Call Child',
        workflowId: childId,
        version: 1,
      }),
    );
    draft.edges = [
      {
        id: 'edge-0',
        port: 'default',
        source: draft.nodes[0].id,
        target: 'call-0',
      },
      {
        id: 'edge-1',
        port: 'default',
        source: 'call-0',
        target: draft.nodes[2].id,
      },
    ];
  }
  const w = engine.create(name, '', draft);
  engine.publish(w.id);
  return { id: w.id, draft };
}

it('interlock import --dry-run performs semantic diff against published definitions and ignores layout and key order', async () => {
  const child = createWorkflowWithCall('Child');
  const root = createWorkflowWithCall('Root', child.id);

  // Export bundle
  const bundle = exportWorkflows(store, root.id);

  // Modify root in bundle: change prompt, change maxSteps, but also alter node positions (layout) and key order
  const rootEntry = bundle.workflows.find((w) => w.id === root.id)!;
  const agentNode = rootEntry.draft.nodes.find((n) => n.id === 'call-0')!;

  // Modify layout positions (should be ignored in semantic diff)
  agentNode.position = { x: 999, y: 888 };
  rootEntry.draft.nodes[0].position = { x: 123, y: 456 };

  // Modify inputSchema key order (should be ignored in semantic diff)
  rootEntry.draft.inputSchema = {
    b: 'second',
    a: 'first',
  };

  // Add a semantic change: add a node, change maxSteps, change pinPromptsAtPublish
  rootEntry.draft.maxSteps = 42;
  rootEntry.draft.pinPromptsAtPublish = true;

  const countBeforeWorkflows = store.workflows().length;
  const countBeforeVersions = store.listVersions().length;

  // Run CLI import --dry-run
  const result = (await runCommand([
    'import',
    JSON.stringify(bundle),
    '--dry-run',
  ])) as any;

  // Verify dry-run output
  expect(result.dryRun).toBe(true);
  expect(result.rootId).toBe(root.id);

  const rootDiff = result.workflows.find((w: any) => w.id === root.id);
  expect(rootDiff.status).toBe('changed');
  expect(rootDiff.diff.firstPublication).toBe(false);
  expect(rootDiff.diff.workflow).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'inputSchema' }),
      expect.objectContaining({ id: 'maxSteps' }),
      expect.objectContaining({ id: 'pinPromptsAtPublish' }),
    ]),
  );

  // Child was unchanged semantically (and unchanged in bundle)
  const childDiff = result.workflows.find((w: any) => w.id === child.id);
  expect(childDiff.status).toBe('unchanged');
  expect(childDiff.diff.nodes).toHaveLength(0);
  expect(childDiff.diff.routes).toHaveLength(0);
  expect(childDiff.diff.workflow).toHaveLength(0);

  // Verify store was completely unmutated by the dry-run
  expect(store.workflows().length).toBe(countBeforeWorkflows);
  expect(store.listVersions().length).toBe(countBeforeVersions);
  expect(engine.workflow(root.id).draft.maxSteps).toBe(100);
});

it('interlock import --publish --cascade imports and atomically publishes workflows in topological order', async () => {
  const child = createWorkflowWithCall('Child');
  const root = createWorkflowWithCall('Root', child.id);

  // Export bundle
  const bundle = exportWorkflows(store, root.id);

  // Modify drafts for both child and root
  const childEntry = bundle.workflows.find((w) => w.id === child.id)!;
  const childAgent = childEntry.draft.nodes.find((n) => n.kind === 'agent')!;
  childAgent.prompt = 'Updated child instructions';

  const rootEntry = bundle.workflows.find((w) => w.id === root.id)!;
  rootEntry.draft.maxSteps = 55;

  // Run CLI import with --publish --cascade
  const result = (await runCommand([
    'import',
    JSON.stringify(bundle),
    '--publish',
    '--cascade',
    '--force',
  ])) as any;

  expect(result.published).toBeDefined();
  expect(result.published).toHaveLength(2);

  // Both workflows should now be at latestVersion 2
  expect(engine.workflow(child.id).latestVersion).toBe(2);
  expect(engine.workflow(root.id).latestVersion).toBe(2);

  // In Root version 2, its call node version must have cascaded to version 2!
  const rootV2 = store.getVersion(root.id, 2)!;
  const callNode = rootV2.definition.nodes.find((n) => n.kind === 'workflow')!;
  expect(callNode.version).toBe(2);
  expect(rootV2.definition.maxSteps).toBe(55);

  // Old versions remain preserved
  expect(store.getVersion(child.id, 1)!.version).toBe(1);
  expect(store.getVersion(root.id, 1)!.version).toBe(1);
  expect(
    store
      .getVersion(root.id, 1)!
      .definition.nodes.find((n) => n.kind === 'workflow')!.version,
  ).toBe(1);
});

it('interlock import --publish --cascade rolls back completely when a cycle is introduced', async () => {
  const child = createWorkflowWithCall('Child');
  const root = createWorkflowWithCall('Root', child.id);

  const bundle = exportWorkflows(store, root.id);

  // Introduce cycle: Child calls Root
  const childEntry = bundle.workflows.find((w) => w.id === child.id)!;
  childEntry.draft.nodes[1] = nodeSchema.parse({
    id: 'call-root',
    kind: 'workflow',
    label: 'Call Root',
    workflowId: root.id,
    version: 1,
  });

  const childBefore = engine.workflow(child.id);
  const rootBefore = engine.workflow(root.id);

  await expect(
    runCommand([
      'import',
      JSON.stringify(bundle),
      '--publish',
      '--cascade',
      '--force',
    ]),
  ).rejects.toThrow(/dependency cycle/);

  // Verify rollback: versions and drafts are untouched
  expect(engine.workflow(child.id).latestVersion).toBe(
    childBefore.latestVersion,
  );
  expect(engine.workflow(root.id).latestVersion).toBe(rootBefore.latestVersion);
  expect(store.getVersion(child.id, 2)).toBeUndefined();
  expect(store.getVersion(root.id, 2)).toBeUndefined();
});

it('previews and publishes portable event triggers through bundle sync without mutating a dry-run', async () => {
  const source = createWorkflowWithCall('Event source');
  const handler = createWorkflowWithCall('Event handler');
  const trigger = engine.triggers.mutate({
    action: 'create',
    workflowId: handler.id,
    config: eventConfigSchema.parse({
      kind: 'event',
      name: 'Original event',
      events: ['completed'],
      scope: { type: 'workflow', workflowId: source.id },
    }),
  }).trigger!;
  engine.triggers.mutate({
    action: 'enable',
    id: trigger.id,
    expectedRevision: trigger.revision,
  });
  const bundle = exportWorkflows(store, handler.id);
  expect(bundle.formatVersion).toBe(8);
  expect(bundle.workflows.some((w) => w.id === source.id)).toBe(true);
  bundle.workflows.find(
    (w) => w.id === handler.id,
  )!.eventTriggers![0].config.name = 'Changed event';
  const protectedState = () =>
    Object.fromEntries(
      [
        'workflows',
        'versions',
        'workflowTriggers',
        'runs',
        'work',
        'events',
        'eventDeliveries',
        'eventTriggerReceipts',
        'prompts',
        'promptRevisions',
      ].map((collection) => [collection, store.list(collection)]),
    );
  const before = protectedState();
  const preview = (await runCommand([
    'import',
    JSON.stringify(bundle),
    '--dry-run',
  ])) as any;
  expect(preview.triggers).toEqual([
    expect.objectContaining({
      id: trigger.id,
      kind: 'event',
      status: 'changed',
    }),
  ]);
  expect(protectedState()).toEqual(before);
  const result = (await runCommand([
    'import',
    JSON.stringify(bundle),
    '--force',
    '--publish',
    '--cascade',
  ])) as any;
  expect(result.published.map((w: any) => w.id).sort()).toEqual(
    [handler.id, source.id].sort(),
  );
  expect(engine.triggers.inspect(trigger.id).trigger).toMatchObject({
    kind: 'event',
    name: 'Changed event',
    enabled: false,
  });
});
