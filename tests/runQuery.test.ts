import { expect, it } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { batchDefinition } from './fixtures/batch';
import { blankDefinition, nodeSchema, runQuerySchema } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

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

it('pages runs.find and runs.list by the last run ID without gaps or repeats', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    // Equal creation times are ordered by storage position, as without paging.
    const times = ['01', '02', '02', '02', '03', '01', '04'];
    times.forEach((day, index) =>
      store.put('runs', {
        id: `run-${index}`,
        workflowId: index % 2 ? 'odd' : 'even',
        workflowName: 'Paged',
        version: 1,
        status: 'completed',
        createdAt: `2026-01-${day}T00:00:00.000Z`,
        updatedAt: `2026-01-${day}T00:00:00.000Z`,
        cursor: 'exit',
        value: null,
        input: { index },
        executions: [{ id: `step-${index}`, nodeId: 'exit' }],
      }),
    );
    const { runs } = appRouter.createCaller({ engine });
    const pages = async <T extends { id: string }>(
      read: (after?: string) => Promise<T[]>,
    ) => {
      const ids: string[] = [];
      // The bound stops a cursor that fails to advance.
      for (let page = await read(); page.length && ids.length < 20;) {
        ids.push(...page.map((run) => run.id));
        page = await read(page.at(-1)!.id);
      }
      return ids;
    };

    const whole = await runs.list();
    expect(whole.map((run) => run.id)).toEqual(
      times.map((_, index) => `run-${6 - index}`),
    );
    expect(whole[0].executions).toEqual([{ id: 'step-6', nodeId: 'exit' }]);
    expect(
      await pages((after) => runs.list({ limit: 3, afterRunId: after })),
    ).toEqual(whole.map((run) => run.id));

    const newest = (await runs.find({ limit: 1000 })).map((run) => run.id);
    expect(newest).toEqual([
      'run-6',
      'run-4',
      'run-3',
      'run-2',
      'run-1',
      'run-5',
      'run-0',
    ]);
    expect(
      await pages((after) => runs.find({ limit: 2, afterRunId: after })),
    ).toEqual(newest);
    expect(
      await pages((after) =>
        runs.find({ workflowId: 'odd', limit: 1, afterRunId: after }),
      ),
    ).toEqual(['run-3', 'run-1', 'run-5']);
    await expect(runs.find({ afterRunId: 'missing' })).rejects.toThrow(
      'not retained',
    );
  } finally {
    engine.stop();
    store.close();
  }
});
