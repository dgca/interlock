import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  diagnoseDraft,
  nodeInputHint,
  assertContract,
  WORKFLOW_FAILURE_ROUTE_SCHEMA,
  type WorkflowDefinition,
  type Json,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function publish(e: Engine, definition = blankDefinition()) {
  const w = e.create('Workflow recovery', '', definition);
  e.publish(w.id);
  return w;
}
function childDefinition() {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], maxAttempts: 1 });
  return d;
}
function parentDefinition(
  childId: string,
  onFailure: 'route' | 'fail' | undefined = 'route',
) {
  const d = workflowCall(childId);
  d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], onFailure });
  if (onFailure === 'route')
    d.edges.push({
      id: 'failed',
      source: 'agent',
      target: 'exit',
      port: 'failed',
    });
  return d;
}
function fixture(
  e: Engine,
  input: Json = {},
  edit?: (d: WorkflowDefinition) => void,
) {
  const child = publish(e, childDefinition()),
    d = parentDefinition(child.id);
  edit?.(d);
  const parent = publish(e, d),
    run = e.start(parent.id, input).run;
  const childRun = e.inspect(run.id).children[0];
  return { child, parent, run, childRun };
}
function fail(e: Engine, childId: string) {
  const work = e.claim(e.available(childId)[0].id, worker);
  e.reportFailure(work.id, work.token!, 'Executor could not finish');
  return work;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

it('routes a failed waited child with resolved input, retained child references and no copied history', () => {
  const e = setup(),
    { run, childRun, child } = fixture(
      e,
      { request: { topic: 'research' } },
      (d) => {
        d.nodes[1] = nodeSchema.parse({
          ...d.nodes[1],
          inputBindings: { topic: { source: 'input', path: 'request.topic' } },
          outputSchema: { type: 'number' },
        });
      },
    );
  fail(e, childRun.id);
  const done = e.run(run.id),
    failed = done.executions[1];
  expect(done.status).toBe('completed');
  expect(failed).toMatchObject({
    status: 'failed',
    port: 'failed',
    originalInput: { request: { topic: 'research' } },
    childRunIds: [childRun.id],
  });
  expect(done.output).toEqual({
    input: { topic: 'research' },
    output: null,
    error: {
      nodeId: 'agent',
      executionId: failed.id,
      kind: 'workflow',
      category: 'child',
      message: failed.error,
      child: {
        runId: childRun.id,
        workflowId: child.id,
        version: 1,
        executionId: e.run(childRun.id).executions.at(-1)!.id,
      },
    },
  });
  assertContract(
    WORKFLOW_FAILURE_ROUTE_SCHEMA,
    done.output!,
    'Workflow failure',
  );
  expect(e.run(childRun.id).status).toBe('failed');
  expect(e.inspect(childRun.id).handledFailure).toEqual({
    runId: run.id,
    executionId: failed.id,
  });
  expect(
    e
      .inspect(run.id)
      .events.filter((event) => event.type === 'node.failure_routed'),
  ).toHaveLength(1);
  expect(() => e.retry(run.id)).toThrow('Only failed runs');
});

it.each([undefined, 'fail'] as const)(
  'preserves terminal behavior for %s',
  (onFailure) => {
    const e = setup(),
      child = publish(e, childDefinition()),
      d = parentDefinition(child.id);
    d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], onFailure });
    d.edges = d.edges.filter((edge) => edge.port !== 'failed');
    const parent = publish(e, d);
    const run = e.start(parent.id, {}).run;
    fail(e, e.inspect(run.id).children[0].id);
    expect(e.run(run.id).status).toBe('failed');
    expect(e.run(run.id).executions[1].port).toBeUndefined();
  },
);

it.each([42, 'wrong'])(
  'handles successful child output %j through the matching route',
  (value) => {
    const e = setup(),
      { run, childRun } = fixture(e, {}, (d) => {
        d.nodes[1].outputSchema = { type: 'number' };
      });
    const work = e.claim(e.available(childRun.id)[0].id, worker);
    e.submit(work.id, work.token!, value);
    const done = e.run(run.id);
    expect(done.status).toBe('completed');
    expect(e.run(childRun.id).status).toBe('completed');
    expect(e.inspect(childRun.id).handledFailure).toBeUndefined();
    if (typeof value === 'number') expect(done.output).toBe(42);
    else {
      expect(done.output).toMatchObject({
        output: 'wrong',
        error: {
          kind: 'workflow',
          category: 'output',
          child: { runId: childRun.id },
        },
      });
      expect(done.executions[1]).toMatchObject({
        output: 'wrong',
        status: 'failed',
        port: 'failed',
      });
      assertContract(
        WORKFLOW_FAILURE_ROUTE_SCHEMA,
        done.output!,
        'Workflow output failure',
      );
    }
  },
);

