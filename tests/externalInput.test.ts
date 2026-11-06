import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { Store } from '@interlock/storage';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
const paths: string[] = [];
function open(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.push(engine);
  return engine;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function definition() {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'input',
    label: 'Approval',
    outputSchema: {
      type: 'object',
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    },
  });
  return definition;
}
function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Approval', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function target(engine: Engine, runId: string) {
  return { runId, executionId: engine.run(runId).executions.at(-1)!.id };
}

it('validates values, replaces revisions, and replays retained receipts across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-input-'));
  paths.push(dir);
  const path = join(dir, 'test.db');
  let engine = open(path);
  const workflowId = publish(engine, definition());
  const run = engine.start(workflowId, null).run;
  const ids = target(engine, run.id);
  const status = { action: 'status' as const, ...ids, includeValue: true };
  const submit = { action: 'submit' as const, ...ids };
  const first = {
    ...submit,
    requestId: 'one',
    expectedRevision: 0,
    value: { approved: true, extra: 1 },
  };
  const second = {
    ...submit,
    requestId: 'two',
    expectedRevision: 1,
    value: { approved: false, note: 'pending-unique' },
  };
  expect(engine.available(run.id)).toEqual([]);
  expect(engine.externalInputs.status(status)).toMatchObject({
    state: 'waiting',
    revision: 0,
  });
  expect(() =>
    engine.externalInputs.mutate({ ...first, value: { approved: 'yes' } }),
  ).toThrow(/Submitted value/);
  const receipt = engine.externalInputs.mutate(first);
  engine.externalInputs.mutate(second);
  expect(
    engine.externalInputs.mutate({
      ...first,
      value: { extra: 1, approved: true },
    }),
  ).toEqual(receipt);
  expect(() =>
    engine.externalInputs.mutate({ ...first, value: { approved: false } }),
  ).toThrow(/different value/);
  expect(() =>
    engine.externalInputs.mutate({ ...second, requestId: 'stale' }),
  ).toThrow(/revision conflict/);
  expect(engine.externalInputs.status(status)).toMatchObject({
    revision: 2,
    value: second.value,
  });
  const briefing = engine.continuation.briefing({ id: run.id, limit: 10 });
  expect(briefing.blockers.items[0]).toMatchObject({
    ...ids,
    reason: 'external_input',
    externalInput: { revision: 2, waitingSince: expect.any(String) },
  });
  expect(JSON.stringify(briefing)).not.toContain('pending-unique');
  expect(
    engine.externalInputs.status({ ...status, includeValue: false }),
  ).not.toHaveProperty('value');

  engine.stop();
  engine.store.close();
  engines.pop();
  engine = open(path);
  expect(engine.externalInputs.status(status)).toMatchObject({
    revision: 2,
    value: second.value,
  });
  const accept = { action: 'accept' as const, ...ids, expectedRevision: 2 };
  expect(() =>
    engine.externalInputs.mutate({ ...accept, expectedRevision: 1 }),
  ).toThrow(/revision conflict/);
  const accepted = engine.externalInputs.mutate(accept);
  const after = engine.inspect(run.id);
  expect(after.run).toMatchObject({
    status: 'completed',
    output: second.value,
  });

  engine.stop();
  engine.store.close();
  engines.pop();
  engine = open(path);
  expect(engine.externalInputs.mutate(accept)).toEqual(accepted);
  expect(engine.externalInputs.mutate(first)).toEqual(receipt);
  expect(engine.externalInputs.status(status)).toMatchObject({
    acceptance: accepted,
  });
  expect(engine.inspect(run.id)).toEqual(after);
  const bundle = exportWorkflows(engine.store, workflowId);
  expect(JSON.stringify(bundle)).not.toContain('pending-unique');
  expect(importWorkflows(engine.store, bundle).changed).toEqual([]);
  const item = engine.history.preview({ rootRunIds: [run.id] }).items[0];
  expect(item.collections.externalInputReceipts).toBe(2);
  engine.history.delete({
    roots: [{ runId: run.id, confirmation: item.confirmation! }],
    acknowledgeHistoryLoss: true,
  });
  expect(engine.store.list('externalInputReceipts')).toEqual([]);
});

it('rolls back acceptance and keeps the pending value when a late write fails', () => {
  const engine = open();
  const { run } = engine.start(publish(engine, definition()), null);
  const ids = target(engine, run.id);
  engine.externalInputs.mutate({
    action: 'submit',
    ...ids,
    requestId: 'one',
    value: { approved: true },
  });
  const status = { action: 'status' as const, ...ids, includeValue: true };
  const before = () => ({
    inspection: engine.inspect(run.id),
    status: engine.externalInputs.status(status),
    receipts: engine.store.list('externalInputReceipts'),
    cursor: engine.continuation.briefing({ id: run.id, limit: 10 }).cursor,
  });
  const snapshot = before();
  const accept = { action: 'accept' as const, ...ids, expectedRevision: 1 };
  const remove = vi.spyOn(engine.store, 'remove').mockImplementationOnce(() => {
    throw new Error('Injected cleanup failure');
  });
  expect(() => engine.externalInputs.mutate(accept)).toThrow(
    'Injected cleanup failure',
  );
  expect(remove).toHaveBeenCalledWith('externalInputValues', ids.executionId);
  expect(before()).toEqual(snapshot);
  remove.mockRestore();
  const receipt = engine.externalInputs.mutate(accept);
  expect(engine.externalInputs.mutate(accept)).toEqual(receipt);
  expect(
    engine.run(run.id).executions.filter((e) => e.kind === 'exit'),
  ).toHaveLength(1);
});

