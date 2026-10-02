import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  definitionSchema,
  diagnoseDraft,
  nodeSchema,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { nestedBatches } from './fixtures/batch';

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function setup(d = blankDefinition()) {
  const store = new Store(':memory:');
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  const workflow = engine.create('Edits', '', d);
  return { engine, store, workflow };
}
const codes = (diagnostics: ReturnType<typeof diagnoseDraft>['diagnostics']) =>
  diagnostics.map((d) => d.code);

it('changes a prompt and inserts/reconnects a step in one revision, preserving unrelated data', () => {
  const { engine, store, workflow: w } = setup();
  engine.publish(w.id);
  const run = engine.start(w.id, { hello: 'world' });
  const before = engine.workflow(w.id),
    version = store.getVersion(w.id, 1),
    history = store.get('runs', run.run.id);
  const result = engine.editDraft(w.id, before.draftRevision, [
    { op: 'update_node', id: 'agent', set: { prompt: 'New prompt' } },
    {
      op: 'add_node',
      node: {
        id: 'check',
        kind: 'agent',
        label: 'Check',
        prompt: 'Check research',
        inputBindings: {
          research: { source: 'node', nodeId: 'agent', path: '' },
        },
      },
    },
    { op: 'update_edge', id: 'e2', set: { target: 'check' } },
    { op: 'add_edge', edge: { id: 'out', source: 'check', target: 'exit' } },
    {
      op: 'update_settings',
      set: { maxSteps: 200, inputSchema: { type: 'object' } },
    },
  ]);
  expect(result).toMatchObject({
    applied: true,
    draftRevision: before.draftRevision + 1,
    changes: {
      nodes: { added: ['check'], updated: ['agent'], removed: [] },
      edges: { added: ['out'], updated: ['e2'], removed: [] },
      settings: ['inputSchema', 'maxSteps'],
    },
  });
  const after = engine.workflow(w.id);
  expect(after.draft.nodes[0]).toEqual(before.draft.nodes[0]);
  expect(after.draft.nodes[1]).toEqual({
    ...before.draft.nodes[1],
    prompt: 'New prompt',
  });
  expect(after.ownerWorkflowId).toBe(before.ownerWorkflowId);
  expect(store.getVersion(w.id, 1)).toEqual(version);
  expect(store.get('runs', run.run.id)).toEqual(history);
});

it.each([
  { op: 'update_node', id: 'absent', set: { prompt: 'x' } },
  { op: 'remove_node', id: 'absent' },
  {
    op: 'add_node',
    node: { id: 'agent', kind: 'agent', label: 'Duplicate', prompt: 'x' },
  },
  { op: 'add_edge', edge: { id: 'e1', source: 'entry', target: 'agent' } },
  { op: 'update_edge', id: 'absent', set: { target: 'exit' } },
  { op: 'remove_edge', id: 'absent' },
  { op: 'update_node', id: 'agent', set: { promt: 'typo' } },
  {
    op: 'update_node',
    id: 'agent',
    set: { context: { mode: 'current', invented: true } },
  },
  { op: 'update_node', id: 'agent', set: { id: 'changed' } },
  { op: 'update_node', id: 'agent', set: { kind: 'script' } },
  { op: 'update_node', id: 'agent', unset: ['prompt'] },
  { op: 'update_node', id: 'agent', set: { label: 'x' }, unset: ['label'] },
  { op: 'update_node', id: 'agent', unset: ['promt'] },
  { op: 'update_settings', set: { maxSteps: 1 } },
  { op: 'update_settings', set: { ownerWorkflowId: 'x' } },
  { op: 'update_edge', id: 'e1', set: { targetHandle: 'wrong' } },
  {
    op: 'add_node',
    node: {
      id: 'x',
      kind: 'script',
      label: 'x',
      command: 'return input',
      position: { x: 0, y: 0, z: 0 },
    },
  },
  { op: 'remove_edge', id: 'e1', unexpected: true },
  { op: 'unknown' },
  null,
])('rolls back all edits for invalid operation %#', (bad) => {
  const { engine, workflow: w } = setup();
  const before = engine.workflow(w.id);
  const result = engine.editDraft(w.id, w.draftRevision, [
    { op: 'update_node', id: 'agent', set: { prompt: 'First edit' } },
    bad,
  ]);
  expect(result).toMatchObject({
    applied: false,
    diagnostics: [
      {
        category: 'save',
        code: 'invalid_edit',
        operationIndex: 1,
        path: 'edits.1',
      },
    ],
  });
  expect(engine.workflow(w.id)).toEqual(before);
});