it.each(['parent', 'child'] as const)(
  'keeps %s cancellation terminal without following Failed',
  (cancel) => {
    const e = setup(),
      { run, childRun } = fixture(e);
    e.cancel(cancel === 'parent' ? run.id : childRun.id);
    expect(e.run(run.id).status).toBe(
      cancel === 'parent' ? 'cancelled' : 'failed',
    );
    expect(e.run(run.id).executions[1].port).toBeUndefined();
    expect(
      e
        .inspect(run.id)
        .events.some((event) => event.type === 'node.failure_routed'),
    ).toBe(false);
  },
);

it('lets parent cancellation win before a pending child failure is observed', () => {
  const e = setup(),
    { run, childRun } = fixture(e);
  e.store.put('runs', {
    ...e.run(childRun.id),
    status: 'failed',
    error: 'Failure awaiting observation',
  });
  e.cancel(run.id);
  e.pump();
  expect(e.run(run.id).status).toBe('cancelled');
  expect(e.run(run.id).executions[1].port).toBeUndefined();
});

it('keeps invalid caller bindings and target workflow input terminal before dispatch', () => {
  const e = setup(),
    childD = childDefinition();
  childD.inputSchema = { type: 'number' };
  const child = publish(e, childD);
  for (const inputBindings of [
    undefined,
    { absent: { source: 'input', path: 'missing' } },
  ]) {
    const d = parentDefinition(child.id);
    d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], inputBindings });
    const parent = publish(e, d),
      run = e.start(parent.id, {}).run;
    expect(run.status).toBe('failed');
    expect(run.executions[1].port).toBeUndefined();
    expect(e.inspect(run.id).children).toHaveLength(0);
  }
});

it('keeps incomplete routes saveable and rejects routed detached calls at publication', () => {
  const e = setup(),
    child = publish(e, childDefinition()),
    d = parentDefinition(child.id);
  d.edges = d.edges.filter(
    (edge) => edge.port !== 'default' || edge.source !== 'agent',
  );
  expect(nodeInputHint(d, d.nodes[2]).schema).toEqual(
    WORKFLOW_FAILURE_ROUTE_SCHEMA,
  );
  expect(diagnoseDraft(d).definition).toBeDefined();
  expect(() => validateDefinition(d)).toThrow();
  d.edges.push({
    id: 'success',
    source: 'agent',
    target: 'exit',
    port: 'default',
  });
  expect(() => validateDefinition(d)).not.toThrow();
  d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], mode: 'detached' });
  expect(() => validateDefinition(d)).toThrow('detached Workflow');
});

it('keeps a missing persisted target pin terminal without allocating a child', () => {
  const e = setup(),
    child = publish(e, childDefinition()),
    parent = publish(e, parentDefinition(child.id));
  const snapshot = e.store.getVersion(parent.id, 1)!;
  snapshot.definition.nodes[1] = nodeSchema.parse({
    ...snapshot.definition.nodes[1],
    version: 999,
  });
  e.store.version(snapshot);
  const { run, children } = e.start(parent.id, {});
  expect(run.status).toBe('failed');
  expect(run.error).toContain('Published workflow version not found');
  expect(run.executions[1].port).toBeUndefined();
  expect(children).toEqual([]);
});

it('does not retry a handled child while its parent waits for recovery, and retries only a failed recovery step', () => {
  const e = setup(),
    { run, childRun } = fixture(e, {}, (d) => {
      d.nodes.splice(
        2,
        0,
        nodeSchema.parse({
          id: 'recovery',
          kind: 'agent',
          label: 'Recovery',
          prompt: 'Recover',
          maxAttempts: 1,
        }),
      );
      d.edges.find((edge) => edge.port === 'failed')!.target = 'recovery';
      d.edges.push({
        id: 'recovered',
        source: 'recovery',
        target: 'exit',
        port: 'default',
      });
    });
  fail(e, childRun.id);
  const childBefore = e.inspect(childRun.id);
  expect(e.run(run.id).status).toBe('waiting');
  expect(() => e.retry(childRun.id)).toThrow('handled');
  const recover = e.claim(
    e.available(run.id).find((work) => work.runId === run.id)!.id,
    worker,
  );
  e.reportFailure(recover.id, recover.token!, 'Recovery needs another try');
  e.retry(run.id);
  const retry = e.claim(
    e.available(run.id).find((work) => work.runId === run.id)!.id,
    worker,
  );
  e.submit(retry.id, retry.token!, { recovered: true });
  expect(e.run(run.id).output).toEqual({ recovered: true });
  expect(e.inspect(childRun.id)).toEqual(childBefore);
  expect(e.inspect(run.id).children).toHaveLength(1);
});