it('holds attached Batch items, wakes child cursors, and leaves detached runs independent', async () => {
  const engine = open();
  const child = publish(engine, definition());
  const root = batchDefinition(
    nodeSchema.parse({
      id: 'work',
      kind: 'workflow',
      label: 'Detached',
      workflowId: child,
      version: 1,
      mode: 'detached',
    }),
  );
  root.nodes.push(
    nodeSchema.parse({
      id: 'wait',
      kind: 'input',
      label: 'Item approval',
      batchId: 'batch',
    }),
  );
  root.edges.find((edge) => edge.id === 'end')!.source = 'wait';
  root.edges.push({
    id: 'item-wait',
    source: 'work',
    target: 'wait',
    port: 'default',
  });
  const { run } = engine.start(publish(engine, root), [null]);
  const attached = engine
    .inspect(run.id)
    .descendants.find((r) => r.batchNodeId)!;
  const detached = engine
    .inspect(run.id)
    .descendants.find((r) => r.parentMode === 'detached')!;
  const ids = target(engine, attached.id);
  const detachedIds = target(engine, detached.id);
  const childCursor = engine.continuation.briefing({
    id: attached.id,
    limit: 10,
  }).cursor;
  const wait = engine.continuation.wait({
    id: attached.id,
    limit: 10,
    cursor: childCursor,
    timeoutMs: 1000,
  });
  engine.externalInputs.mutate({
    action: 'hold',
    runId: run.id,
    expectedRevision: 0,
  });
  const heldSnapshot = await wait;
  expect(heldSnapshot.changed).toBe(true);
  expect(
    heldSnapshot.blockers.items.find((item) => item.runId === attached.id),
  ).toMatchObject({
    externalInput: { heldByRunId: run.id },
  });
  engine.externalInputs.mutate({
    action: 'hold',
    runId: attached.id,
    expectedRevision: 0,
  });
  engine.externalInputs.mutate({
    action: 'submit',
    ...ids,
    requestId: 'one',
    value: true,
  });
  engine.externalInputs.mutate({
    action: 'submit',
    ...ids,
    requestId: 'two',
    value: null,
  });
  engine.externalInputs.mutate({
    action: 'submit',
    ...detachedIds,
    requestId: 'one',
    value: { approved: true },
  });
  engine.externalInputs.mutate({
    action: 'accept',
    ...detachedIds,
    expectedRevision: 1,
  });
  expect(engine.run(detached.id).status).toBe('completed');
  const accept = { action: 'accept' as const, ...ids, expectedRevision: 2 };
  expect(() => engine.externalInputs.mutate(accept)).toThrow(/on hold/);
  engine.externalInputs.mutate({
    action: 'release',
    runId: attached.id,
    expectedRevision: 1,
  });
  expect(() => engine.externalInputs.mutate(accept)).toThrow(/on hold/);
  engine.externalInputs.mutate({
    action: 'release',
    runId: run.id,
    expectedRevision: 1,
  });
  expect(engine.run(attached.id).status).toBe('waiting');
  engine.externalInputs.mutate(accept);
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: [null],
  });
});

it('isolates loop visits and closes the wait on cancellation', () => {
  const engine = open();
  const d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'again',
      kind: 'condition',
      label: 'Again?',
      path: 'approved',
      equals: false,
    }),
  );
  d.edges[1].target = 'again';
  d.edges.push(
    { id: 'repeat', source: 'again', target: 'agent', port: 'true' },
    { id: 'exit', source: 'again', target: 'exit', port: 'false' },
  );
  const { run } = engine.start(publish(engine, d), null);
  const first = target(engine, run.id);
  engine.externalInputs.mutate({
    action: 'submit',
    ...first,
    requestId: 'answer',
    value: { approved: false },
  });
  const oldAcceptance = engine.externalInputs.mutate({
    action: 'accept',
    ...first,
    expectedRevision: 1,
  });
  const second = target(engine, run.id);
  expect(second.executionId).not.toBe(first.executionId);
  expect(
    engine.externalInputs.mutate({
      action: 'accept',
      ...first,
      expectedRevision: 1,
    }),
  ).toEqual(oldAcceptance);
  expect(
    engine.externalInputs.status({ action: 'status', ...second }),
  ).toMatchObject({ revision: 0 });
  expect(() =>
    engine.externalInputs.mutate({
      action: 'submit',
      ...first,
      requestId: 'late',
      value: { approved: true },
    }),
  ).toThrow(/no longer waiting/);
  const answer = {
    action: 'submit' as const,
    ...second,
    requestId: 'answer',
    value: { approved: true },
  };
  const receipt = engine.externalInputs.mutate(answer);
  engine.cancel(run.id);
  expect(
    engine.externalInputs.status({ action: 'status', ...second }),
  ).toMatchObject({ state: 'cancelled', revision: 1 });
  expect(engine.externalInputs.mutate(answer)).toEqual(receipt);
  expect(() =>
    engine.externalInputs.mutate({
      action: 'accept',
      ...second,
      expectedRevision: 1,
    }),
  ).toThrow(/no longer waiting/);
  const item = engine.history.preview({ rootRunIds: [run.id] }).items[0];
  expect(item.collections.externalInputValues).toBe(1);
  engine.history.delete({
    roots: [{ runId: run.id, confirmation: item.confirmation! }],
    acknowledgeHistoryLoss: true,
  });
  expect(engine.store.list('externalInputValues')).toEqual([]);
});

