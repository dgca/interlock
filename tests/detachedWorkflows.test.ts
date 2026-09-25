import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  runQuerySchema,
  STARTED_RUN_SCHEMA,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';
import { runProgress } from '../packages/ui/src/features/runs/runProgress';

let store: Store, engine: Engine, directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'interlock-detached-'));
  store = new Store(join(directory, 'test.db'));
  engine = new Engine(store, process.cwd());
});
afterEach(() => {
  engine.stop();
  store.close();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function publish(name: string, definition = blankDefinition()) {
  const w = engine.create(name, '', definition);
  engine.publish(w.id);
  return w;
}
function scenario(
  mode: 'wait' | 'detached' | undefined = 'detached',
  after = false,
  childDefinition = blankDefinition(),
) {
  const child = publish('Investigation', childDefinition);
  const parent = publish('Supervisor', workflowCall(child.id, mode, after));
  const detail = engine.start(parent.id, { request: 'help' });
  return { parent, child, run: detail.run, childRun: detail.children[0] };
}
function failAssignment(runId: string) {
  const work = engine.available(runId)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: true,
    tools: [],
    skills: [],
  });
  engine.reportFailure(work.id, claim.token!, 'Investigation failed');
}
function complete(runId: string, output: any = { done: true }) {
  const work = engine.available(runId).find((w) => w.runId === runId)!;
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: true,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, output);
}
it.each([undefined, 'wait'] as const)(
  'preserves waiting behavior for mode %s',
  (mode) => {
    const { run, childRun } = scenario(mode === undefined ? 'wait' : mode);
    // Verify omitted mode independently of the helper default.
    const definition = workflowCall(childRun.workflowId);
    expect(definition.nodes[1]).not.toHaveProperty('mode');
    const legacy = publish('Legacy', definition);
    const legacyRun = engine.start(legacy.id, null);
    expect(legacyRun.run.status).toBe('waiting');
    expect(run.status).toBe('waiting');
    complete(childRun.id, 'result');
    expect(engine.run(run.id).output).toBe('result');
    engine.cancel(legacyRun.run.id);
    expect(engine.run(legacyRun.children[0].id).status).toBe('cancelled');
  },
);
it('returns a pinned run reference and exposes ancestry while independent work remains claimable', () => {
  const { run, childRun, child } = scenario();
  expect(run.status).toBe('completed');
  expect(run.output).toEqual({
    runId: childRun.id,
    workflowId: child.id,
    version: 1,
  });
  expect(childRun).toMatchObject({
    status: 'waiting',
    parentRunId: run.id,
    parentMode: 'detached',
    parentExecutionId: run.executions[1].id,
  });
  expect(engine.available(run.id)).toHaveLength(1);
  expect(engine.available()).toHaveLength(1);
  const summaries = store.findRuns(runQuerySchema.parse({}));
  expect(summaries.find((r) => r.id === childRun.id)).toMatchObject({
    parentMode: 'detached',
    rootRunId: run.id,
    rootWorkflowId: run.workflowId,
  });
  expect(
    store.findRuns(runQuerySchema.parse({ rootOnly: true })).map((r) => r.id),
  ).toEqual([run.id]);
  const progress = runProgress(
    run,
    engine.inspect(run.id).definition,
    [childRun],
    engine.available(),
  );
  expect(progress.title).toBe('Completed');
  expect(progress.nodes.agent.state).toBe('completed');
});
it('continues the next parent step and isolates both directions of cancellation', () => {
  const { run, childRun } = scenario('detached', true);
  expect(
    engine
      .available()
      .map((w) => w.runId)
      .sort(),
  ).toEqual([run.id, childRun.id].sort());
  engine.cancel(run.id);
  expect(engine.run(childRun.id).status).toBe('waiting');
  complete(childRun.id);
  expect(engine.run(run.id).status).toBe('cancelled');
  const second = scenario('detached', true);
  engine.cancel(second.childRun.id);
  expect(engine.run(second.run.id).status).toBe('waiting');
  complete(second.run.id);
  expect(engine.run(second.run.id).status).toBe('completed');
});
it('retries failed independent work after its parent completes', () => {
  const child = blankDefinition();
  if (child.nodes[1].kind === 'agent') child.nodes[1].maxAttempts = 1;
  const { run, childRun } = scenario('detached', false, child);
  failAssignment(childRun.id);
  expect(engine.run(childRun.id).status).toBe('failed');
  expect(engine.run(run.id).status).toBe('completed');
  engine.retry(childRun.id);
  complete(childRun.id);
  expect(engine.run(childRun.id).status).toBe('completed');
});
it('does not recreate or retry detached work when a later parent step is retried', () => {
  const { run, childRun } = scenario('detached', true);
  failAssignment(run.id);
  expect(engine.run(run.id).status).toBe('failed');
  expect(engine.run(childRun.id).status).toBe('waiting');
  engine.retry(run.id);
  expect(engine.inspect(run.id).children.map((r) => r.id)).toEqual([
    childRun.id,
  ]);
  complete(run.id);
  expect(engine.run(run.id).status).toBe('completed');
});
it('resumes persisted independent children without repeating a committed dispatch', () => {
  const { run, childRun } = scenario('detached', true);
  engine.stop();
  store.close();
  store = new Store(join(directory, 'test.db'));
  engine = new Engine(store, process.cwd());
  engine.pump();
  expect(engine.inspect(run.id).children.map((r) => r.id)).toEqual([
    childRun.id,
  ]);
  complete(run.id);
  complete(childRun.id);
  expect(engine.run(run.id).status).toBe('completed');
  expect(engine.run(childRun.id).status).toBe('completed');
});
it('fails invalid launch input before creating a child', () => {
  const definition = blankDefinition();
  definition.inputSchema = { type: 'string' };
  const child = publish('Typed', definition);
  const parent = publish('Parent', workflowCall(child.id, 'detached'));
  const result = engine.start(parent.id, 12);
  expect(result.run.status).toBe('failed');
  expect(result.run.error).toContain('workflow input');
  expect(result.children).toEqual([]);
});
it('rolls back child creation if finishing dispatch fails, then safely retries', () => {
  const child = publish('Child');
  const parent = publish('Parent', workflowCall(child.id, 'detached'));
  const put = store.put.bind(store);
  let rejected = false;
  vi.spyOn(store, 'put').mockImplementation((collection, value: any) => {
    if (
      !rejected &&
      collection === 'runs' &&
      value.workflowId === parent.id &&
      value.executions.at(-1)?.output?.runId
    ) {
      rejected = true;
      throw new Error('Simulated dispatch write failure');
    }
    put(collection, value);
  });
  const result = engine.start(parent.id, null);
  expect(result.run.status).toBe('failed');
  expect(result.children).toEqual([]);
  expect(result.run.executions.at(-1)?.childRunIds).toEqual([]);
  expect(
    store.list<any>('events').every((event) => event.runId === result.run.id),
  ).toBe(true);
  vi.restoreAllMocks();
  engine.retry(result.run.id);
  expect(engine.inspect(result.run.id).children).toHaveLength(1);
  expect(engine.run(result.run.id).status).toBe('completed');
});
it('cancels ordinary descendants but stops at every detached boundary', () => {
  const leaf = publish('Leaf');
  const detachedGrandchild = publish(
    'Detached grandchild',
    workflowCall(leaf.id, 'wait'),
  );
  const child = publish(
    'Child',
    workflowCall(detachedGrandchild.id, 'detached', true),
  );
  const parent = publish('Parent', workflowCall(child.id, 'detached'));
  const result = engine.start(parent.id, null);
  const childRun = result.children[0];
  const grandchildRun = engine.inspect(childRun.id).children[0];
  const leafRun = engine.inspect(grandchildRun.id).children[0];
  engine.cancel(childRun.id);
  expect(engine.run(grandchildRun.id).status).toBe('waiting');
  expect(engine.run(leafRun.id).status).toBe('waiting');
  engine.cancel(grandchildRun.id);
  expect(engine.run(leafRun.id).status).toBe('cancelled');
});
it('uses the nearest detached boundary for fresh-session instructions but retains original root input', () => {
  const definition = blankDefinition();
  const agent = definition.nodes[1];
  if (agent.kind !== 'agent') throw new Error('agent');
  agent.context.mode = 'fresh';
  agent.inputBindings = {
    origin: { source: 'rootInput', path: '' },
    supplied: { source: 'runInput', path: '' },
  };
  const leaf = publish('Leaf', definition);
  const child = publish('Child', workflowCall(leaf.id, 'wait'));
  const parentDefinition = workflowCall(child.id, 'detached');
  parentDefinition.nodes[1].inputBindings = {
    selected: { source: 'input', path: 'request' },
  };
  const parent = publish('Parent', parentDefinition);
  const result = engine.start(parent.id, { request: 'help' });
  const work = engine.available(result.run.id)[0];
  expect(work.input).toEqual({
    origin: { request: 'help' },
    supplied: { selected: 'help' },
  });
  expect(work.executionInstructions).toContain(
    `Continue existing Interlock run ${result.children[0].id}.`,
  );
  expect(work.executionInstructions).not.toContain(result.run.id);
});
it('dispatches Batch items without waiting for their independent work', () => {
  const child = publish('Child');
  const definition = batchDefinition(
    nodeSchema.parse({
      id: 'dispatch',
      kind: 'workflow',
      label: 'Dispatch',
      workflowId: child.id,
      version: 1,
      mode: 'detached',
    }),
    { concurrency: 1 },
  );
  const parent = publish('Batch', definition);
  const result = engine.start(parent.id, ['a', 'b', 'c']);
  expect(result.run.status).toBe('completed');
  expect(result.run.output).toHaveLength(3);
  expect(result.children.every((r) => r.status === 'completed')).toBe(true);
  expect(engine.available(result.run.id)).toHaveLength(3);
  expect(() => engine.deleteWorkflow(parent.id)).toThrow('active runs');
});
it('counts detached ancestry toward the existing nesting limit', () => {
  let w = publish('Leaf');
  for (let i = 0; i < 12; i++)
    w = publish(`Level ${i}`, workflowCall(w.id, 'detached'));
  const result = engine.start(w.id, null);
  expect(result.descendants).toHaveLength(10);
  expect(result.descendants.at(-1)?.error).toContain('depth exceeded 10');
});
it('dispatches once per deliberate loop visit', () => {
  const child = publish('Child');
  const definition = workflowCall(child.id, 'detached');
  definition.maxSteps = 5;
  definition.nodes[1].inputBindings = {
    original: { source: 'runInput', path: '' },
  };
  definition.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'again',
      kind: 'condition',
      label: 'Loop',
      path: 'version',
      equals: 1,
    }),
  );
  definition.edges[1].target = 'again';
  definition.edges.push(
    { id: 'repeat', source: 'again', target: 'agent', port: 'true' },
    { id: 'done', source: 'again', target: 'exit', port: 'false' },
  );
  const parent = publish('Loop', definition);
  const result = engine.start(parent.id, null);
  expect(result.run.status).toBe('failed');
  expect(result.children).toHaveLength(2);
  expect(new Set(result.children.map((r) => r.parentExecutionId)).size).toBe(2);
  expect(result.children.every((r) => r.status === 'waiting')).toBe(true);
});
it('enforces the intrinsic output contract only in detached mode and permits incomplete drafts', () => {
  const definition = workflowCall('target', 'detached');
  definition.nodes[1].outputSchema = { type: 'string' };
  expect(() => validateDefinition(definition)).toThrow('fixed Started run');
  expect(() => nodeSchema.parse(definition.nodes[1])).not.toThrow();
  definition.nodes[1].outputSchema = structuredClone(STARTED_RUN_SCHEMA);
  expect(() => validateDefinition(definition)).not.toThrow();
  if (definition.nodes[1].kind !== 'workflow') throw new Error('workflow');
  definition.nodes[1].mode = 'wait';
  definition.nodes[1].outputSchema = { type: 'string' };
  expect(() => validateDefinition(definition)).not.toThrow();
});

