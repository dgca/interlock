import { expect, it } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, runQuerySchema } from '@interlock/core';

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