it('fails an incompatible recovery destination while preserving the handled call and child', () => {
  const e = setup(),
    { run, childRun } = fixture(e, {}, (d) => {
      d.nodes[2].inputSchema = { type: 'number' };
    });
  fail(e, childRun.id);
  expect(e.run(run.id)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('Return result input'),
  });
  expect(e.run(run.id).executions[1].port).toBe('failed');
  expect(e.inspect(run.id).children).toHaveLength(1);
});

it('rolls back a failed recovery write and treats it as a terminal persistence failure', () => {
  const e = setup(),
    { run, childRun } = fixture(e),
    put = e.store.put.bind(e.store);
  let injected = false;
  vi.spyOn(e.store, 'put').mockImplementation((collection, value: any) => {
    if (
      !injected &&
      collection === 'runs' &&
      value.id === run.id &&
      value.executions?.some((step: any) => step.port === 'failed')
    ) {
      injected = true;
      throw new Error('Injected persistence failure');
    }
    return put(collection, value);
  });
  fail(e, childRun.id);
  expect(injected).toBe(true);
  expect(e.run(run.id)).toMatchObject({
    status: 'failed',
    error: 'Injected persistence failure',
  });
  expect(e.run(run.id).executions[1].port).toBeUndefined();
  expect(e.run(childRun.id).status).toBe('failed');
  expect(
    e
      .inspect(run.id)
      .events.some((event) => event.type === 'node.failure_routed'),
  ).toBe(false);
});

it('resumes a persisted child failure after restart and never reroutes the same call twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-waited-recovery-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  const e = setup(path),
    { run, childRun } = fixture(e);
  const child = e.run(childRun.id);
  child.status = 'failed';
  child.error = 'Persisted failure';
  child.executions.at(-1)!.status = 'failed';
  e.store.put('runs', child);
  e.stop();
  e.store.close();
  engines.pop();
  const resumed = setup(path);
  resumed.pump();
  expect(resumed.run(run.id)).toMatchObject({
    status: 'completed',
    output: { error: { category: 'child', child: { runId: childRun.id } } },
  });
  const before = resumed.inspect(run.id);
  resumed.pump();
  expect(resumed.inspect(run.id)).toEqual(before);
});

it.each(['all', 'collect'] as const)(
  'treats a recovered child failure as successful item work under Batch %s',
  (failurePolicy) => {
    const e = setup(),
      child = publish(e, childDefinition());
    const call = nodeSchema.parse({
      id: 'work',
      kind: 'workflow',
      workflowId: child.id,
      version: 1,
      onFailure: 'route',
      label: 'Waited call',
    });
    const d = batchDefinition(call, { failurePolicy });
    d.edges.push({
      id: 'failed',
      source: 'work',
      port: 'failed',
      target: 'batch',
      targetHandle: 'end',
    });
    const parent = publish(e, d),
      run = e.start(parent.id, [1, 2]).run;
    for (const work of e.available(run.id)) {
      const claimed = e.claim(work.id, worker);
      e.reportFailure(claimed.id, claimed.token!, 'Item failure');
    }
    expect(e.run(run.id).status).toBe('completed');
    const outputs = e.run(run.id).output as any[];
    expect(outputs).toHaveLength(2);
    for (const output of outputs)
      expect(
        failurePolicy === 'collect' ? output.output : output,
      ).toMatchObject({ error: { category: 'child' } });
    if (failurePolicy === 'collect')
      expect(outputs.every((output) => output.status === 'completed')).toBe(
        true,
      );
  },
);

