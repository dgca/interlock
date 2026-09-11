import { expect, it } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { batchDefinition } from './fixtures/batch';
import { blankDefinition, nodeSchema, runQuerySchema } from '@interlock/core';

it('finds bounded summaries with structural input matching and ancestry filters', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const workflow = engine.create('Lookup', '', blankDefinition());
    engine.publish(workflow.id);
    const first = engine.start(workflow.id, { key: { a: 1, b: [2] } }).run;
    const second = engine.start(workflow.id, { key: null }).run;
    const third = engine.start(workflow.id, {}).run;
    store.put('runs', { ...third, parentRunId: first.id });
    const query = (value: unknown) =>
      store.findRuns(runQuerySchema.parse(value));
    expect(
      query({
        workflowId: workflow.id,
        status: 'waiting',
        rootOnly: true,
        limit: 1,
      }).map((r) => r.id),
    ).toEqual([second.id]);
    expect(
      query({ inputMatch: { path: 'key', equals: { b: [2], a: 1 } } }).map(
        (r) => r.id,
      ),
    ).toEqual([first.id]);
    expect(
      query({ inputMatch: { path: 'key', equals: null } }).map((r) => r.id),
    ).toEqual([second.id]);
    expect(query({ workflowId: 'missing' })).toEqual([]);
    expect(query({})[0]).not.toHaveProperty('executions');
    expect(query({ status: 'running' })).toEqual([]);
  } finally {
    engine.stop();
    store.close();
  }
});

it('derives ancestry through nested Batch and Workflow runs without rewriting old records', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const leaf = engine.create('Leaf', '', blankDefinition());
    engine.publish(leaf.id);
    const middleDefinition = batchDefinition(
      nodeSchema.parse({
        id: 'invoke',
        label: 'Invoke',
        kind: 'workflow',
        workflowId: leaf.id,
        version: 1,
      }),
    );
    const middle = engine.create('Middle', '', middleDefinition);
    engine.publish(middle.id);
    const outer = engine.create(
      'Outer',
      '',
      batchDefinition(
        nodeSchema.parse({
          id: 'invoke',
          label: 'Invoke',
          kind: 'workflow',
          workflowId: middle.id,
          version: 1,
        }),
      ),
    );
    engine.publish(outer.id);
    const root = engine.start(outer.id, [[1, 2], [3]]).run;
    const records = store.runs();
    // Runs have no persisted root identity, including records written by older releases.
    expect(records.every((run) => !('rootRunId' in run))).toBe(true);
    const work = engine.workSummaries();
    const afterDiscovery = store.runs();
    expect(work).toHaveLength(3);
    for (const assignment of work) {
      expect(assignment).toMatchObject({
        workflowId: leaf.id,
        rootRunId: root.id,
        rootWorkflowId: outer.id,
      });
      expect(assignment.parentRunId).not.toBe(root.id);
      expect(assignment).not.toHaveProperty('input');
    }
    const runs = store.findRuns(runQuerySchema.parse({}));
    for (const run of runs) {
      expect(run).toMatchObject({
        rootRunId: root.id,
        rootWorkflowId: outer.id,
      });
      expect(run).not.toHaveProperty('executions');
    }
    expect(runs.find((run) => run.id === root.id)?.parentRunId).toBeUndefined();
    expect(store.runs()).toEqual(afterDiscovery);
  } finally {
    engine.stop();
    store.close();
  }
});
