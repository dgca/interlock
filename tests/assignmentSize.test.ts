import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  measureAssignment,
  nodeSchema,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition, itemAgent } from './fixtures/batch';
const engines: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', tools: [], skills: [], freshContext: true };
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function publish(e: Engine, d = blankDefinition()) {
  const w = e.create('Size', '', d);
  e.publish(w.id);
  return w.id;
}
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
it('counts serialized UTF-8 values and bounds field/repetition diagnostics without values', () => {
  const value = {
    emoji: '🌿',
    quote: '"',
    secret: 's'.repeat(300),
    again: 's'.repeat(300),
  };
  const report = measureAssignment(
    { input: { state: 'known', value }, prompt: { state: 'absent' } },
    1,
  );
  expect(report.totalBytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(report.components.prompt.bytes).toBe(0);
  expect(report.warnings).toEqual(['large_assignment']);
  expect(report.repetition).toEqual({ groups: 1, repeatedBytes: 302 });
  expect(JSON.stringify(report)).not.toContain('s'.repeat(100));
  const large = measureAssignment(
    {
      input: {
        state: 'known',
        value: Object.fromEntries(
          Array.from({ length: 20000 }, (_, i) => [
            'field' + i,
            'x'.repeat(100),
          ]),
        ),
      },
    },
    100000,
  );
  expect(large.largeFields).toHaveLength(10);
  expect(large.diagnosticsTruncated).toBe(true);
  expect(JSON.stringify(large).length).toBeLessThan(3000);
});
it('measures the exact captured assignment without claiming, including saved prompts and fresh instructions', () => {
  const e = setup(),
    d = blankDefinition();
  const p = e.prompts.create({
    name: 'Guide',
    description: '',
    content: '秘密'.repeat(1000),
  });
  if (d.nodes[1].kind === 'agent') {
    d.nodes[1].promptIds = [p.id];
    d.nodes[1].context.mode = 'fresh';
  }
  const id = publish(e, d),
    run = e.start(id, { value: '🌿' }).run,
    w = e.available(run.id)[0];
  const before = e.inspect(run.id),
    report = e.assignmentSizes.read({ workId: w.id, warningBytes: 1 });
  expect(e.inspect(run.id)).toEqual(before);
  const keys = [
    'prompt',
    'context',
    'input',
    'outputSchema',
    'executionInstructions',
    'savedPrompts',
  ] as const;
  const expected = keys.reduce(
    (sum, key) =>
      sum +
      (w[key] === undefined ? 0 : Buffer.byteLength(JSON.stringify(w[key]))),
    0,
  );
  expect(report.totalBytes).toBe(expected);
  e.prompts.update(p.id, p.revision, {
    name: p.name,
    description: '',
    content: 'Changed',
  });
  expect(e.assignmentSizes.read({ workId: w.id }).totalBytes).toBe(expected);
  expect(e.claim(w.id, worker).prompt).toBe(w.prompt);
});
it('previews samples with unresolved and invalid bindings without inventing input', () => {
  const e = setup(),
    d = blankDefinition();
  const agent = d.nodes[1];
  agent.inputBindings = { value: { source: 'runInput', path: 'value' } };
  agent.inputSchema = {
    type: 'object',
    required: ['value'],
    properties: { value: { type: 'number' } },
  };
  const id = publish(e, d);
  const missing = e.assignmentSizes.read({ workflowId: id, nodeId: 'agent' });
  expect(missing.totalBytes).toBeNull();
  expect(missing.components.input.state).toBe('unknown');
  expect(missing.unresolved.total).toBe(1);
  const invalid = e.assignmentSizes.read({
    workflowId: id,
    nodeId: 'agent',
    sample: { runInput: { value: 'wrong' } },
  });
  expect(invalid.inputValidation).toBe('invalid');
  expect(invalid.warnings).toContain('invalid_sample_input');
  const good = e.assignmentSizes.read({
    workflowId: id,
    nodeId: 'agent',
    version: 1,
    sample: { runInput: { value: 42 } },
  });
  expect(good.inputValidation).toBe('valid');
  expect(good.components.input.bytes).toBe(Buffer.byteLength('{"value":42}'));
  expect(e.store.runs()).toHaveLength(0);
  expect(e.store.work()).toHaveLength(0);
});
it('keeps missing saved prompts and fresh-session IDs unknown in draft previews', () => {
  const e = setup(),
    d = blankDefinition();
  if (d.nodes[1].kind === 'agent') {
    d.nodes[1].promptIds = ['missing'];
    d.nodes[1].context.mode = 'fresh';
  }
  const w = e.create('Draft', '', d);
  const report = e.assignmentSizes.read({
    workflowId: w.id,
    nodeId: 'agent',
    sample: { input: null },
  });
  expect(report.components.prompt.state).toBe('unknown');
  expect(report.components.executionInstructions.state).toBe('unknown');
  expect(report.components.input.bytes).toBe(4);
  expect(report.totalBytes).toBeNull();
  expect(report.unresolved.total).toBe(2);
  expect(() =>
    e.assignmentSizes.read({ workId: 'missing', workflowId: w.id }),
  ).toThrow(/Choose/);
});
it('uses scoped samples and actual captured input for repeated visits and Batch items', () => {
  const e = setup(),
    item = itemAgent();
  item.inputBindings = {
    value: { source: 'itemInput', path: 'text' },
    root: { source: 'rootInput', path: '0.text' },
  };
  const definition = batchDefinition(item),
    id = publish(e, definition),
    root = e.start(id, [{ text: 'one' }, { text: 'two longer' }]).run;
  for (const w of e.available(root.id)) {
    const preview = e.assignmentSizes.read({
      workflowId: id,
      nodeId: 'work',
      sample: {
        itemInput: { text: (w.input as { value: string }).value },
        rootInput: [{ text: 'one' }],
      },
    });
    expect(preview.components.input.bytes).toBe(
      e.assignmentSizes.read({ workId: w.id }).components.input.bytes,
    );
  }
  const loop = blankDefinition();
  loop.nodes.push(
    nodeSchema.parse({
      id: 'again',
      kind: 'condition',
      label: 'Again',
      path: 'again',
      equals: true,
    }),
  );
  loop.edges[1].target = 'again';
  loop.edges.push(
    { id: 'loop', source: 'again', target: 'agent', port: 'true' },
    { id: 'out', source: 'again', target: 'exit', port: 'false' },
  );
  const run = e.start(publish(e, loop), {}).run;
  const first = e.claim(e.available(run.id)[0].id, worker);
  e.submit(first.id, first.token!, { again: true, text: 'large'.repeat(100) });
  expect(
    e.assignmentSizes.read({ workId: e.available(run.id)[0].id }).components
      .input.bytes,
  ).toBeGreaterThan(
    e.assignmentSizes.read({ workId: first.id }).components.input.bytes!,
  );
});
it('reads captured sizes across restart and honors published versus draft definitions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-size-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const e = setup(path),
    id = publish(e),
    run = e.start(id, {}).run,
    w = e.available(run.id)[0];
  const before = e.assignmentSizes.read({ workId: w.id });
  const draft = e.workflow(id);
  if (draft.draft.nodes[1].kind === 'agent')
    draft.draft.nodes[1].prompt = 'Changed '.repeat(100);
  e.update(id, { draft: draft.draft, draftRevision: draft.draftRevision });
  expect(
    e.assignmentSizes.read({
      workflowId: id,
      nodeId: 'agent',
      sample: { input: {} },
    }).components.prompt.bytes,
  ).toBeGreaterThan(
    e.assignmentSizes.read({
      workflowId: id,
      nodeId: 'agent',
      version: 1,
      sample: { input: {} },
    }).components.prompt.bytes!,
  );
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  expect(setup(path).assignmentSizes.read({ workId: w.id })).toEqual(before);
});

