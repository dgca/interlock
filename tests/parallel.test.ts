import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  nodeSchema,
  definitionSchema,
  validateDefinition,
  type Json,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { parallelDefinition } from './fixtures/parallel';

const engines = new Set<Engine>();
const directories: string[] = [];
function setup(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.add(engine);
  return engine;
}
function close(engine: Engine) {
  engine.stop();
  engine.store.close();
  engines.delete(engine);
}
afterEach(() => {
  for (const engine of engines) close(engine);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});
function publish(engine: Engine, definition = parallelDefinition()) {
  const workflow = engine.create('Parallel test', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function claim(engine: Engine, runId: string, nodeId: string) {
  const work = engine.available(runId).find((item) => item.nodeId === nodeId)!;
  expect(work).toBeDefined();
  return engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
}
function submit(engine: Engine, runId: string, nodeId: string, output: Json) {
  const work = claim(engine, runId, nodeId);
  engine.submit(work.id, work.token!, output);
}

it('dispatches distinct reviewers before either finishes and joins literal keys once', () => {
  const engine = setup(),
    definition = parallelDefinition({ keys: ['__proto__', 'constructor'] });
  const run = engine.start(publish(engine, definition), { commit: 'a' }).run;
  expect(
    engine
      .available(run.id)
      .map((work) => [work.nodeId, work.input, work.executorModel]),
  ).toEqual([
    ['r0', { commit: 'a' }, 'gpt-5'],
    ['r1', { commit: 'a' }, 'claude-sonnet-4-6'],
  ]);
  const second = claim(engine, run.id, 'r1'),
    first = claim(engine, run.id, 'r0');
  engine.submit(second.id, second.token!, null);
  expect(engine.inspect(run.id).run.status).toBe('waiting');
  engine.submit(first.id, first.token!, { findings: [] });
  engine.submit(first.id, first.token!, { findings: [] });
  const finished = engine.inspect(run.id).run;
  expect(finished.output).toEqual(
    JSON.parse('{"__proto__":{"findings":[]},"constructor":null}'),
  );
  expect(
    finished.executions.filter((step) => step.kind === 'parallel'),
  ).toHaveLength(1);
  expect(finished.parallelSteps).toBe(2);
});

it('rejects unsafe literal-key contracts and enforces the pattern on joined results', () => {
  const engine = setup();
  const definition = parallelDefinition({ keys: ['__proto__', 'code'] });
  const group = definition.nodes.find((node) => node.kind === 'parallel')!;
  group.outputSchema = JSON.parse(
    '{"properties":{"__proto__":{"type":"string"}}}',
  );
  const unsafe = engine.create('Unsafe joined contract', '', definition);
  expect(() => engine.publish(unsafe.id)).toThrow(
    /Use patternProperties with "\^__proto__\$"/,
  );

  group.outputSchema = {
    type: 'object',
    required: ['__proto__', 'code'],
    properties: { code: { type: 'boolean' } },
    patternProperties: { '^__proto__$': { type: 'string' } },
    additionalProperties: false,
  };
  const workflow = publish(engine, definition);
  const rejected = engine.start(workflow, null).run;
  submit(engine, rejected.id, 'r0', 42);
  submit(engine, rejected.id, 'r1', true);
  expect(engine.run(rejected.id)).toMatchObject({
    status: 'failed',
    error: expect.stringMatching(/Reviews output.*__proto__/),
  });
  expect(engine.run(rejected.id).output).toBeUndefined();

  const accepted = engine.start(workflow, null).run;
  submit(engine, accepted.id, 'r0', 'reviewed');
  submit(engine, accepted.id, 'r1', true);
  expect(engine.run(accepted.id).status).toBe('completed');
  expect(engine.run(accepted.id).output).toEqual(
    JSON.parse('{"__proto__":"reviewed","code":true}'),
  );
});

it('saves incomplete drafts while rejecting branch crossings, cycles, bad keys and binding leaks at publication', () => {
  const engine = setup();
  const valid = parallelDefinition();
  expect(validateDefinition(valid)).toEqual(valid);
  for (const [edit, error] of [
    [
      (d: typeof valid) => {
        d.edges = d.edges.filter((e) => e.id !== 'start-r0');
      },
      /branch start and Out/,
    ],
    [
      (d: typeof valid) => {
        Object.assign(
          d.edges.find((e) => e.id === 'join-r0')!,
          { target: 'r1', targetHandle: 'default' },
        );
      },
      /cross Parallel branches/,
    ],
    [
      (d: typeof valid) => {
        Object.assign(
          d.edges.find((e) => e.id === 'join-r0')!,
          { target: 'r0', targetHandle: 'default' },
        );
      },
      /cycles/,
    ],
    [
      (d: typeof valid) => {
        const p = d.nodes.find((n) => n.kind === 'parallel')!;
        p.branches[1].key = p.branches[0].key;
      },
      /keys must be nonblank and unique/,
    ],
    [
      (d: typeof valid) => {
        d.nodes.find((n) => n.id === 'r0')!.inputBindings = {
          other: { source: 'node', nodeId: 'r1', path: '' },
        };
      },
      /same execution scope/,
    ],
    [
      (d: typeof valid) => {
        d.nodes.find((n) => n.id === 'r0')!.parallelBranchId = 'missing';
      },
      /branch does not exist/,
    ],
    [
      (d: typeof valid) => {
        d.nodes[d.nodes.findIndex((n) => n.id === 'r0')] = nodeSchema.parse({
          id: 'r0',
          label: 'Nested Batch',
          kind: 'batch',
          parallelId: 'parallel',
          parallelBranchId: 'r0',
        });
        d.edges.push({
          id: 'nested-item',
          source: 'r0',
          target: 'r0',
          port: 'item',
        });
        d.edges.find((e) => e.id === 'join-r0')!.port = 'complete';
      },
      /batch cannot belong/,
    ],
  ] as const) {
    const draft = structuredClone(valid);
    edit(draft);
    const created = engine.create('Incomplete', '', draft);
    expect(() => engine.publish(created.id)).toThrow(error);
  }
});

it('joins only the selected conditional return and creates new branch identities on an outer loop', () => {
  const engine = setup();
  const d = parallelDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'round',
      label: 'Next round',
      kind: 'switch',
      path: 'code',
      cases: [{ port: 'again', equals: 1 }],
      default: 'done',
    }),
  );
  d.edges.find((e) => e.id === 'out')!.target = 'round';
  d.edges.push(
    { id: 'again', source: 'round', port: 'again', target: 'parallel' },
    { id: 'done', source: 'round', port: 'done', target: 'exit' },
  );
  d.nodes.push(
    nodeSchema.parse({
      id: 'decide',
      label: 'Choose return',
      kind: 'switch',
      path: '',
      cases: [{ port: 'one', equals: 1 }],
      default: 'other',
      parallelId: 'parallel',
      parallelBranchId: 'r1',
    }),
  );
  Object.assign(
    d.edges.find((e) => e.id === 'join-r1')!,
    { target: 'decide', targetHandle: 'default' },
  );
  d.edges.push(
    {
      id: 'one',
      source: 'decide',
      target: 'parallel',
      port: 'one',
      targetHandle: 'join',
    },
    {
      id: 'other',
      source: 'decide',
      target: 'parallel',
      port: 'other',
      targetHandle: 'join',
    },
  );
  const run = engine.start(publish(engine, d), { round: 0 }).run;
  const first = claim(engine, run.id, 'r0');
  engine.submit(first.id, first.token!, 'old');
  submit(engine, run.id, 'r1', 1);
  const next = engine.available(run.id).find((w) => w.nodeId === 'r0')!;
  expect(next.runId).not.toBe(first.runId);
  expect(next.input).toEqual({ spec: 'old', code: 1 });
  engine.submit(first.id, first.token!, 'old');
  submit(engine, run.id, 'r1', 2);
  expect(engine.inspect(run.id).run.status).toBe('waiting');
  submit(engine, run.id, 'r0', 'new');
  expect(engine.inspect(run.id).run.output).toEqual({ spec: 'new', code: 2 });
  expect(engine.inspect(run.id).run.parallelSteps).toBe(6);
});