it('rejects stale revisions first, and malformed lists without persistence', () => {
  const { engine, workflow: w } = setup();
  engine.editDraft(w.id, w.draftRevision, [{ op: 'remove_edge', id: 'e1' }]);
  const before = engine.workflow(w.id);
  expect(engine.editDraft(w.id, w.draftRevision, [null])).toMatchObject({
    applied: false,
    diagnostics: [{ code: 'stale_revision' }],
  });
  for (const edits of [{}, Array(101).fill(null)])
    expect(engine.editDraft(w.id, before.draftRevision, edits)).toMatchObject({
      applied: false,
      diagnostics: [{ code: 'invalid_edit_list' }],
    });
  expect(engine.workflow(w.id)).toEqual(before);
});

it('preserves revision and timestamp for effective no-ops and object-key reordering', () => {
  const { engine, workflow: w } = setup();
  for (const edits of [
    [],
    [
      {
        op: 'update_node',
        id: 'agent',
        set: {
          prompt:
            w.draft.nodes[1].kind === 'agent' ? w.draft.nodes[1].prompt : '',
        },
      },
    ],
    [
      { op: 'add_edge', edge: { id: 'temp', source: 'entry', target: 'exit' } },
      { op: 'remove_edge', id: 'temp' },
    ],
  ]) {
    expect(engine.editDraft(w.id, w.draftRevision, edits)).toMatchObject({
      applied: true,
      draftRevision: w.draftRevision,
    });
    expect(engine.workflow(w.id)).toEqual(w);
  }
});

it('saves incomplete graphs and separates publication and save failures in read-only candidate validation', () => {
  const { engine, workflow: w } = setup();
  const result = engine.editDraft(w.id, w.draftRevision, [
    { op: 'remove_edge', id: 'e1' },
    { op: 'remove_edge', id: 'e2' },
  ]);
  expect(result.applied).toBe(true);
  expect(codes(result.diagnostics)).toContain('incomplete_routes');
  expect(engine.validateDraft(w.id)).toMatchObject({
    saveable: true,
    publishable: false,
  });
  const before = engine.workflow(w.id);
  expect(
    engine.validateDraft(w.id, { ...before.draft, unknown: 'value' }),
  ).toMatchObject({
    saveable: false,
    publishable: false,
    diagnostics: [{ code: 'unknown_field', path: 'unknown' }],
  });
  expect(
    engine.validateDraft(w.id, { nodes: [{}], edges: [] }).diagnostics.length,
  ).toBeGreaterThan(1);
  expect(engine.workflow(w.id)).toEqual(before);
  expect(engine.store.getVersion(w.id, 1)).toBeUndefined();
  expect(engine.store.runs()).toEqual([]);
});