it('keeps dispatch successful when the child fails immediately after creation', () => {
  const child = blankDefinition();
  child.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'condition',
    label: 'Missing path',
    path: 'missing',
    equals: true,
  });
  child.edges[1].port = 'true';
  child.edges.push({
    id: 'false',
    source: 'agent',
    target: 'exit',
    port: 'false',
  });
  const result = scenario('detached', false, child);
  expect(result.run.status).toBe('completed');
  expect(result.childRun.status).toBe('failed');
  expect(result.childRun.error).toContain('Input has no path');
});
it('does not dispatch after cancellation before the Workflow step', () => {
  const child = publish('Child');
  const definition = workflowCall(child.id, 'detached');
  definition.nodes.splice(
    1,
    0,
    nodeSchema.parse({
      id: 'pause',
      kind: 'wait',
      label: 'Pause',
      timing: { kind: 'duration', ms: 60000 },
    }),
  );
  definition.edges[0].target = 'pause';
  definition.edges.push({
    id: 'pause-dispatch',
    source: 'pause',
    target: 'agent',
    port: 'default',
  });
  const parent = publish('Parent', definition);
  const result = engine.start(parent.id, null);
  engine.cancel(result.run.id);
  engine.pump();
  expect(engine.inspect(result.run.id).children).toEqual([]);
});
it('checks missing pins in persisted versions before dispatch', () => {
  const child = publish('Child');
  const parent = publish('Parent', workflowCall(child.id, 'detached'));
  const snapshot = store.getVersion(parent.id, 1)!;
  const step = snapshot.definition.nodes[1];
  if (step.kind !== 'workflow') throw new Error('workflow');
  step.version = 999;
  store.version(snapshot);
  const result = engine.start(parent.id, null);
  expect(result.run.error).toContain('Published workflow version not found');
  expect(result.children).toEqual([]);
});
