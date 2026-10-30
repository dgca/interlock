import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  runQuerySchema,
  withNextCall,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const opened: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', tools: [], skills: [], freshContext: false };
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  opened.push(e);
  return e;
}
function definition(maxRuns = 3) {
  const d = blankDefinition();
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns },
  });
  return d;
}
function publish(e: Engine, d = definition()) {
  const w = e.create('Recurring', '', d);
  e.publish(w.id);
  return w;
}
function finish(e: Engine, runId: string, output: any = { n: 1 }) {
  e.pump();
  const work = e.claim(e.available(runId)[0].id, worker);
  e.submit(work.id, work.token!, output);
  return work;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of opened.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

it('atomically passes checkpoints to the same version, links runs, and keeps final output separate', () => {
  const e = setup(),
    d = definition();
  d.inputSchema = {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
  };
  d.outputSchema = { type: 'string' };
  const w = publish(e, d),
    first = e.start(w.id, { n: 0 }).run;
  const work = finish(e, first.id, { n: 1 });
  const old = e.inspect(first.id);
  expect(old.run).toMatchObject({
    status: 'completed',
    chain: { rootRunId: first.id, index: 1 },
  });
  expect(old.run).not.toHaveProperty('output');
  expect(old.run.executions.at(-1)?.output).toEqual({ n: 1 });
  const second = e.run(old.run.chain!.nextRunId!);
  expect(second).toMatchObject({
    workflowId: w.id,
    version: 1,
    input: { n: 1 },
    executions: [],
    chain: { rootRunId: first.id, index: 2, previousRunId: first.id },
  });
  expect(second.parentRunId).toBeUndefined();
  expect(old.chain).toMatchObject({
    latestRunId: second.id,
    runCount: 2,
    maxRuns: 3,
  });
  const summary = withNextCall(e.continuation.summary(first.id, 20));
  expect(summary).toMatchObject({
    next: 'continue_as_new',
    chain: { nextRunId: second.id },
    nextCall: { tool: 'get_run_briefing', arguments: { id: second.id } },
  });
  e.submit(work.id, work.token!, { n: 1 });
  expect(e.store.runs()).toHaveLength(2);
  expect(
    e.store.findRuns(runQuerySchema.parse({ chainRootRunId: first.id })),
  ).toHaveLength(2);
  const changed = structuredClone(d);
  changed.maxSteps = 200;
  e.update(w.id, { draft: changed, draftRevision: w.draftRevision });
  e.publish(w.id);
  finish(e, second.id, { n: 2 });
  expect(e.run(e.run(second.id).chain!.nextRunId!).version).toBe(1);
});

it('rejects invalid successor input before completing the predecessor and retains the attempted checkpoint', () => {
  const e = setup(),
    d = definition();
  d.inputSchema = { type: 'object' };
  const w = publish(e, d),
    run = e.start(w.id, {}).run;
  finish(e, run.id, 42);
  expect(e.run(run.id)).toMatchObject({
    status: 'failed',
    executions: expect.arrayContaining([
      expect.objectContaining({ kind: 'exit', input: 42, status: 'failed' }),
    ]),
  });
  expect(e.run(run.id).error).toContain('Successor workflow input');
  expect(e.store.runs()).toHaveLength(1);
  expect(e.inspect(run.id).chain?.runCount).toBe(1);
});

it('rolls back successor, lineage and chain count when completion persistence fails', () => {
  const e = setup(),
    w = publish(e),
    run = e.start(w.id, {}).run;
  const put = e.store.put.bind(e.store);
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value: any) => {
      if (
        collection === 'runs' &&
        value.id === run.id &&
        value.status === 'completed'
      )
        throw new Error('injected write failure');
      return put(collection, value);
    });
  finish(e, run.id);
  expect(e.run(run.id).status).toBe('failed');
  expect(e.store.runs()).toHaveLength(1);
  expect(e.run(run.id).chain?.nextRunId).toBeUndefined();
  expect(e.inspect(run.id).chain).toMatchObject({
    latestRunId: run.id,
    runCount: 1,
  });
  spy.mockRestore();
  e.retry(run.id);
  expect(e.store.runs()).toHaveLength(2);
});