it('inherits a hold for a child created after the hold and rejects a mismatched run ID', () => {
  const engine = open();
  const child = publish(engine, definition());
  const d = workflowCall(child, 'wait');
  const handoff = blankDefinition().nodes[1];
  d.nodes.push({ ...handoff, id: 'handoff' });
  d.edges.find((edge) => edge.source === 'entry')!.target = 'handoff';
  const caller = d.nodes.find((node) => node.kind === 'workflow')!;
  d.edges.push({
    id: 'dispatch',
    source: 'handoff',
    target: caller.id,
    port: 'default',
  });
  const parent = publish(engine, d);
  const { run } = engine.start(parent, null);
  engine.externalInputs.mutate({
    action: 'hold',
    runId: run.id,
    expectedRevision: 0,
  });
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, null);
  const childRun = engine.inspect(run.id).children[0];
  const ids = target(engine, childRun.id);
  const submit = {
    action: 'submit' as const,
    ...ids,
    requestId: 'approval',
    value: { approved: true },
  };
  expect(() =>
    engine.externalInputs.mutate({ ...submit, runId: run.id }),
  ).toThrow(/not found/);
  engine.externalInputs.mutate(submit);
  const accept = { action: 'accept' as const, ...ids, expectedRevision: 1 };
  expect(() => engine.externalInputs.mutate(accept)).toThrow(/on hold/);
  engine.externalInputs.mutate({
    action: 'release',
    runId: run.id,
    expectedRevision: 1,
  });
  engine.externalInputs.mutate(accept);
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: { approved: true },
  });
  engine.deleteWorkflow(parent);
  expect(engine.store.list('externalInputReceipts')).toEqual([]);
});

it('validates only own submitted fields and constrains reserved JSON keys through patterns', () => {
  const engine = open();
  const d = definition();
  d.nodes[1].outputSchema = {
    type: 'object',
    required: ['toString'],
    properties: {
      toString: { type: 'string' },
      constructor: { type: 'boolean' },
    },
  };
  const { run } = engine.start(publish(engine, d), null);
  const ids = target(engine, run.id);
  const submit = { action: 'submit' as const, ...ids, requestId: 'own-fields' };
  expect(() => engine.externalInputs.mutate({ ...submit, value: {} })).toThrow(
    /Missing required field "toString"/,
  );
  const value = { toString: 'answer' };
  engine.externalInputs.mutate({ ...submit, value });
  engine.externalInputs.mutate({
    action: 'accept',
    ...ids,
    expectedRevision: 1,
  });
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: value,
  });

  d.nodes[1].outputSchema = JSON.parse(
    '{"type":"object","properties":{"__proto__":{"type":"boolean"}}}',
  );
  const invalid = engine.create('Unsupported property declaration', '', d);
  expect(() => engine.publish(invalid.id)).toThrow(/Use patternProperties/);

  d.nodes[1].outputSchema = {
    type: 'object',
    required: ['__proto__'],
    patternProperties: { '^__proto__$': { type: 'boolean' } },
    additionalProperties: false,
  };
  const other = engine.start(publish(engine, d), null).run;
  const otherIds = target(engine, other.id);
  const second = { ...submit, ...otherIds };
  expect(() => engine.externalInputs.mutate({ ...second, value: {} })).toThrow(
    /Missing required field "__proto__"/,
  );
  expect(() =>
    engine.externalInputs.mutate({
      ...second,
      value: JSON.parse('{"__proto__":123}'),
    }),
  ).toThrow(/expects yes\/no/);
  const reserved = JSON.parse('{"__proto__":true}');
  expect(
    engine.externalInputs.mutate({ ...second, value: reserved }),
  ).toMatchObject({ revision: 1 });
  engine.externalInputs.mutate({
    action: 'accept',
    ...otherIds,
    expectedRevision: 1,
  });
  expect(JSON.stringify(engine.run(other.id).output)).toBe(
    JSON.stringify(reserved),
  );
});