it('resolves supplied node outputs and leaves missing paths or cross-scope fixtures unknown', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'upstream',
      kind: 'agent',
      label: 'Upstream',
      prompt: 'Work',
    }),
  );
  d.nodes[1].inputBindings = {
    selected: { source: 'node', nodeId: 'upstream', path: 'nested.value' },
  };
  const w = e.create('Preview', '', d);
  expect(
    e.assignmentSizes.read({
      workflowId: w.id,
      nodeId: 'agent',
      sample: { outputs: { upstream: { nested: { value: 42 } } } },
    }).components.input.bytes,
  ).toBe(Buffer.byteLength('{"selected":42}'));
  expect(
    e.assignmentSizes.read({
      workflowId: w.id,
      nodeId: 'agent',
      sample: { outputs: { upstream: {} } },
    }).unresolved.items[0].reason,
  ).toBe('path_unresolved');
  const draft = e.workflow(w.id);
  draft.draft.nodes.find((n) => n.id === 'upstream')!.batchId = 'different';
  e.update(w.id, { draft: draft.draft, draftRevision: draft.draftRevision });
  expect(
    e.assignmentSizes.read({
      workflowId: w.id,
      nodeId: 'agent',
      sample: { outputs: { upstream: { nested: { value: 42 } } } },
    }).unresolved.items[0].reason,
  ).toBe('invalid_node_scope');
});