it('removes nested Batch members and incident edges while retaining unrelated bindings for explicit repair', () => {
  const d = nestedBatches(3);
  d.nodes.push(
    nodeSchema.parse({
      id: 'observer',
      kind: 'agent',
      label: 'Observer',
      prompt: 'observe',
      inputBindings: { prior: { source: 'node', nodeId: 'work', path: '' } },
    }),
  );
  const { engine, workflow: w } = setup(d);
  const result = engine.editDraft(w.id, w.draftRevision, [
    { op: 'remove_node', id: 'batch' },
  ]);
  expect(result.applied).toBe(true);
  expect(result.changes.nodes.removed.sort()).toEqual([
    'batch',
    'batch1',
    'batch2',
    'work',
  ]);
  expect(engine.workflow(w.id).draft.nodes.map((n) => n.id)).toEqual([
    'entry',
    'exit',
    'observer',
  ]);
  expect(engine.workflow(w.id).draft.edges).toEqual([]);
  expect(codes(result.diagnostics)).toContain('invalid_binding_source');
  expect(engine.workflow(w.id).draft.nodes[2].inputBindings).toEqual(
    d.nodes.at(-1)!.inputBindings,
  );
  expect(
    engine.editDraft(w.id, result.draftRevision, [
      { op: 'update_node', id: 'observer', unset: ['inputBindings'] },
      {
        op: 'add_edge',
        edge: { id: 'a', source: 'entry', target: 'observer' },
      },
      { op: 'add_edge', edge: { id: 'b', source: 'observer', target: 'exit' } },
    ]).applied,
  ).toBe(true);
  expect(engine.validateDraft(w.id).publishable).toBe(true);
});

it('diagnoses malformed Batch membership without changing existing save policy', () => {
  const d = nestedBatches(2);
  const { engine, workflow: w } = setup(d);
  const result = engine.editDraft(w.id, w.draftRevision, [
    { op: 'update_node', id: 'batch', set: { batchId: 'batch1' } },
  ]);
  expect(result.applied).toBe(true);
  expect(codes(result.diagnostics)).toContain('batch_scope');
  expect(engine.validateDraft(w.id).publishable).toBe(false);
});

it('preserves edges across source-port changes until explicitly repaired', () => {
  const d = definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      {
        id: 'switch',
        kind: 'switch',
        label: 'Switch',
        path: '',
        cases: [{ port: 'old', equals: 1 }],
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'switch' },
      { id: 'out', source: 'switch', port: 'old', target: 'exit' },
    ],
  });
  const { engine, workflow: w } = setup(d);
  const result = engine.editDraft(w.id, w.draftRevision, [
    {
      op: 'update_node',
      id: 'switch',
      set: { cases: [{ port: 'new', equals: 1 }] },
    },
  ]);
  expect(result.applied).toBe(true);
  expect(codes(result.diagnostics)).toContain('invalid_port');
  expect(engine.workflow(w.id).draft.edges[1].port).toBe('old');
  expect(
    engine.editDraft(w.id, result.draftRevision, [
      { op: 'update_edge', id: 'out', set: { port: 'new' } },
    ]).applied,
  ).toBe(true);
  expect(engine.validateDraft(w.id).publishable).toBe(true);
});

it('keeps legacy Bash and JavaScript languages while defaulting added scripts to JavaScript', () => {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Bash',
    command: 'cat',
  });
  const { engine, workflow: w } = setup(d);
  const result = engine.editDraft(w.id, w.draftRevision, [
    { op: 'update_node', id: 'agent', set: { command: 'jq .' } },
    {
      op: 'add_node',
      node: { id: 'js', kind: 'script', label: 'JS', command: 'return input' },
    },
    {
      op: 'add_node',
      node: {
        id: 'bash',
        kind: 'script',
        label: 'Bash',
        language: 'bash',
        command: 'cat',
      },
    },
  ]);
  expect(result.applied).toBe(true);
  const nodes = engine.workflow(w.id).draft.nodes;
  expect(nodes[1]).not.toHaveProperty('language');
  expect(nodes.find((n) => n.id === 'js')).toMatchObject({
    language: 'javascript',
  });
  expect(nodes.find((n) => n.id === 'bash')).toMatchObject({
    language: 'bash',
  });
});