it('yields after each rollover and enforces a finite cap without resetting it on retry', () => {
  const e = setup(),
    d = definition();
  d.nodes = d.nodes.filter((n) => n.kind !== 'agent');
  d.edges = [
    { id: 'direct', source: 'entry', target: 'exit', port: 'default' },
  ];
  d.maxSteps = 2;
  const w = publish(e, d),
    first = e.start(w.id, { cursor: 1 }).run;
  expect(e.store.runs()).toHaveLength(2);
  e.pump();
  expect(e.store.runs()).toHaveLength(3);
  e.pump();
  expect(e.store.runs()).toHaveLength(3);
  const last = e.store.runs().at(-1)!;
  expect(last).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('chain limit'),
    chain: { index: 3 },
  });
  expect(last.executions.at(-1)?.input).toEqual({ cursor: 1 });
  e.retry(last.id);
  expect(e.store.runs()).toHaveLength(3);
  expect(e.inspect(first.id).chain?.runCount).toBe(3);
});

it('retains exactly one successor and chain state after reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-chain-'));
  dirs.push(directory);
  const path = join(directory, 'test.db'),
    e = setup(path),
    w = publish(e),
    first = e.start(w.id, {}).run;
  finish(e, first.id);
  const next = e.run(first.id).chain!.nextRunId!;
  e.stop();
  e.store.close();
  opened.pop();
  const resumed = setup(path);
  resumed.pump();
  resumed.pump();
  expect(resumed.store.runs()).toHaveLength(2);
  expect(resumed.run(next).chain?.previousRunId).toBe(first.id);
  resumed.cancel(first.id, 'chain');
  expect(resumed.run(next).status).toBe('cancelled');
  expect(resumed.inspect(first.id).chain?.cancelledAt).toBeDefined();
});

it('cancels the chain from a completed predecessor without reviving claims or permitting retries', () => {
  const e = setup(),
    w = publish(e),
    first = e.start(w.id, {}).run;
  finish(e, first.id);
  const next = e.run(first.id).chain!.nextRunId!;
  e.cancel(first.id);
  expect(e.run(next).status).not.toBe('cancelled');
  e.pump();
  const claim = e.claim(e.available(next)[0].id, worker);
  e.cancel(first.id, 'chain');
  expect(e.run(first.id).status).toBe('completed');
  expect(e.run(next).status).toBe('cancelled');
  expect(() => e.submit(claim.id, claim.token!, {})).toThrow();
  expect(e.store.runs()).toHaveLength(2);
  // Stopping a failed chain also forbids the ordinary failed-step retry path.
  const other = e.start(w.id, {}).run;
  const work = e.claim(e.available(other.id)[0].id, worker);
  e.reportFailure(work.id, work.token!, 'one');
  const retry = e.claim(work.id, worker);
  e.reportFailure(retry.id, retry.token!, 'two');
  e.cancel(other.id, 'chain');
  expect(() => e.retry(other.id)).toThrow('cancelled run chain');
});

it('carries budget consumption across the chain and includes earlier runs when installing a later budget', () => {
  const e = setup(),
    w = publish(e),
    first = e.start(w.id, {}, undefined, {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    }).run;
  const claim = finish(e, first.id),
    next = e.run(first.id).chain!.nextRunId!;
  e.pump();
  expect(e.available(next)).toHaveLength(0);
  expect(e.budgets.read(next).governing[0]).toMatchObject({
    runId: first.id,
    attempts: 1,
    state: 'blocked',
  });
  e.budgets.set({
    runId: next,
    expectedRevision: 0,
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 2 } },
    },
  });
  expect(e.available(next)).toHaveLength(0);
  e.budgets.set({ runId: first.id, expectedRevision: 1, budget: null });
  expect(e.available(next)).toHaveLength(1);
  e.usage.report({
    source: 'observer',
    workId: claim.id,
    attempt: claim.attempt,
    snapshot: {
      sequence: 1,
      final: true,
      models: [{ provider: 'test', model: 'test', inputTokens: 10 }],
    },
  });
  expect(e.usage.read({ runId: next }).totals.attempts).toBe(0);
  expect(e.usage.read({ runId: next, includeChain: true })).toMatchObject({
    includedRuns: 2,
    totals: { attempts: 1, tokens: { inputTokens: { value: 10 } } },
  });
});

it('does not turn a step-limit failure into implicit continuation', () => {
  const e = setup(),
    d = definition();
  d.maxSteps = 2;
  const w = publish(e, d),
    run = e.start(w.id, {}).run;
  finish(e, run.id);
  expect(e.run(run.id).error).toContain('step limit');
  expect(e.store.runs()).toHaveLength(1);
});

