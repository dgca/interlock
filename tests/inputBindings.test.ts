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

function nodeBindingDefinition(path = '') {
  return definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'decision', kind: 'agent', label: 'Decision', prompt: 'Decide' },
      { id: 'receipt', kind: 'agent', label: 'Receipt', prompt: 'Post' },
      {
        id: 'consume',
        kind: 'agent',
        label: 'Consume',
        prompt: 'Consume',
        maxAttempts: 1,
        inputBindings: {
          decision: { source: 'node', nodeId: 'decision', path },
          receipt: { source: 'input', path: '' },
        },
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'a', source: 'entry', target: 'decision' },
      { id: 'b', source: 'decision', target: 'receipt' },
      { id: 'c', source: 'receipt', target: 'consume' },
      { id: 'd', source: 'consume', target: 'exit' },
    ],
  });
}

function completeWork(
  engine: Engine,
  runId: string,
  output: Parameters<Engine['submit']>[2],
) {
  const work = engine.available(runId)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, output);
}

it.each([{ answer: 42 }, null])(
  'retains earlier output %j across a child invocation and restart/retry',
  (decision) => {
    const store = new Store(':memory:');
    let engine = new Engine(store, process.cwd());
    try {
      const child = engine.create('Child', '', blankDefinition());
      engine.publish(child.id);
      const definition = nodeBindingDefinition();
      definition.nodes[2] = nodeSchema.parse({
        id: 'receipt',
        kind: 'workflow',
        label: 'Receipt',
        workflowId: child.id,
        version: 1,
      });
      const workflow = engine.create('Parent', '', definition);
      engine.publish(workflow.id);
      const run = engine.start(workflow.id, {}).run;
      completeWork(engine, run.id, decision);
      completeWork(engine, run.id, { posted: true });
      const work = engine.available(run.id)[0];
      expect(work.input).toEqual({ decision, receipt: { posted: true } });
      const claim = engine.claim(work.id, {
        workerId: 'test',
        freshContext: false,
        tools: [],
        skills: [],
      });
      engine.reportFailure(work.id, claim.token!, 'Try again');
      engine.stop();
      engine = new Engine(store, process.cwd());
      engine.retry(run.id);
      expect(engine.available(run.id)[0].input).toEqual(work.input);
      completeWork(engine, run.id, work.input);
      expect(engine.run(run.id).output).toEqual(work.input);
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it('selects the latest completed loop visit and nested output path', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const definition = nodeBindingDefinition('values.0');
    definition.nodes.push(
      nodeSchema.parse({
        id: 'check',
        kind: 'condition',
        label: 'Again?',
        path: 'again',
        equals: true,
      }),
    );
    definition.edges[3].target = 'check';
    definition.edges.push(
      { id: 'again', source: 'check', target: 'decision', port: 'true' },
      { id: 'done', source: 'check', target: 'exit', port: 'false' },
    );
    const workflow = engine.create('Loop', '', definition);
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {}).run;
    for (const value of [1, 2]) {
      completeWork(engine, run.id, { values: [value] });
      completeWork(engine, run.id, 'receipt');
      expect(engine.available(run.id)[0].input).toEqual({
        decision: value,
        receipt: 'receipt',
      });
      completeWork(engine, run.id, { again: value === 1 });
    }
    expect(engine.run(run.id).status).toBe('completed');
  } finally {
    engine.stop();
    store.close();
  }
});

it.each(['missing', 'self', 'future'])(
  'fails node bindings with %s output and preserves the failure on retry',
  (scenario) => {
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
    try {
      const definition = nodeBindingDefinition(
        scenario === 'missing' ? 'absent' : '',
      );
      if (scenario === 'self')
        definition.nodes[1].inputBindings = {
          value: { source: 'node', nodeId: 'decision', path: '' },
        };
      if (scenario === 'future')
        definition.nodes[1].inputBindings = {
          value: { source: 'node', nodeId: 'receipt', path: '' },
        };
      const workflow = engine.create('Missing result', '', definition);
      engine.publish(workflow.id);
      const run = engine.start(workflow.id, {}).run;
      if (scenario === 'missing') {
        completeWork(engine, run.id, {});
        completeWork(engine, run.id, {});
      }
      expect(engine.run(run.id).status).toBe('failed');
      const error = engine.run(run.id).error;
      expect(error).toContain(
        scenario === 'missing'
          ? 'Input has no path'
          : 'has no completed output',
      );
      expect(engine.retry(run.id).run).toMatchObject({
        status: 'failed',
        error,
      });
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it.each(['unknown', 'entry', 'exit', 'other-scope'])(
  'allows unresolved drafts but rejects publication referencing %s',
  (target) => {
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
    try {
      const definition = nodeBindingDefinition();
      definition.nodes[3].inputBindings = {
        value: {
          source: 'node',
          nodeId: target === 'other-scope' ? 'decision' : target,
          path: '',
        },
      };
      if (target === 'other-scope') definition.nodes[1].batchId = 'batch';
      const workflow = engine.create('Draft', '', definition);
      expect(() => engine.publish(workflow.id)).toThrow(
        /node binding must reference/,
      );
    } finally {
      engine.stop();
      store.close();
    }
  },
);

it.each([1, 2])(
  'isolates node results between concurrent items at Batch depth %i',
  async (depth) => {
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
    try {
      const definition = nestedBatches(
        depth,
        itemScript('return { value: input };'),
      );
      const owner = definition.nodes.find((n) => n.id === 'work')!.batchId!;
      definition.nodes.push(
        nodeSchema.parse({
          id: 'consume',
          kind: 'script',
          label: 'Read earlier',
          batchId: owner,
          language: 'javascript',
          command: 'return input.value;',
          inputBindings: {
            value: { source: 'node', nodeId: 'work', path: 'value' },
          },
        }),
      );
      definition.edges.find((e) => e.source === 'work')!.source = 'consume';
      definition.edges.push({
        id: 'after-work',
        source: 'work',
        target: 'consume',
        port: 'default',
      });
      const workflow = engine.create('Isolated items', '', definition);
      engine.publish(workflow.id);
      const input =
        depth === 1
          ? [1, 2, 3]
          : [
              [1, 2],
              [3, 4],
            ];
      const run = engine.start(workflow.id, input).run;
      await vi.waitFor(() =>
        expect(engine.run(run.id).status).toBe('completed'),
      );
      expect(engine.run(run.id).output).toEqual(input);
    } finally {
      engine.stop();
      store.close();
    }
  },
);