it('rolls back disallowed owned-child references and diagnoses missing versions without changing pins', () => {
  const { engine, workflow: w } = setup();
  const other = engine.create('Other'),
    child = engine.create('Child', '', blankDefinition(), other.id);
  const before = engine.workflow(w.id);
  const node = {
    id: 'child',
    kind: 'workflow',
    label: 'Child',
    workflowId: child.id,
    version: null,
  };
  expect(
    engine.editDraft(w.id, w.draftRevision, [
      { op: 'update_node', id: 'agent', set: { prompt: 'Changed' } },
      { op: 'add_node', node },
    ]),
  ).toMatchObject({
    applied: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: 'workflow_ownership',
        category: 'save',
        nodeId: 'child',
        operationIndex: 1,
      }),
    ]),
  });
  expect(engine.workflow(w.id)).toEqual(before);
  expect(
    engine.validateDraft(w.id, {
      ...before.draft,
      nodes: [...before.draft.nodes, node],
    }).saveable,
  ).toBe(false);
  const result = engine.editDraft(other.id, other.draftRevision, [
    { op: 'add_node', node: { ...node, version: 42 } },
  ]);
  expect(result.applied).toBe(true);
  expect(codes(result.diagnostics)).toContain('missing_workflow_version');
  expect(engine.workflow(other.id).draft.nodes.at(-1)).toMatchObject({
    version: 42,
  });
});

it.each([
  ['add_edge', false],
  ['update_edge', false],
  ['remove_edge', false],
  ['update_edge', true],
] as const)(
  'attributes ownership errors to node edits before %s (later node update: %s)',
  (op, updateNode) => {
    const d = blankDefinition();
    if (op !== 'add_edge') d.edges[1].id = 'child';
    const { engine, workflow: w } = setup(d);
    const other = engine.create('Other');
    const child = engine.create('Child', '', blankDefinition(), other.id);
    const before = engine.workflow(w.id);
    const edits: unknown[] = [
      {
        op: 'add_node',
        node: {
          id: 'child',
          kind: 'workflow',
          label: 'Child',
          workflowId: child.id,
          version: null,
        },
      },
    ];
    if (updateNode)
      edits.push({ op: 'update_node', id: 'child', set: { label: 'Renamed' } });
    edits.push(
      op === 'add_edge'
        ? { op, edge: { id: 'child', source: 'agent', target: 'exit' } }
        : op === 'update_edge'
          ? { op, id: 'child', set: { source: 'entry' } }
          : { op, id: 'child' },
    );
    expect(engine.editDraft(w.id, w.draftRevision, edits)).toMatchObject({
      applied: false,
      draftRevision: w.draftRevision,
      changes: {
        nodes: { added: [], updated: [], removed: [] },
        edges: { added: [], updated: [], removed: [] },
        settings: [],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'workflow_ownership',
          nodeId: 'child',
          operationIndex: updateNode ? 1 : 0,
        }),
      ]),
    });
    expect(engine.workflow(w.id)).toEqual(before);
  },
);

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
it('detects primitive and binding-path conflicts behind explicit contracts, and reports independent problems', () => {
  const d = blankDefinition();
  d.inputSchema = object({ name: { type: 'string' } });
  d.nodes[1].inputSchema = object({ name: { type: 'number' } });
  d.nodes[1].outputSchema = object({ answer: { type: 'number' } });
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'consumer',
      kind: 'agent',
      label: 'Consumer',
      prompt: 'read',
      inputBindings: {
        value: { source: 'node', nodeId: 'agent', path: 'answer' },
        missing: { source: 'node', nodeId: 'agent', path: 'absent' },
        root: { source: 'rootInput', path: 'name' },
      },
      inputSchema: object({ value: { type: 'string' } }),
    }),
  );
  d.edges[1].target = 'consumer';
  d.edges.push({
    id: 'finish',
    source: 'consumer',
    target: 'exit',
    port: 'default',
  });
  const result = diagnoseDraft(d);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'agent',
        edgeId: 'e1',
        path: 'nodes.1.inputSchema.name',
      }),
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'consumer',
        path: 'nodes.2.inputSchema.value',
      }),
      expect.objectContaining({
        code: 'binding_missing_path',
        nodeId: 'consumer',
        path: 'nodes.2.inputBindings.missing.path',
      }),
      expect.objectContaining({ code: 'binding_unknown', nodeId: 'consumer' }),
    ]),
  );
});

