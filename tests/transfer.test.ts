import { expect, it } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, nodeSchema } from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

function createBuildBoard(engine: Engine) {
  return engine.boards.save({
    name: 'Delivery',
    columns: [{ name: 'Build' }],
    workflowIds: [],
  });
}

function publishBoardWorkflow(engine: Engine) {
  const board = createBuildBoard(engine);
  const definition = blankDefinition();
  definition.nodes[1].boardColumnId = board.columns[0].id;
  const workflow = engine.create('Build workflow', '', definition);
  engine.publish(workflow.id);
  engine.boards.assign({
    workflowId: workflow.id,
    boardId: board.id,
    expectedBoardId: null,
  });
  return { workflowId: workflow.id, boardId: board.id };
}

it.each(['unchanged', 'changed'] as const)(
  'preserves board membership on %s portable reimports',
  (change) => {
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
    try {
      const { workflowId, boardId } = publishBoardWorkflow(engine);
      const runId = engine.start(workflowId, {}).run.id;
      const run = engine.run(runId);
      const events = engine.inspect(runId).events;
      const versions = store.listVersions(workflowId);
      const board = engine.boards.settings(boardId);
      const workflow = engine.workflow(workflowId);
      const bundle = exportWorkflows(store, workflowId);
      if (change === 'changed')
        bundle.workflows[0].draft.nodes[1].label = 'Revised step';

      const result = importWorkflows(store, bundle, {
        draftRevisions: { [workflowId]: workflow.draftRevision },
      });

      expect(result.changed).toEqual(change === 'changed' ? [workflowId] : []);
      expect(engine.workflow(workflowId)).toMatchObject({
        boardId,
        draft: bundle.workflows[0].draft,
        draftRevision: workflow.draftRevision + (change === 'changed' ? 1 : 0),
      });
      expect(engine.boards.settings(boardId)).toEqual(board);
      expect(store.listVersions(workflowId)).toEqual(versions);
      expect(engine.run(runId)).toEqual(run);
      expect(engine.inspect(runId).events).toEqual(events);
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it('leaves a newly imported workflow unassigned even when the destination board names match', () => {
  const source = new Store(':memory:');
  const target = new Store(':memory:');
  const engine = new Engine(source, process.cwd());
  const destination = new Engine(target, process.cwd());
  try {
    const { workflowId } = publishBoardWorkflow(engine);
    const board = createBuildBoard(destination);
    const settings = destination.boards.settings(board.id);

    expect(
      importWorkflows(target, exportWorkflows(source, workflowId)).changed,
    ).toEqual([workflowId]);
    expect(destination.workflow(workflowId).boardId).toBeUndefined();
    expect(destination.boards.settings(board.id)).toEqual(settings);
  } finally {
    engine.stop();
    destination.stop();
    source.close();
    target.close();
  }
});

it('preserves ownership and archive state, and rolls back invalid published bundles', () => {
  const source = new Store(':memory:'),
    target = new Store(':memory:');
  const engine = new Engine(source, process.cwd());
  try {
    const parent = engine.create('Owner');
    const child = engine.create('Owned', '', undefined, parent.id);
    engine.publish(child.id);
    const bundle = exportWorkflows(source, parent.id);
    importWorkflows(target, bundle);
    const local = new Engine(target, process.cwd());
    try {
      local.update(parent.id, { archived: true });
      expect(importWorkflows(target, bundle).changed).toEqual([]);
      expect(local.workflow(parent.id).archived).toBe(true);
      expect(local.workflow(child.id).ownerWorkflowId).toBe(parent.id);
      expect(exportWorkflows(source, child.id).workflows).toHaveLength(2);
      const changed = structuredClone(bundle);
      changed.workflows.find((w) => w.id === child.id)!.ownerWorkflowId = null;
      expect(() => importWorkflows(target, changed, { force: true })).toThrow(
        'Ownership conflict',
      );
      const invalid = structuredClone(bundle);
      invalid.workflows
        .find((w) => w.id === child.id)!
        .versions.push({
          version: 2,
          definition: { ...blankDefinition(), edges: [] },
        });
      const before = target.workflows();
      expect(() => importWorkflows(target, invalid)).toThrow();
      expect(target.workflows()).toEqual(before);
      expect(target.getVersion(child.id, 2)).toBeUndefined();
    } finally {
      local.stop();
    }
  } finally {
    engine.stop();
    source.close();
    target.close();
  }
});

it('round trips dependencies and pins, upserts drafts, and rolls back conflicts', () => {
  const a = new Store(':memory:'),
    b = new Store(':memory:');
  const engine = new Engine(a, process.cwd());
  try {
    const child = engine.create('Shared');
    engine.publish(child.id);
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Shared',
      workflowId: child.id,
      version: 1,
    });
    const parent = engine.create('Parent', '', definition);
    engine.publish(parent.id);
    const bundle = exportWorkflows(a, parent.id);
    expect(bundle.workflows).toHaveLength(2);
    expect(importWorkflows(b, bundle).changed).toHaveLength(2);
    expect(importWorkflows(b, bundle).changed).toEqual([]);
    expect(b.getVersion(parent.id, 1)!.definition).toEqual(
      a.getVersion(parent.id, 1)!.definition,
    );
    bundle.workflows[0].name = 'Renamed';
    expect(() => importWorkflows(b, bundle)).toThrow('Draft conflict');
    expect(
      importWorkflows(b, bundle, { draftRevisions: { [parent.id]: 1 } })
        .changed,
    ).toEqual([parent.id]);
    expect(importWorkflows(b, bundle).changed).toEqual([]);
    const before = b.workflows();
    bundle.workflows[0].name = 'Must rollback';
    bundle.workflows[1].versions[0].definition.nodes[1].label = 'Conflict';
    expect(() => importWorkflows(b, bundle, { force: true })).toThrow(
      'Published version conflict',
    );
    expect(b.workflows()).toEqual(before);
    const target = new Engine(b, process.cwd());
    try {
      const run = target.start(parent.id, { hello: 'world' }).run;
      expect(target.available(run.id)).toHaveLength(1);
      expect(target.available(run.id)[0].input).toEqual({ hello: 'world' });
    } finally {
      target.stop();
    }
  } finally {
    engine.stop();
    a.close();
    b.close();
  }
});