it('rejects continuing workflows invoked as children, without creating orphan runs', () => {
  const e = setup(),
    w = publish(e);
  for (const mode of ['wait', 'detached'] as const) {
    const parent = publish(e, workflowCall(w.id, mode));
    const run = e.start(parent.id, {}).run;
    expect(run.status).toBe('failed');
    expect(run.error).toContain('standalone');
    expect(e.inspect(run.id).children).toHaveLength(0);
  }
});

it('keeps Batch item behavior within a standalone continuing workflow', () => {
  const e = setup(),
    d = batchDefinition();
  d.nodes = d.nodes.map((n) =>
    n.kind === 'exit'
      ? nodeSchema.parse({ ...n, continueAsNew: { maxRuns: 2 } })
      : n,
  );
  const w = publish(e, d),
    first = e.start(w.id, [1]).run;
  const work = e.claim(e.available(first.id)[0].id, worker);
  e.submit(work.id, work.token!, 2);
  expect(e.run(first.id).status).toBe('completed');
  const next = e.run(e.run(first.id).chain!.nextRunId!);
  expect(next.input).toEqual([2]);
});

it('keeps the first captured prompts across rollovers and gives each successor fresh run-local bindings', () => {
  const e = setup(),
    d = definition();
  const p = e.prompts.create({
    name: 'Guidance',
    description: '',
    content: 'Original guidance',
  });
  const agent = d.nodes.find((n) => n.kind === 'agent')!;
  agent.promptIds = [p.id];
  const w = publish(e, d),
    first = e.start(w.id, { cursor: 0 }).run;
  e.prompts.update(p.id, p.revision, {
    name: p.name,
    description: p.description,
    content: 'New guidance',
  });
  finish(e, first.id, { cursor: 1 });
  const next = e.run(e.run(first.id).chain!.nextRunId!);
  e.pump();
  expect(next.promptSnapshots).toEqual(first.promptSnapshots);
  expect(e.available(next.id)[0].prompt).toContain('Original guidance');
  expect(e.available(next.id)[0].prompt).not.toContain('New guidance');
  expect(next.input).toEqual({ cursor: 1 });
});

it('supports a normal final Exit alongside a continuing Exit and stops without creating another run', () => {
  const e = setup(),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'choose',
      kind: 'switch',
      label: 'Choose',
      path: 'again',
      cases: [{ port: 'again', equals: true }],
      default: 'done',
    }),
  );
  d.nodes.push(
    nodeSchema.parse({ id: 'done', kind: 'exit', label: 'Final result' }),
  );
  d.edges = d.edges.filter((edge) => edge.source !== 'agent');
  d.edges.push(
    { id: 'choose', source: 'agent', target: 'choose', port: 'default' },
    { id: 'again', source: 'choose', target: 'exit', port: 'again' },
    { id: 'done', source: 'choose', target: 'done', port: 'done' },
  );
  d.outputSchema = { type: 'object', required: ['answer'] };
  const w = publish(e, d),
    first = e.start(w.id, {}).run;
  finish(e, first.id, { again: true });
  const next = e.run(first.id).chain!.nextRunId!;
  finish(e, next, { again: false, answer: 42 });
  expect(e.run(next).output).toEqual({ again: false, answer: 42 });
  expect(e.store.runs()).toHaveLength(2);
  e.pump();
  expect(e.store.runs()).toHaveLength(2);
});

it('retains chain records through ordinary work failure and never automatically retries a failed successor', () => {
  const e = setup(),
    w = publish(e),
    first = e.start(w.id, {}).run;
  finish(e, first.id);
  const next = e.run(first.id).chain!.nextRunId!;
  e.pump();
  const work = e.claim(e.available(next)[0].id, worker);
  e.reportFailure(work.id, work.token!, 'one');
  const retry = e.claim(work.id, worker);
  e.reportFailure(retry.id, retry.token!, 'two');
  e.pump();
  expect(e.run(next).status).toBe('failed');
  expect(e.store.runs()).toHaveLength(2);
  e.cancel(first.id, 'chain');
  expect(() => e.retry(next)).toThrow('cancelled run chain');
  e.deleteWorkflow(w.id);
  expect(e.store.list('runChains')).toEqual([]);
});