it('reports unknown for ambiguous merges, complex schemas and unknown projected fields', () => {
  const d = blankDefinition();
  d.inputSchema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
  d.nodes[1].inputSchema = { type: 'string' };
  d.nodes.push(
    nodeSchema.parse({
      id: 'other',
      kind: 'agent',
      label: 'Other',
      prompt: 'x',
      outputSchema: { type: 'number' },
    }),
  );
  d.edges.push({
    id: 'merge',
    source: 'other',
    target: 'agent',
    port: 'default',
  });
  const result = diagnoseDraft(d);
  expect(codes(result.diagnostics)).toContain('contract_unknown');
  d.nodes[1].inputBindings = { value: { source: 'input', path: '' } };
  d.nodes[1].inputSchema = object({ value: { type: 'string' } });
  expect(codes(diagnoseDraft(d).diagnostics)).toContain('binding_unknown');
  expect(codes(diagnoseDraft(d).diagnostics)).toContain('contract_unknown');
});

it('handles Batch item contracts, pass-through timeouts and cycles conservatively', () => {
  const d = nestedBatches(2);
  d.inputSchema = {
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  };
  d.nodes.find((n) => n.id === 'work')!.inputSchema = { type: 'number' };
  expect(diagnoseDraft(d).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'work',
      }),
    ]),
  );
  const loop = blankDefinition();
  loop.inputSchema = { type: 'string' };
  loop.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Wait',
    inputSchema: { type: 'number' },
  });
  loop.edges.push({
    id: 'loop',
    source: 'agent',
    target: 'agent',
    port: 'default',
  });
  expect(codes(diagnoseDraft(loop).diagnostics)).toContain('contract_unknown');
});

it('rejects ambiguous stored IDs and final shape errors at the relevant operation', () => {
  const d = blankDefinition();
  d.nodes.push({ ...d.nodes[1] });
  const { engine, workflow: w } = setup(d);
  expect(
    engine.editDraft(w.id, w.draftRevision, [
      { op: 'update_node', id: 'agent', set: { prompt: 'x' } },
    ]),
  ).toMatchObject({
    applied: false,
    diagnostics: [
      { operationIndex: 0, message: 'Node ID is ambiguous: agent' },
    ],
  });
  const normal = engine.create('Normal');
  const before = engine.workflow(normal.id);
  expect(
    engine.editDraft(normal.id, normal.draftRevision, [
      { op: 'remove_node', id: 'agent' },
      { op: 'remove_node', id: 'entry' },
      { op: 'update_settings', set: { maxSteps: 10 } },
    ]),
  ).toMatchObject({
    applied: false,
    diagnostics: [
      {
        category: 'save',
        code: 'invalid_definition',
        operationIndex: 1,
        path: 'nodes',
      },
    ],
  });
  expect(engine.workflow(normal.id)).toEqual(before);
});

it('accepts equivalent object-key order without updating and resets explicitly unset defaults', () => {
  const d = blankDefinition();
  d.inputSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
  };
  const { engine, workflow: w } = setup(d);
  expect(
    engine.editDraft(w.id, w.draftRevision, [
      {
        op: 'update_settings',
        set: {
          inputSchema: {
            properties: { b: { type: 'number' }, a: { type: 'string' } },
            type: 'object',
          },
        },
      },
    ]),
  ).toMatchObject({ applied: true, draftRevision: w.draftRevision });
  expect(engine.workflow(w.id)).toEqual(w);
  const changed = engine.editDraft(w.id, w.draftRevision, [
    { op: 'update_settings', set: { maxSteps: 250 } },
  ]);
  const reset = engine.editDraft(w.id, changed.draftRevision, [
    { op: 'update_settings', unset: ['maxSteps', 'inputSchema'] },
  ]);
  expect(reset.applied).toBe(true);
  expect(engine.workflow(w.id).draft).toMatchObject({
    maxSteps: 100,
    inputSchema: {},
  });
});