it('retains completed branches over restart, fail-fast and retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-parallel-'));
  directories.push(dir);
  const path = join(dir, 'runs.sqlite');
  let engine = setup(path);
  const run = engine.start(
    publish(
      engine,
      parallelDefinition({ keys: ['spec', 'code', 'lint', 'scan'] }),
    ),
    'first',
  ).run;
  submit(engine, run.id, 'r0', 'retained');
  expect(engine.available(run.id).map((w) => w.nodeId)).toEqual(['r1', 'r2']);
  close(engine);
  engine = setup(path);
  const fail = claim(engine, run.id, 'r1');
  engine.reportFailure(fail.id, fail.token!, 'review unavailable');
  const failed = engine.inspect(run.id).run;
  const group = failed.executions.at(-1)!;
  expect(failed.status).toBe('failed');
  expect(group.childRunIds).toHaveLength(3);
  expect(engine.inspect(group.childRunIds[2]).run.status).toBe('cancelled');
  expect(() => engine.retry(fail.runId)).toThrow(/parent run/);
  engine.retry(run.id);
  expect(engine.available(run.id).map((w) => w.nodeId)).toEqual(['r1', 'r2']);
  submit(engine, run.id, 'r2', true);
  submit(engine, run.id, 'r3', 'ok');
  submit(engine, run.id, 'r1', 'recovered');
  const done = engine.inspect(run.id).run;
  expect(done.output).toEqual({
    spec: 'retained',
    code: 'recovered',
    lint: true,
    scan: 'ok',
  });
  expect(done.executions.find((e) => e.kind === 'parallel')!.id).toBe(group.id);
  expect(engine.inspect(group.childRunIds[0]).run.executions).toHaveLength(1);
  expect(done.parallelSteps).toBe(6);
});