it('preserves definitions through draft editing and rejects conflicting published chain limits', () => {
  const e = setup(),
    d = definition();
  const w = e.create('Draft', '', d);
  expect(e.workflow(w.id).draft.nodes.at(-1)).toHaveProperty(
    'continueAsNew.maxRuns',
    3,
  );
  d.nodes.push(
    nodeSchema.parse({
      id: 'other',
      kind: 'exit',
      label: 'Other',
      continueAsNew: { maxRuns: 4 },
    }),
  );
  expect(() => validateDefinition(d)).toThrow('same maxRuns');
  expect(() =>
    nodeSchema.parse({
      id: 'exit',
      kind: 'exit',
      label: 'Exit',
      continueAsNew: {},
    }),
  ).toThrow();
});

it('keeps a long automatic chain shallow and advances only one rollover per engine turn', () => {
  const e = setup(),
    d = definition(300);
  d.nodes = d.nodes.filter((n) => n.kind !== 'agent');
  d.edges = [
    { id: 'direct', source: 'entry', target: 'exit', port: 'default' },
  ];
  const w = publish(e, d),
    first = e.start(w.id, { cursor: 1 }).run;
  for (let index = 2; index < 300; index++) e.pump();
  expect(e.store.runs()).toHaveLength(300);
  expect(e.store.runs().every((run) => !run.parentRunId)).toBe(true);
  expect(e.store.activeRuns()).toHaveLength(1);
  e.pump();
  expect(e.store.activeRuns()).toHaveLength(0);
  expect(e.inspect(first.id).chain?.runCount).toBe(300);
});

it('keeps late measured token and cost consumption across successors', () => {
  const e = setup(),
    w = publish(e),
    first = e.start(w.id, {}, undefined, {
      scope: 'lifecycle',
      unknownUsage: 'block',
      limits: {
        inputTokens: { max: 100 },
        cost: { currency: 'USD', threshold: { max: 100 } },
      },
    }).run;
  const one = finish(e, first.id),
    next = e.run(first.id).chain!.nextRunId!;
  e.pump();
  expect(e.available(next)).toHaveLength(0);
  const report = (work: typeof one, amount: number) =>
    e.usage.report({
      source: 'observer',
      workId: work.id,
      attempt: work.attempt,
      snapshot: {
        sequence: 1,
        final: true,
        models: [
          {
            provider: 'test',
            model: 'test',
            inputTokens: amount,
            cost: { currency: 'USD', amountMicros: amount, source: 'measured' },
          },
        ],
      },
    });
  report(one, 10);
  expect(e.available(next)).toHaveLength(1);
  const two = finish(e, next),
    third = e.run(next).chain!.nextRunId!;
  report(two, 90);
  e.pump();
  expect(e.available(third)).toHaveLength(0);
  expect(e.budgets.read(third).governing[0]).toMatchObject({
    includedRuns: 3,
    attempts: 2,
    state: 'blocked',
    checks: [
      { metric: 'inputTokens', value: 100, reasons: ['limit_reached'] },
      { metric: 'cost', value: 100, reasons: ['limit_reached'] },
    ],
  });
});

it('preserves detached descendants when stopping the chain from a predecessor', () => {
  const e = setup(),
    child = publish(e, blankDefinition()),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'dispatch',
      kind: 'workflow',
      label: 'Independent',
      workflowId: child.id,
      version: 1,
      mode: 'detached',
    }),
  );
  d.edges = d.edges.filter((edge) => edge.source !== 'entry');
  d.edges.push(
    { id: 'dispatch', source: 'entry', target: 'dispatch', port: 'default' },
    { id: 'work', source: 'dispatch', target: 'agent', port: 'default' },
  );
  const w = publish(e, d),
    first = e.start(w.id, {}).run;
  const ownWork = e
    .available(first.id)
    .find((work) => work.runId === first.id)!;
  const claim = e.claim(ownWork.id, worker);
  e.submit(claim.id, claim.token!, {});
  const next = e.run(first.id).chain!.nextRunId!;
  e.pump();
  e.cancel(first.id, 'chain');
  expect(e.run(next).status).toBe('cancelled');
  expect(
    e.inspect(first.id).descendants.every((run) => run.status === 'waiting'),
  ).toBe(true);
  expect(
    e.inspect(next).descendants.every((run) => run.status === 'waiting'),
  ).toBe(true);
});
