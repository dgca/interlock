import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  definitionSchema,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';

const stores: Store[] = [];
const engines: Engine[] = [];
function setup(path = ':memory:') {
  const store = new Store(path);
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  engines.push(engine);
  return engine;
}
const worker = {
  workerId: 'worker',
  freshContext: false,
  tools: [],
  skills: [],
};
function definition(node: Record<string, unknown>, timeout = false) {
  return definitionSchema.parse({
    maxSteps: 3,
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'pause', label: 'Pause', ...node },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'pause' },
      { id: 'out', source: 'pause', target: 'exit' },
      ...(timeout
        ? [{ id: 'timeout', source: 'pause', port: 'timeout', target: 'exit' }]
        : []),
    ],
  });
}
function start(
  engine: Engine,
  d: WorkflowDefinition,
  input: any = { message: 'original' },
) {
  const workflow = engine.create('Timer', '', d);
  engine.publish(workflow.id);
  return engine.start(workflow.id, input).run;
}
const delay = () =>
  definition({ kind: 'wait', timing: { kind: 'duration', ms: 600_000 } });
const agent = () =>
  definition(
    {
      kind: 'agent',
      prompt: 'Respond',
      unclaimedTimeoutMs: 1000,
      outputSchema: { type: 'string' },
    },
    true,
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-09-10T12:00:00Z');
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  vi.useRealTimers();
});

it('waits once, persists a deadline, and passes input through without spending steps on ticks', () => {
  const engine = setup();
  const run = start(engine, delay());
  expect(run.status).toBe('waiting');
  expect(run.executions.at(-1)).toMatchObject({
    resumeAt: '2026-09-10T12:10:00.000Z',
  });
  for (let i = 0; i < 10; i++) engine.pump();
  expect(engine.run(run.id).executions).toHaveLength(2);
  vi.setSystemTime('2026-09-10T12:09:59.999Z');
  engine.pump();
  expect(engine.run(run.id).status).toBe('waiting');
  vi.setSystemTime('2026-09-10T12:10:00Z');
  engine.pump();
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: run.input,
  });
  expect(engine.run(run.id).executions).toHaveLength(3);
});
it('resumes an overdue persisted wait after reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-timer-'));
  try {
    const engine = setup(join(dir, 'db'));
    const run = start(engine, delay());
    engine.stop();
    stores.splice(stores.indexOf(engine.store), 1);
    engine.store.close();
    vi.setSystemTime('2026-09-11T12:00:00Z');
    const restarted = setup(join(dir, 'db'));
    restarted.pump();
    expect(restarted.run(run.id)).toMatchObject({
      status: 'completed',
      output: run.input,
    });
    expect(restarted.run(run.id).executions[1].resumeAt).toBe(
      '2026-09-10T12:10:00.000Z',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('cancels waits without resuming them later', () => {
  const engine = setup();
  const run = start(engine, delay());
  engine.cancel(run.id);
  vi.setSystemTime('2026-09-11T12:00:00Z');
  engine.pump();
  expect(engine.run(run.id).status).toBe('cancelled');
  expect(engine.run(run.id).executions).toHaveLength(2);
});
it('accepts an absolute timestamp from input and immediately resumes past deadlines', () => {
  const engine = setup();
  const d = definition({
    kind: 'wait',
    timing: { kind: 'until', path: 'due' },
  });
  const run = start(engine, d, { due: '2026-09-10T14:00:00+02:00' });
  expect(run.status).toBe('completed');
});
it.each([
  'tomorrow',
  '2026-02-30T12:00:00Z',
  '2026-09-12T24:00:00Z',
  '2026-09-12',
  '2026-09-12T12:00:00',
  123,
  null,
])('fails an invalid deadline %s clearly', (due) => {
  const engine = setup();
  const run = start(
    engine,
    definition({ kind: 'wait', timing: { kind: 'until', path: 'due' } }),
    { due },
  );
  expect(run.status).toBe('failed');
  expect(run.error).toMatch(/timestamp.*timezone/i);
});
it('routes unclaimed work at its deadline with original input, independent of the result contract', () => {
  const engine = setup();
  const run = start(engine, agent());
  const work = engine.available()[0];
  vi.setSystemTime('2026-09-10T12:00:01Z');
  expect(() => engine.claim(work.id, worker)).toThrow('Work is not available');
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: run.input,
  });
  expect(engine.run(run.id).executions[1]).toMatchObject({ port: 'timeout' });
  expect(engine.inspect(run.id).work[0].status).toBe('timed_out');
});
it('lets claimed work finish past the unclaimed deadline', () => {
  const engine = setup();
  const run = start(engine, agent());
  const claim = engine.claim(engine.available()[0].id, worker);
  vi.setSystemTime('2026-09-10T12:00:02Z');
  engine.pump();
  expect(engine.run(run.id).status).toBe('waiting');
  expect(engine.submit(claim.id, claim.token!, 'answer').run.output).toBe(
    'answer',
  );
});
it('starts a fresh unclaimed deadline when a lease expires and rejects the old token', () => {
  const engine = setup();
  const run = start(engine, agent());
  const claim = engine.claim(engine.available()[0].id, worker, 1);
  vi.setSystemTime('2026-09-10T12:00:01Z');
  engine.pump();
  expect(engine.available()).toHaveLength(1);
  vi.setSystemTime('2026-09-10T12:00:02Z');
  engine.pump();
  expect(engine.run(run.id).status).toBe('completed');
  expect(() => engine.submit(claim.id, claim.token!, 'late')).toThrow();
});
it('requires the timeout route only when the deadline is enabled', () => {
  const d = agent();
  d.edges = d.edges.filter((e) => e.port !== 'timeout');
  expect(() => validateDefinition(d)).toThrow(/timeout/);
});