it('bounds branch step starts by the owning run allowance', () => {
  const engine = setup();
  const tooSmall = engine.start(
    publish(engine, parallelDefinition({ maxSteps: 3 })),
    null,
  ).run;
  expect(tooSmall.status).toBe('failed');
  expect(tooSmall.error).toMatch(/step limit/);
  expect(tooSmall.parallelSteps).toBe(1);
  expect(engine.available(tooSmall.id)).toHaveLength(0);
  const enough = engine.start(
    publish(engine, parallelDefinition({ maxSteps: 5, concurrency: 1 })),
    null,
  ).run;
  expect(engine.available(enough.id).map((w) => w.nodeId)).toEqual(['r0']);
  submit(engine, enough.id, 'r0', 1);
  expect(engine.available(enough.id).map((w) => w.nodeId)).toEqual(['r1']);
  submit(engine, enough.id, 'r1', 2);
  expect(engine.inspect(enough.id).run.output).toEqual({ spec: 1, code: 2 });
});

it('rolls back a branch allocation if recording its parent link fails', () => {
  const engine = setup(),
    workflow = publish(engine);
  const put = engine.store.put.bind(engine.store);
  const spy = vi
    .spyOn(engine.store, 'put')
    .mockImplementation((collection, value) => {
      if (
        collection === 'runs' &&
        (value as Run).executions.at(-1)?.kind === 'parallel' &&
        (value as Run).executions.at(-1)?.status === 'waiting'
      ) {
        spy.mockRestore();
        throw new Error('injected parent write failure');
      }
      return put(collection, value);
    });
  const run = engine.start(workflow, null).run;
  expect(run.status).toBe('failed');
  expect(run.error).toContain('injected parent write failure');
  expect(engine.store.runTrees(new Set([run.id])).map((r) => r.id)).toEqual([
    run.id,
  ]);
  expect(run.executions.at(-1)?.childRunIds).toEqual([]);
  engine.retry(run.id);
  expect(engine.available(run.id)).toHaveLength(2);
});

it('rejects late results and requires stop confirmation before retrying a cancelled claimed sibling', () => {
  const engine = setup();
  const run = engine.start(publish(engine), {}).run;
  const failed = claim(engine, run.id, 'r0');
  const revoked = claim(engine, run.id, 'r1');
  engine.reportFailure(failed.id, failed.token!, 'failed');
  expect(engine.inspect(revoked.runId).run.status).toBe('cancelled');
  expect(() => engine.submit(revoked.id, revoked.token!, 'late')).toThrow(
    /token|claim/i,
  );
  expect(() => engine.retry(run.id)).toThrow(
    /Confirm stopped for revoked work/,
  );
  expect(engine.available(run.id)).toHaveLength(0);
  engine.manageWorkResources({
    action: 'release',
    workId: revoked.id,
    expectedAttempt: revoked.attempt,
    actor: 'test',
    confirmStopped: true,
  });
  engine.retry(run.id);
  expect(engine.available(run.id).map((work) => work.nodeId)).toEqual([
    'r0',
    'r1',
  ]);
});

it('shares parent admission while honoring an aggregate claim budget', () => {
  const engine = setup();
  const d = parallelDefinition();
  d.maxActiveRuns = 1;
  const workflow = publish(engine, d);
  const budget = {
    scope: 'lifecycle',
    unknownUsage: 'allow',
    limits: { claims: { max: 1 } },
  } as const;
  const run = engine.start(workflow, null, 1, budget).run;
  expect(engine.available(run.id)).toHaveLength(2);
  const secondRun = engine.start(workflow, null).run;
  expect(secondRun.status).toBe('queued');
  submit(engine, run.id, 'r0', 'spec');
  expect(engine.available(run.id)).toHaveLength(0);
  expect(
    engine.continuation.briefing({ id: run.id, limit: 20 }).budgetBlocked
      ?.total,
  ).toBe(1);
  engine.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: { ...budget, limits: { claims: { max: 2 } } },
  });
  submit(engine, run.id, 'r1', 'code');
  expect(engine.inspect(run.id).run.output).toEqual({
    spec: 'spec',
    code: 'code',
  });
  expect(engine.available(secondRun.id)).toHaveLength(2);
});