it('bounds deliberate failure-recovery loops and creates separate children for each visit', () => {
  const e = setup(),
    { run } = fixture(e, {}, (d) => {
      d.maxSteps = 4;
      d.edges.find((edge) => edge.port === 'failed')!.target = 'agent';
    });
  for (let i = 0; i < 3; i++) fail(e, e.available(run.id)[0].runId);
  expect(e.run(run.id).error).toContain('step limit');
  expect(e.inspect(run.id).children).toHaveLength(3);
  expect(
    e.run(run.id).executions.filter((step) => step.port === 'failed'),
  ).toHaveLength(3);
});

it('rolls back route-enabled child allocation when the caller link cannot be persisted', () => {
  const e = setup(),
    child = publish(e, childDefinition()),
    parent = publish(e, parentDefinition(child.id));
  const put = e.store.put.bind(e.store);
  let injected = false;
  vi.spyOn(e.store, 'put').mockImplementation((collection, value: any) => {
    if (
      !injected &&
      collection === 'runs' &&
      value.workflowId === parent.id &&
      value.executions?.some((step: any) => step.childRunIds?.length)
    ) {
      injected = true;
      throw new Error('Cannot save child link');
    }
    return put(collection, value);
  });
  const run = e.start(parent.id, {}).run;
  expect(injected).toBe(true);
  expect(run).toMatchObject({
    status: 'failed',
    error: 'Cannot save child link',
  });
  expect(e.inspect(run.id).children).toHaveLength(0);
  expect(run.executions[1].childRunIds).toEqual([]);
  expect(run.executions[1].port).toBeUndefined();
  expect(e.store.runs()).toHaveLength(1);
});

it('routes a validly dispatched child internal input failure without treating it as a caller dispatch error', () => {
  const e = setup(),
    d = childDefinition();
  d.nodes[1].inputSchema = { type: 'number' };
  const child = publish(e, d),
    parent = publish(e, parentDefinition(child.id)),
    run = e.start(parent.id, {}).run;
  expect(run).toMatchObject({
    status: 'completed',
    output: { error: { category: 'child', child: { workflowId: child.id } } },
  });
  expect(e.inspect(run.id).children[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('input'),
  });
});

it('retains nested child provenance without turning a recovered inner failure into an outer failure', () => {
  const e = setup(),
    child = publish(e, childDefinition()),
    inner = publish(e, parentDefinition(child.id));
  const outer = publish(e, workflowCall(inner.id)),
    root = e.start(outer.id, {}).run;
  const work = e.available(root.id)[0];
  fail(e, work.runId);
  expect(e.run(root.id).status).toBe('completed');
  expect(e.run(root.id).executions[1].port).toBe('default');
  expect(e.run(root.id).output).toMatchObject({
    error: { child: { runId: work.runId, workflowId: child.id } },
  });
});

it('keeps the parent pin and route policy immutable after newer publications', () => {
  const e = setup(),
    { run, parent, child, childRun } = fixture(e);
  const newChild = childDefinition();
  newChild.nodes[1].label = 'Changed child';
  e.update(child.id, { draft: newChild, draftRevision: child.draftRevision });
  e.publish(child.id);
  const plain = parentDefinition(child.id, 'fail');
  plain.nodes[1] = nodeSchema.parse({ ...plain.nodes[1], version: 2 });
  e.update(parent.id, { draft: plain, draftRevision: parent.draftRevision });
  e.publish(parent.id);
  fail(e, childRun.id);
  expect(e.run(run.id)).toMatchObject({
    version: 1,
    status: 'completed',
    output: { error: { child: { version: 1 } } },
  });
});

it('routes an interrupted child failure after restart without replaying the interrupted operation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-child-interrupted-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  const operation = vi.fn(() => new Promise<Json>(() => {}));
  const e = new Engine(new Store(path), process.cwd(), {
    substituteOperation: operation,
  });
  engines.push(e);
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Interrupted operation',
    kind: 'script',
    language: 'javascript',
    command: 'return 42;',
  });
  const child = publish(e, d),
    parent = publish(e, parentDefinition(child.id)),
    run = e.start(parent.id, {}).run;
  expect(operation).toHaveBeenCalledTimes(1);
  e.stop();
  e.store.close();
  engines.pop();
  const resumed = setup(path);
  resumed.pump();
  expect(resumed.run(run.id)).toMatchObject({
    status: 'completed',
    output: {
      error: {
        category: 'child',
        message: expect.stringContaining('Service interrupted'),
      },
    },
  });
  expect(operation).toHaveBeenCalledTimes(1);
});
