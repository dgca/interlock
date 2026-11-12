import { afterEach, expect, it, vi } from 'vitest';
import {
  type Run,
  type RunEvent,
  type WorkHoldInterval,
  type WorkRequest,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { nestedBatches } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

let engine: Engine;
function setup() {
  engine = new Engine(new Store(':memory:'), process.cwd());
  return engine;
}
afterEach(() => {
  engine.stop();
  engine.store.close();
  vi.useRealTimers();
});

function publish(name: string, definition: WorkflowDefinition) {
  const workflow = engine.create(name, '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}

it('keeps full inspection scoped to ordered related runs, work, holds, and selected events', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const e = setup();
  const detachedWorkflow = publish('Detached batch', nestedBatches(2));
  const definition = workflowCall(detachedWorkflow, 'detached', true);
  const prompt = e.prompts.create({
    name: 'Captured inspection prompt',
    description: '',
    content: 'Use the original instructions.',
  });
  const supervisor = definition.nodes.find((node) => node.id === 'after')!;
  if (supervisor.kind !== 'agent') throw new Error('Expected a supervisor');
  supervisor.promptIds = [prompt.id];
  const workflowId = publish('Supervisor', definition);
  const root = e.start(workflowId, [[1, 2], [3]]).run;
  const rootWork = e.available(root.id).find((work) => work.runId === root.id)!;
  const detachedWork = e
    .available(root.id)
    .find((work) => work.runId !== root.id)!;
  const item = e.run(detachedWork.runId);
  const invocationId = item.parentExecutionId;
  const itemIndex = item.batchItemIndex;
  expect(invocationId).toBeTruthy();
  expect(itemIndex).toBeDefined();
  delete item.parentExecutionId;
  delete item.batchItemIndex;
  e.store.put('runs', item);

  e.claim(detachedWork.id, {
    workerId: 'inspection-test',
    freshContext: false,
    skills: [],
    tools: [],
  });
  e.manageWorkHold({
    action: 'hold',
    workId: rootWork.id,
    expectedAttempt: rootWork.attempt,
    expectedRevision: 0,
    actor: 'operator',
    category: 'other',
    reason: 'Waiting for review',
    checkpointRef: 'review',
  });

  const draft = structuredClone(definition);
  draft.nodes[0].label = 'Updated entry';
  e.update(workflowId, {
    draft,
    draftRevision: e.workflow(workflowId).draftRevision,
  });
  e.publish(workflowId);

  const before = e.inspect(root.id);
  const legacy = e.inspect(item.id);
  const hold = before.work[0].holdHistory!.items[0];
  const runs = e.store.runs();
  const work = e.store.work();
  expect(before.children.map((child) => child.id)).toEqual(
    runs.filter((run) => run.parentRunId === root.id).map((run) => run.id),
  );
  expect(before.children).toEqual([
    expect.objectContaining({ parentMode: 'detached' }),
  ]);
  expect(before.descendants.map((child) => child.id)).toEqual(
    runs.filter((run) => run.id !== root.id).map((run) => run.id),
  );
  expect(before.descendants).toContainEqual(
    expect.objectContaining({ id: item.id, batchNodeId: item.batchNodeId }),
  );
  expect(legacy.run).toMatchObject({
    parentExecutionId: invocationId,
    batchItemIndex: itemIndex,
  });
  expect(e.run(item.id)).not.toHaveProperty('parentExecutionId');
  expect(before.descendantWork.map((assignment) => assignment.id)).toEqual(
    work.map((assignment) => assignment.id),
  );
  expect(
    before.descendantWork.find(
      (assignment) => assignment.id === detachedWork.id,
    ),
  ).toMatchObject({
    status: 'claimed',
    workerId: 'inspection-test',
  });
  for (const assignment of before.descendantWork)
    expect(assignment).not.toHaveProperty('token');
  expect(before.work).toEqual(
    before.descendantWork.filter((assignment) => assignment.runId === root.id),
  );
  expect(before.work[0].savedPrompts).toMatchObject([
    { id: prompt.id, revision: 1 },
  ]);
  expect(hold.reason).toBe('Waiting for review');
  expect(before.run.waiting?.kind).toBe('hold');
  expect(before.definitionAvailable).toBe(true);
  expect(before.definition?.nodes[0].label).toBe(definition.nodes[0].label);
  expect(before.events).toEqual(
    e.store.list<RunEvent>('events').filter((event) => event.runId === root.id),
  );
  expect(before.events.length).toBeGreaterThan(0);

  const marker = 'UNRELATED_RETAINED_INSPECTION_PAYLOAD';
  const payload = marker + 'x'.repeat(4_096);
  e.store.transaction(() => {
    for (let index = 0; index < 1_000; index++) {
      const id = `unrelated-run-${index}`;
      const workId = `unrelated-work-${index}`;
      e.store.put<Run>('runs', {
        ...root,
        id,
        status: 'completed',
        executions: [],
        input: payload,
        output: payload,
        value: payload,
      });
      e.store.put<WorkRequest>('work', {
        ...rootWork,
        id: workId,
        runId: id,
        status: 'completed',
        prompt: payload,
        input: payload,
      });
      e.store.put<RunEvent>('events', {
        id: `unrelated-event-${index}`,
        runId: id,
        type: 'run.completed',
        at: root.updatedAt,
        message: payload,
      });
      e.store.put<WorkHoldInterval>('workHolds', {
        ...hold,
        id: `unrelated-hold-${index}`,
        workId,
        runId: id,
        reason: payload,
      });
    }
  });

  let unrelatedParses = 0;
  const parse = JSON.parse;
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
    if (text.includes(marker)) unrelatedParses++;
    return parse(text, reviver);
  });
  try {
    expect(e.inspect(root.id)).toEqual(before);
    expect(e.inspect(item.id)).toEqual(legacy);
  } finally {
    spy.mockRestore();
  }
  expect(unrelatedParses).toBe(0);
});

it('still inspects a completed legacy Batch item when its recorded parent is missing', () => {
  const e = setup();
  const definition = nestedBatches(2);
  const workflowId = publish('Legacy batch', definition);
  const root = e.start(workflowId, [[1]]).run;
  const work = e.available(root.id)[0];
  const item = e.run(work.runId);
  e.store.put<Run>('runs', {
    ...item,
    id: 'legacy-completed-item',
    status: 'completed',
    parentRunId: 'missing-parent',
    parentExecutionId: undefined,
    batchItemIndex: undefined,
  });

  const inspection = e.inspect('legacy-completed-item');
  expect(inspection.run).toMatchObject({
    parentRunId: 'missing-parent',
    status: 'completed',
    batchNodeId: item.batchNodeId,
  });
  expect(inspection.run).not.toHaveProperty('parentExecutionId');
  expect(inspection.children).toEqual([]);
  expect(inspection.definitionAvailable).toBe(true);
});