it('checks timed Agent timeout input independently of its result contract', () => {
  const d = blankDefinition();
  d.inputSchema = { type: 'string' };
  d.nodes[1] = nodeSchema.parse({
    ...d.nodes[1],
    unclaimedTimeoutMs: 100,
    outputSchema: { type: 'number' },
  });
  d.nodes.push(
    nodeSchema.parse({
      id: 'timed',
      kind: 'agent',
      label: 'Timeout',
      prompt: 'x',
      inputSchema: { type: 'number' },
    }),
  );
  d.edges.push(
    { id: 'timeout', source: 'agent', target: 'timed', port: 'timeout' },
    { id: 'after-timeout', source: 'timed', target: 'exit', port: 'default' },
  );
  expect(diagnoseDraft(d).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'timed',
        edgeId: 'timeout',
      }),
    ]),
  );
});

it('keeps node IDs and ports unambiguous in inference caches', () => {
  const d = definitionSchema.parse({
    inputSchema: { type: 'string' },
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'fork', kind: 'condition', label: 'Fork', path: '', equals: 'x' },
      {
        id: 'a:b',
        kind: 'agent',
        label: 'Producer',
        prompt: 'x',
        outputSchema: { type: 'number' },
      },
      {
        id: 'first',
        kind: 'agent',
        label: 'First',
        prompt: 'x',
        inputSchema: { type: 'number' },
      },
      {
        id: 'a',
        kind: 'switch',
        label: 'Switch',
        path: '',
        cases: [{ port: 'b:default', equals: 'y' }],
      },
      {
        id: 'last',
        kind: 'agent',
        label: 'Last',
        prompt: 'x',
        inputSchema: { type: 'number' },
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'e0', source: 'entry', target: 'fork' },
      { id: 'e1', source: 'fork', port: 'true', target: 'a:b' },
      { id: 'e2', source: 'a:b', target: 'first' },
      { id: 'e3', source: 'fork', port: 'false', target: 'a' },
      { id: 'e4', source: 'a', port: 'b:default', target: 'last' },
      { id: 'e5', source: 'first', target: 'exit' },
      { id: 'e6', source: 'last', target: 'exit' },
    ],
  });
  expect(diagnoseDraft(d).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'last',
        edgeId: 'e4',
        message: 'Upstream type string conflicts with expected number.',
      }),
    ]),
  );
  const before = diagnoseDraft(d).diagnostics;
  d.nodes.find((n) => n.id === 'a:b')!.id = 'producer';
  for (const edge of d.edges) {
    if (edge.source === 'a:b') edge.source = 'producer';
    if (edge.target === 'a:b') edge.target = 'producer';
  }
  expect(diagnoseDraft(d).diagnostics).toEqual(before);
});

it.each(['a.b', '', '$', '$.a'])(
  'compares literal JSON Schema property %j independently of binding paths',
  (key) => {
    const d = blankDefinition();
    d.inputSchema = object({ [key]: { type: 'string' } });
    d.nodes[1].inputSchema = object({ [key]: { type: 'string' } });
    expect(
      diagnoseDraft(d).diagnostics.filter((x) => x.category === 'contract'),
    ).toEqual([]);
    d.nodes[1].inputSchema = object({ [key]: { type: 'number' } });
    expect(diagnoseDraft(d).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'contract_type_conflict',
          nodeId: 'agent',
          path: `nodes.1.inputSchema[${JSON.stringify(key)}]`,
        }),
      ]),
    );
    d.inputSchema = object({});
    expect(diagnoseDraft(d).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'contract_missing_path',
          nodeId: 'agent',
          path: `nodes.1.inputSchema[${JSON.stringify(key)}]`,
        }),
      ]),
    );
  },
);

it('reports unknown for a selected unsupported leaf without an explicit consumer contract', () => {
  const d = blankDefinition();
  d.inputSchema = object({
    name: { anyOf: [{ type: 'string' }, { type: 'number' }] },
  });
  d.nodes[1].inputBindings = { name: { source: 'input', path: 'name' } };
  expect(diagnoseDraft(d).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_unknown',
        nodeId: 'agent',
        path: 'nodes.1.inputBindings.name.path',
      }),
    ]),
  );
});

