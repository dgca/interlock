import { expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { definitionSchema, blankDefinition, nodeSchema } from '@interlock/core';
import { batchDefinition, nestedBatches, itemScript } from './fixtures/batch';

it('does not bypass failed Batch bindings when retrying before dispatch', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const definition = batchDefinition();
    definition.nodes.find((n) => n.id === 'batch')!.inputBindings = {
      selected: { source: 'input', path: 'missing' },
    };
    const workflow = engine.create('Invalid bindings', '', definition);
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, []).run;
    expect(run.status).toBe('failed');
    expect(engine.retry(run.id).run).toMatchObject({
      status: 'failed',
      error: 'Input has no path "missing"',
    });
    expect(engine.inspect(run.id).children).toHaveLength(0);
  } finally {
    engine.stop();
    store.close();
  }
});

it('distinguishes workflow and root inputs through nested Batches and workflow invocations', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const script = itemScript('return input;');
    script.inputBindings = {
      run: { source: 'runInput', path: 'scope' },
      root: { source: 'rootInput', path: 'scope' },
      item: { source: 'itemInput', path: '' },
    };
    const childDefinition = nestedBatches(2, script);
    const batch = childDefinition.nodes.find((n) => n.id === 'batch')!;
    if (batch.kind !== 'batch') throw new Error('Expected Batch');
    batch.itemsPath = 'items';
    const child = engine.create('Child', '', childDefinition);
    engine.publish(child.id);
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Invoke',
      workflowId: child.id,
      version: 1,
      inputBindings: {
        scope: { source: 'input', path: 'childScope' },
        items: { source: 'input', path: 'items' },
      },
    });
    const parent = engine.create('Parent', '', definition);
    engine.publish(parent.id);
    const run = engine.start(parent.id, {
      scope: 'root',
      childScope: 'child',
      items: [[7]],
    }).run;
    await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
    expect(engine.run(run.id).output).toEqual([
      [{ run: 'child', root: 'root', item: 7 }],
    ]);
  } finally {
    engine.stop();
    store.close();
  }
});

it('retries bindings against the original incoming input after persistence', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const definition = blankDefinition();
    const agent = definition.nodes[1];
    if (agent.kind !== 'agent') throw new Error('Expected agent');
    agent.maxAttempts = 1;
    agent.inputBindings = { selected: { source: 'input', path: 'payload' } };
    const workflow = engine.create('Retry bindings', '', definition);
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, { payload: 42 }).run;
    const work = engine.available(run.id)[0];
    const claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    expect(work.input).toEqual({ selected: 42 });
    engine.reportFailure(work.id, claim.token!, 'Retry me');
    engine.retry(run.id);
    expect(engine.available(run.id)[0].input).toEqual({ selected: 42 });
  } finally {
    engine.stop();
    store.close();
  }
});

it('keeps workflow configuration and original items independent of agent results', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const definition = batchDefinition(undefined, { itemsPath: 'items' });
    definition.nodes.push(
      definitionSchema.parse({
        nodes: [
          { id: 'e', kind: 'entry', label: 'e' },
          {
            id: 'check',
            kind: 'script',
            label: 'Check',
            batchId: 'batch',
            language: 'javascript',
            command: 'return input;',
            inputBindings: {
              result: { source: 'input', path: '' },
              dryRun: { source: 'runInput', path: 'dryRun' },
              original: { source: 'itemInput', path: '' },
              root: { source: 'rootInput', path: 'dryRun' },
            },
          },
        ],
        edges: [],
      }).nodes[1],
    );
    definition.edges.find((edge) => edge.id === 'end')!.source = 'check';
    definition.edges.push({
      id: 'after',
      source: 'work',
      target: 'check',
      port: 'default',
    });
    const workflow = engine.create('Bound inputs', '', definition);
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {
      dryRun: true,
      items: [{ id: 7 }],
    }).run;
    const work = engine.available(run.id)[0];
    const claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(work.id, claim.token!, { dryRun: false, answer: 'changed' });
    await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
    expect(engine.run(run.id).output).toEqual([
      {
        result: { dryRun: false, answer: 'changed' },
        dryRun: true,
        original: { id: 7 },
        root: true,
      },
    ]);
  } finally {
    engine.stop();
    store.close();
  }
});