it('keeps an unclaimed deadline across engine restart, including downtime', () => {
  const first = setup();
  const run = start(first, agent());
  first.stop();
  vi.setSystemTime('2026-09-10T12:00:00.500Z');
  const restarted = new Engine(first.store, process.cwd());
  engines.push(restarted);
  restarted.pump();
  expect(restarted.available()[0].availableUntil).toBe(
    '2026-09-10T12:00:01.000Z',
  );
  vi.setSystemTime('2026-09-10T12:00:01Z');
  restarted.pump();
  expect(restarted.run(run.id).status).toBe('completed');
});
it('keeps ordinary agents waiting indefinitely and cancels timed assignments', () => {
  const engine = setup();
  const ordinary = start(
    engine,
    definition({ kind: 'agent', prompt: 'Respond' }),
  );
  const timed = start(engine, agent());
  engine.cancel(timed.id);
  vi.setSystemTime('2027-09-10T12:00:00Z');
  engine.pump();
  expect(engine.run(ordinary.id).status).toBe('waiting');
  expect(engine.run(timed.id).status).toBe('cancelled');
  expect(engine.inspect(timed.id).work[0].status).toBe('cancelled');
});
it('counts Batch item steps independently and supports timed branches returning to End', () => {
  const engine = setup();
  const d = definitionSchema.parse({
    maxSteps: 3,
    nodes: [
      { id: 'entry', label: 'Input', kind: 'entry' },
      { id: 'batch', label: 'Batch', kind: 'batch', concurrency: 50 },
      {
        id: 'agent',
        label: 'Respond',
        kind: 'agent',
        batchId: 'batch',
        prompt: 'Respond',
        unclaimedTimeoutMs: 1000,
      },
      {
        id: 'wait',
        label: 'Delay',
        kind: 'wait',
        batchId: 'batch',
        timing: { kind: 'duration', ms: 1000 },
      },
      { id: 'exit', label: 'Output', kind: 'exit' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'batch' },
      { id: 'item', source: 'batch', port: 'item', target: 'agent' },
      { id: 'result', source: 'agent', target: 'batch', targetHandle: 'end' },
      { id: 'timeout', source: 'agent', port: 'timeout', target: 'wait' },
      { id: 'end', source: 'wait', target: 'batch', targetHandle: 'end' },
      { id: 'out', source: 'batch', port: 'complete', target: 'exit' },
    ],
  });
  const input = Array.from({ length: 200 }, (_, i) => i);
  const run = start(engine, d, input);
  for (let i = 1; i <= 8; i++) {
    vi.setSystemTime(Date.parse('2026-09-10T12:00:00Z') + i * 1000);
    engine.pump();
  }
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: input,
  });
  expect(engine.run(run.id).executions).toHaveLength(3);
  expect(
    engine
      .inspect(run.id)
      .children.every((child) => child.executions.length === 2),
  ).toBe(true);
});
it('reports completed Batch items when an item exhausts its step budget', () => {
  const engine = setup();
  const d = definitionSchema.parse({
    maxSteps: 2,
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'batch', kind: 'batch', label: 'Batch', concurrency: 1 },
      {
        id: 'check',
        kind: 'condition',
        label: 'Check',
        batchId: 'batch',
        path: '',
        equals: 1,
      },
      {
        id: 'a',
        kind: 'wait',
        label: 'First wait',
        batchId: 'batch',
        timing: { kind: 'duration', ms: 0 },
      },
      {
        id: 'b',
        kind: 'wait',
        label: 'Second wait',
        batchId: 'batch',
        timing: { kind: 'duration', ms: 0 },
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'batch' },
      { id: 'item', source: 'batch', port: 'item', target: 'check' },
      {
        id: 'short',
        source: 'check',
        port: 'true',
        target: 'batch',
        targetHandle: 'end',
      },
      { id: 'long', source: 'check', port: 'false', target: 'a' },
      { id: 'next', source: 'a', target: 'b' },
      { id: 'end', source: 'b', target: 'batch', targetHandle: 'end' },
      { id: 'out', source: 'batch', port: 'complete', target: 'exit' },
    ],
  });
  const run = start(engine, d, [1, 2, 3]);
  expect(run.error).toContain('step limit exceeded (2 steps)');
  expect(run.error).toContain('1 of 3 Batch items completed');
});
