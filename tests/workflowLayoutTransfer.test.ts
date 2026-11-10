import { afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowPositions } from '@interlock/core';
import { workflowBundleSchema } from '../packages/core/src/transfer';
import {
  diffBundleImport,
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { importSelection } from '../packages/runtime/src/importSelection';
import {
  persistWorkflowPositions,
  readWorkflowLayout,
} from '../packages/runtime/src/workflowLayouts';
import { definitionHash } from '../packages/runtime/src/versionIdentity';

const environments: { engine: Engine; store: Store }[] = [];
function environment() {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  environments.push({ engine, store });
  return { engine, store };
}
afterEach(() => {
  for (const { engine, store } of environments.splice(0)) {
    engine.stop();
    store.close();
  }
});

it('round trips saved positions in the existing bundle shape without rewriting published versions', () => {
  const source = environment();
  const target = environment();
  const workflow = source.engine.create('Layout export');
  source.engine.publish(workflow.id);
  const published = source.store.getVersion(workflow.id, 1)!;
  const publishedHash = definitionHash(published.definition);
  const nodeId = workflow.draft.nodes[0].id;
  persistWorkflowPositions(source.store, workflow.id, {
    [nodeId]: { x: 1200, y: -250 },
  });
  const bundle = exportWorkflows(source.store, workflow.id);
  expect(bundle.formatVersion).toBe(1);
  expect(
    workflowBundleSchema.parse(JSON.parse(JSON.stringify(bundle))),
  ).toEqual(bundle);
  expect(bundle.workflows[0]).not.toHaveProperty('editorLayout');
  expect(bundle.workflows[0]).not.toHaveProperty('layoutRevision');
  expect(bundle.workflows[0].draft.nodes[0].position).toEqual({
    x: 1200,
    y: -250,
  });
  expect(bundle.workflows[0].versions[0].definition).toEqual(
    published.definition,
  );
  expect(
    definitionHash(source.store.getVersion(workflow.id, 1)!.definition),
  ).toBe(publishedHash);
  importWorkflows(target.store, bundle);
  expect(
    readWorkflowLayout(target.store, workflow.id).positions[nodeId],
  ).toEqual({
    x: 1200,
    y: -250,
  });
  expect(exportWorkflows(target.store, workflow.id)).toEqual(bundle);

  const override = structuredClone(workflow.draft);
  override.nodes[0].position = { x: 1700, y: 90 };
  const draftExport = exportWorkflows(source.store, workflow.id, {
    name: workflow.name,
    description: workflow.description,
    draft: override,
  });
  expect(draftExport.workflows[0].draft.nodes[0].position).toEqual({
    x: 1700,
    y: 90,
  });
  expect(
    readWorkflowLayout(source.store, workflow.id).positions[nodeId],
  ).toEqual({
    x: 1200,
    y: -250,
  });
});

it('imports position-only changes without draft conflict, content revision or timestamp changes', () => {
  const source = environment();
  const target = environment();
  const workflow = source.engine.create('Layout import');
  source.engine.publish(workflow.id);
  const bundle = exportWorkflows(source.store, workflow.id);
  importWorkflows(target.store, bundle);
  const before = target.store.workflows();
  const layoutBefore = readWorkflowLayout(target.store, workflow.id);
  bundle.workflows[0].draft.nodes[0].position = { x: 2000, y: 500 };
  const preview = diffBundleImport(target.store, bundle);
  expect(preview.workflows[0].status).toBe('unchanged');
  expect(readWorkflowLayout(target.store, workflow.id)).toEqual(layoutBefore);
  expect(importWorkflows(target.store, bundle).changed).toEqual([workflow.id]);
  expect(target.store.workflows()).toEqual(before);
  expect(exportWorkflows(target.store, workflow.id).workflows[0].draft).toEqual(
    bundle.workflows[0].draft,
  );
  expect(importWorkflows(target.store, bundle).changed).toEqual([]);

  bundle.workflows[0].draft.nodes[0].label = 'A content edit';
  expect(() => importWorkflows(target.store, bundle)).toThrow('Draft conflict');
  expect(target.store.workflows()).toEqual(before);
  bundle.workflows[0].draft.nodes[0].label = workflow.draft.nodes[0].label;
  bundle.workflows[0].versions[0].definition.nodes[0].position.x += 1;
  expect(() => importWorkflows(target.store, bundle, { force: true })).toThrow(
    'Published version conflict',
  );
});

it.each([false, true])(
  'keeps identical existing-workflow imports idempotent with a partial layout: %s',
  (partialLayout) => {
    const { engine, store } = environment();
    const workflow = engine.create('Existing layout');
    engine.publish(workflow.id);
    // Existing databases may have no layout record, or only moved-node entries.
    store.remove('workflowLayouts', workflow.id);
    if (partialLayout)
      persistWorkflowPositions(store, workflow.id, {
        [workflow.draft.nodes[0].id]: { x: 500, y: 700 },
      });
    const bundle = exportWorkflows(store, workflow.id);
    const beforeWorkflow = store.workflows();
    const beforeLayout = store.list('workflowLayouts');
    expect(importWorkflows(store, bundle).changed).toEqual([]);
    expect(store.workflows()).toEqual(beforeWorkflow);
    expect(store.list('workflowLayouts')).toEqual(beforeLayout);
    expect(exportWorkflows(store, workflow.id)).toEqual(bundle);
  },
);

it('keeps old bundle formats and legacy files readable with embedded positions', () => {
  const source = environment();
  const workflow = source.engine.create('Old layout');
  const original = exportWorkflows(source.store, workflow.id);
  original.workflows[0].draft.nodes[0].position = { x: -100, y: 900 };
  for (let formatVersion = 1; formatVersion <= 10; formatVersion++) {
    const target = environment();
    const bundle = workflowBundleSchema.parse({ ...original, formatVersion });
    importWorkflows(target.store, bundle);
    expect(
      exportWorkflows(target.store, workflow.id).workflows[0].draft,
    ).toEqual(bundle.workflows[0].draft);
  }
  const target = environment();
  const legacy = {
    name: 'Legacy single workflow',
    definition: original.workflows[0].draft,
  };
  const imported = importSelection(target.engine, [legacy]);
  expect(
    workflowPositions(
      exportWorkflows(target.store, imported.rootIds[0]).workflows[0].draft,
    ),
  ).toEqual(workflowPositions(legacy.definition));
});

it('retains legacy node IDs without introducing a new length restriction during import', () => {
  const source = environment();
  const target = environment();
  const workflow = source.engine.create('Legacy long node ID');
  const bundle = exportWorkflows(source.store, workflow.id);
  const definition = bundle.workflows[0].draft;
  const oldId = definition.nodes[0].id;
  const longId = 'legacy-node-'.repeat(100);
  definition.nodes[0].id = longId;
  definition.nodes[0].position = { x: 120, y: 240 };
  definition.edges = definition.edges.map((edge) => ({
    ...edge,
    source: edge.source === oldId ? longId : edge.source,
    target: edge.target === oldId ? longId : edge.target,
  }));
  importWorkflows(target.store, bundle);
  expect(
    readWorkflowLayout(target.store, workflow.id).positions[longId],
  ).toEqual({
    x: 120,
    y: 240,
  });
  expect(exportWorkflows(target.store, workflow.id).workflows[0].draft).toEqual(
    definition,
  );
});

it('rolls back layout writes when a later workflow has a published-version conflict', () => {
  const source = environment();
  const target = environment();
  const parent = source.engine.create('Owner');
  const child = source.engine.create('Child', '', undefined, parent.id);
  source.engine.publish(child.id);
  const bundle = exportWorkflows(source.store, parent.id);
  importWorkflows(target.store, bundle);
  const layoutsBefore = target.store.list('workflowLayouts');
  const workflowsBefore = target.store.workflows();
  bundle.workflows[0].draft.nodes[0].position = { x: 600, y: 450 };
  bundle.workflows.find(
    (entry) => entry.id === child.id,
  )!.versions[0].definition.nodes[0].label = 'Immutable conflict';
  expect(() => importWorkflows(target.store, bundle)).toThrow(
    'Published version conflict',
  );
  expect(target.store.list('workflowLayouts')).toEqual(layoutsBefore);
  expect(target.store.workflows()).toEqual(workflowsBefore);
});

it('combines selections differing only in draft layout while retaining strict published identity', () => {
  const source = environment();
  const target = environment();
  const workflow = source.engine.create('Selected layout');
  source.engine.publish(workflow.id);
  const first = exportWorkflows(source.store, workflow.id);
  const second = structuredClone(first);
  second.workflows[0].draft.nodes[0].position = { x: 600, y: 450 };
  expect(importSelection(target.engine, [first, second]).rootIds).toEqual([
    workflow.id,
    workflow.id,
  ]);
  expect(exportWorkflows(target.store, workflow.id).workflows[0].draft).toEqual(
    first.workflows[0].draft,
  );
  second.workflows[0].versions[0].definition.nodes[0].position.x += 1;
  expect(() => importSelection(target.engine, [first, second])).toThrow(
    'Selected files conflict for published version',
  );
});

it('preserves deletion identities and restores original published snapshots after layout updates', () => {
  const source = environment();
  const target = environment();
  const workflow = source.engine.create('Cleanup layout');
  source.engine.publish(workflow.id);
  source.engine.publish(workflow.id);
  const backup = exportWorkflows(source.store, workflow.id);
  const original = source.store.getVersion(workflow.id, 1)!.definition;
  persistWorkflowPositions(source.store, workflow.id, {
    [workflow.draft.nodes[0].id]: { x: 900, y: 700 },
  });
  const versions = [{ workflowId: workflow.id, version: 1 }];
  const preview = source.engine.versions.preview({ versions });
  source.engine.versions.delete({
    versions,
    confirmation: preview.confirmation,
    acknowledgeHistoryLoss: true,
  });
  const cleaned = exportWorkflows(source.store, workflow.id);
  expect(cleaned.workflows[0].deletedVersions![0].definitionHash).toBe(
    definitionHash(original),
  );
  importWorkflows(target.store, cleaned);
  expect(
    importWorkflows(target.store, backup, { restoreDeletedVersions: true })
      .restoredVersions,
  ).toEqual(versions);
  expect(target.store.getVersion(workflow.id, 1)!.definition).toEqual(original);
});