it('does not count active Parallel branches when their parent stage is excluded from admission', () => {
  const engine = setup();
  const definition = parallelDefinition();
  definition.maxActiveRuns = 1;
  definition.excludeStages = ['Review'];
  definition.nodes.find((node) => node.kind === 'parallel')!.stage = 'Review';
  const workflow = publish(engine, definition);

  const first = engine.start(workflow, null).run;
  expect(engine.inspect(first.id).run.stage).toBe('Review');
  expect(engine.available(first.id)).toHaveLength(2);
  const second = engine.start(workflow, null).run;
  expect(second.status).toBe('waiting');
  expect(engine.available(second.id)).toHaveLength(2);
});

it('keeps branch history local while retaining the original workflow input', () => {
  const engine = setup();
  const d = parallelDefinition();
  d.nodes.push(
    nodeSchema.parse({
      kind: 'agent',
      id: 'after-r0',
      label: 'Follow-up',
      parallelId: 'parallel',
      parallelBranchId: 'r0',
      prompt: 'Use the branch output.',
      inputBindings: {
        root: { source: 'runInput', path: 'original' },
        prior: { source: 'node', nodeId: 'r0', path: '' },
        recent: { source: 'execution', nodeId: 'r0', path: 'visitCount' },
      },
    }),
  );
  Object.assign(
    d.edges.find((e) => e.id === 'join-r0')!,
    { target: 'after-r0', targetHandle: 'default' },
  );
  d.edges.push({
    id: 'join-after',
    source: 'after-r0',
    target: 'parallel',
    port: 'default',
    targetHandle: 'join',
  });
  const group = d.nodes.find((node) => node.kind === 'parallel')!;
  group.inputBindings = { new: { source: 'input', path: 'original' } };
  const run = engine.start(publish(engine, d), { original: 'data' }).run;
  expect(engine.available(run.id).map((w) => w.input)).toEqual([
    { new: 'data' },
    { new: 'data' },
  ]);
  submit(engine, run.id, 'r0', 'first');
  expect(
    engine.available(run.id).find((w) => w.nodeId === 'after-r0')?.input,
  ).toEqual({ root: 'data', prior: 'first', recent: 1 });
  submit(engine, run.id, 'after-r0', true);
  submit(engine, run.id, 'r1', 'second');
  expect(engine.inspect(run.id).run.output).toEqual({
    spec: true,
    code: 'second',
  });
});

it('rejects Parallel in fixture preflight without creating live work', () => {
  const engine = setup(),
    workflowId = publish(engine);
  const suite = engine.testbench.createSuite({
    workflowId,
    content: {
      name: 'Parallel case',
      cases: [
        {
          id: 'case',
          name: 'Case',
          input: {},
          fixtures: [{ kind: 'agent', nodeId: 'r0', output: 'never read' }],
          assertions: [],
        },
      ],
    },
  });
  const simulation = engine.simulations.request({
    action: 'run',
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId: 'case',
    version: 1,
    requestId: 'reject-parallel',
  });
  expect(simulation).toMatchObject({ state: 'unsupported' });
  expect(JSON.stringify(simulation)).toContain(
    'Parallel is unsupported in fixture simulation',
  );
  expect(engine.available()).toEqual([]);
});

it('validates the joined contract without replaying successful branches on retry', () => {
  const engine = setup(),
    d = parallelDefinition();
  d.nodes.find((n) => n.kind === 'parallel')!.outputSchema = {
    type: 'object',
    properties: { code: { type: 'string' } },
    required: ['code'],
  };
  const run = engine.start(publish(engine, d), {}).run;
  submit(engine, run.id, 'r0', 'retained');
  submit(engine, run.id, 'r1', 42);
  const failed = engine.inspect(run.id).run;
  expect(failed.status).toBe('failed');
  expect(failed.output).toBeUndefined();
  engine.retry(run.id);
  const retried = engine.inspect(run.id).run;
  expect(retried.status).toBe('failed');
  expect(retried.parallelSteps).toBe(2);
  expect(engine.available(run.id)).toEqual([]);
});