it.each([
  ['type union', { type: ['string', 'number'] }, 'value'],
  ['annotation only', { description: 'Name' }, 'value'],
  [
    'array index with union items',
    { type: 'array', items: { type: ['string', 'number'] } },
    'value.0',
  ],
  [
    'whole object with complex property',
    object({ name: { anyOf: [{ type: 'string' }, { type: 'number' }] } }),
    'value',
  ],
  [
    'whole object with annotation property',
    object({ name: { description: 'Name' } }),
    'value',
  ],
  [
    'whole array with complex items',
    {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    },
    'value',
  ],
  [
    'whole array with union items',
    { type: 'array', items: { type: ['string', 'number'] } },
    'value',
  ],
] as const)(
  'reports unknown for %s without a consumer contract',
  (_, schema, path) => {
    const d = blankDefinition();
    d.inputSchema = object({ value: schema });
    d.nodes[1].inputBindings = { selected: { source: 'input', path } };
    expect(diagnoseDraft(d).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'binding_unknown',
          nodeId: 'agent',
          path: 'nodes.1.inputBindings.selected.path',
        }),
      ]),
    );
  },
);

it('retains known siblings and excluded paths within partially unknown schemas', () => {
  const d = blankDefinition();
  d.inputSchema = object({
    value: object({
      name: { type: ['string', 'number'] },
      count: { type: 'number' },
    }),
  });
  d.nodes[1].inputBindings = {
    whole: { source: 'input', path: 'value' },
    known: { source: 'input', path: 'value.count' },
    missing: { source: 'input', path: 'value.absent' },
  };
  d.nodes[1].inputSchema = object({ known: { type: 'string' } });
  const diagnostics = diagnoseDraft(d).diagnostics;
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_unknown',
        path: 'nodes.1.inputBindings.whole.path',
      }),
      expect.objectContaining({
        code: 'binding_missing_path',
        path: 'nodes.1.inputBindings.missing.path',
      }),
      expect.objectContaining({
        code: 'contract_type_conflict',
        path: 'nodes.1.inputSchema.known',
      }),
    ]),
  );
  expect(diagnostics).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_unknown',
        path: 'nodes.1.inputBindings.known.path',
      }),
    ]),
  );
});

it('preserves recursive projection uncertainty and independent known field conflicts', () => {
  const recursive = blankDefinition();
  recursive.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Wait',
    inputBindings: { value: { source: 'node', nodeId: 'agent', path: '' } },
  });
  expect(diagnoseDraft(recursive).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'binding_unknown', nodeId: 'agent' }),
    ]),
  );

  const d = blankDefinition();
  d.inputSchema = object({ count: { type: 'number' } });
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Wait',
    inputBindings: {
      value: { source: 'node', nodeId: 'agent', path: '' },
      count: { source: 'runInput', path: 'count' },
    },
    inputSchema: object({ count: { type: 'string' } }),
  });
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'consumer',
      kind: 'agent',
      label: 'Consumer',
      prompt: 'x',
      inputBindings: {
        all: { source: 'node', nodeId: 'agent', path: '' },
        known: { source: 'node', nodeId: 'agent', path: 'count' },
      },
      inputSchema: object({ known: { type: 'string' } }),
    }),
  );
  d.edges[1].target = 'consumer';
  d.edges.push({
    id: 'out',
    source: 'consumer',
    target: 'exit',
    port: 'default',
  });
  const diagnostics = diagnoseDraft(d).diagnostics;
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_unknown',
        nodeId: 'agent',
        path: 'nodes.1.inputBindings.value.path',
      }),
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'agent',
        path: 'nodes.1.inputSchema.count',
      }),
      expect.objectContaining({
        code: 'binding_unknown',
        nodeId: 'consumer',
        path: 'nodes.2.inputBindings.all.path',
      }),
      expect.objectContaining({
        code: 'contract_type_conflict',
        nodeId: 'consumer',
        path: 'nodes.2.inputSchema.known',
      }),
    ]),
  );
  expect(diagnostics).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_unknown',
        path: 'nodes.2.inputBindings.known.path',
      }),
    ]),
  );
});