function withDetachedBranch(engine: Engine) {
  const called = engine.create(
    'Detached child',
    '',
    definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Input', kind: 'entry' },
        {
          id: 'detached-work',
          label: 'Detached work',
          kind: 'agent',
          prompt: 'Keep working.',
        },
        { id: 'exit', label: 'Output', kind: 'exit' },
      ],
      edges: [
        { id: 'start', source: 'entry', target: 'detached-work' },
        { id: 'finish', source: 'detached-work', target: 'exit' },
      ],
    }),
  );
  engine.publish(called.id);
  const d = parallelDefinition();
  d.nodes[d.nodes.findIndex((n) => n.id === 'r0')] = nodeSchema.parse({
    id: 'r0',
    label: 'Start detached',
    kind: 'workflow',
    workflowId: called.id,
    version: 1,
    mode: 'detached',
    parallelId: 'parallel',
    parallelBranchId: 'r0',
  });
  return { definition: d, childWorkflowId: called.id };
}

it('preserves detached work inside a branch when a sibling fails', () => {
  const engine = setup();
  const { definition, childWorkflowId } = withDetachedBranch(engine);
  const parent = engine.start(publish(engine, definition), {}).run;
  const detached = engine
    .available(parent.id)
    .find((w) => w.nodeId === 'detached-work')!;
  const failed = claim(engine, parent.id, 'r1');
  engine.reportFailure(failed.id, failed.token!, 'failed');
  expect(engine.inspect(parent.id).run.status).toBe('failed');
  expect(engine.inspect(detached.runId).run).toMatchObject({
    status: 'waiting',
    parentMode: 'detached',
  });
  engine.retry(parent.id);
  submit(engine, parent.id, 'r1', 'recovered');
  expect(engine.inspect(parent.id).run.output).toEqual({
    spec: { runId: detached.runId, workflowId: childWorkflowId, version: 1 },
    code: 'recovered',
  });
  expect(engine.available(parent.id).map((w) => w.id)).toEqual([detached.id]);
});

it('resumes at the next step when a sibling fails after a detached dispatch', () => {
  const engine = setup();
  const { definition, childWorkflowId } = withDetachedBranch(engine);
  definition.nodes.push(
    nodeSchema.parse({
      id: 'follow',
      label: 'After dispatch',
      kind: 'agent',
      prompt: 'Continue with the detached run reference.',
      parallelId: 'parallel',
      parallelBranchId: 'r0',
    }),
  );
  Object.assign(
    definition.edges.find((edge) => edge.id === 'join-r0')!,
    { target: 'follow', targetHandle: 'default' },
  );
  definition.edges.push({
    id: 'follow-join',
    source: 'follow',
    target: 'parallel',
    port: 'default',
    targetHandle: 'join',
  });
  const workflow = publish(engine, definition);
  const put = engine.store.put.bind(engine.store);
  const spy = vi
    .spyOn(engine.store, 'put')
    .mockImplementation((table, value) => {
      if (table === 'work' && (value as WorkRequest).nodeId === 'r1') {
        spy.mockRestore();
        throw new Error('Sibling assignment could not be saved');
      }
      return put(table, value);
    });

  const parent = engine.start(workflow, { commit: 'candidate' }).run;
  expect(parent.status).toBe('failed');
  expect(parent.error).toContain('Sibling assignment could not be saved');
  const branch = engine.run(parent.executions.at(-1)!.childRunIds[0]);
  expect(branch).toMatchObject({ status: 'cancelled', cursor: 'follow' });
  const dispatch = branch.executions[0];
  expect(branch.executions).toHaveLength(1);
  expect(dispatch).toMatchObject({ nodeId: 'r0', status: 'completed' });
  expect(dispatch.childRunIds).toHaveLength(1);
  const detachedId = dispatch.childRunIds[0];
  const reference = {
    runId: detachedId,
    workflowId: childWorkflowId,
    version: 1,
  };

  engine.retry(parent.id);
  submit(engine, parent.id, 'r1', 'recovered');
  const follow = claim(engine, parent.id, 'follow');
  expect(follow.input).toEqual(reference);
  engine.submit(follow.id, follow.token!, 'continued');
  expect(engine.run(branch.id).executions[0]).toEqual(dispatch);
  expect(engine.run(parent.id)).toMatchObject({
    status: 'completed',
    output: { spec: 'continued', code: 'recovered' },
    parallelSteps: 4,
  });
  expect(
    engine.store
      .runTrees(new Set([branch.id]))
      .filter((run) => run.parentMode === 'detached')
      .map((run) => run.id),
  ).toEqual([detachedId]);
  expect(engine.run(detachedId).status).toBe('waiting');
});
