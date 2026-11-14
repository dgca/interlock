import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  diagnoseDraft,
  nodeSchema,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const worker = { workerId: 'w', freshContext: false, tools: [], skills: [] };
afterEach(() => engines.splice(0).forEach((e) => e.stop()));

function definition(
  tool: Record<string, unknown> = {},
  edge: Record<string, unknown> = {},
): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'checks',
      kind: 'script',
      label: 'Run checks',
      language: 'javascript',
      command:
        'return { passed: input.target === "all", target: input.target }',
      timeoutMs: 5000,
      inputSchema: {
        type: 'object',
        required: ['target'],
        properties: { target: { type: 'string' } },
      },
      ...tool,
    }),
  );
  d.edges.push({
    id: 'tool',
    source: 'agent',
    target: 'checks',
    port: 'default',
    kind: 'tool',
    ...edge,
  });
  return d;
}
function claimed(d = definition()) {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  const w = e.create('Tools', '', d);
  e.publish(w.id);
  const runId = e.start(w.id, {}).run.id;
  const work = e.available(runId)[0];
  const { token } = e.claim(work.id, worker);
  return { e, runId, workId: work.id, token: token! };
}

it('rejects tool edges that could not run inside the calling turn', () => {
  expect(() => validateDefinition(definition())).not.toThrow();
  expect(() =>
    validateDefinition(definition({ executionMode: 'background' })),
  ).toThrow(/background Scripts cannot be tools/);
  expect(() => validateDefinition(definition({ timeoutMs: 400_000 }))).toThrow(
    /exceeds the Agent assignment claim lease of 300s/,
  );
  const routed = definition();
  routed.edges.push({
    id: 'r',
    source: 'checks',
    target: 'exit',
    port: 'default',
  });
  expect(() => validateDefinition(routed)).toThrow(
    /tool step cannot also be connected by routes/,
  );
  const twice = definition();
  twice.nodes.push({ ...twice.nodes.at(-1)!, id: 'checks2' });
  twice.edges.push({ ...twice.edges.at(-1)!, id: 'tool2', target: 'checks2' });
  expect(diagnoseDraft(twice).diagnostics.map((d) => d.code)).toContain(
    'tool_name_duplicate',
  );
});

it('runs a tool call as a linked child run without charging route steps', async () => {
  const { e, runId, workId, token } = claimed();
  const result = await e.callTool({
    workId,
    token,
    name: 'run_checks',
    arguments: { target: 'all' },
  });
  expect(result).toMatchObject({
    status: 'completed',
    output: { passed: true, target: 'all' },
    calls: { attempt: 1, execution: 1 },
  });
  const parent = e.run(runId);
  const agent = parent.executions.at(-1)!;
  expect(agent.childRunIds).toEqual([result.runId]);
  expect(parent.executions).toHaveLength(2);
  expect(e.run(result.runId)).toMatchObject({
    parentRunId: runId,
    parentExecutionId: agent.id,
    toolCall: { workId, attempt: 1, executionId: agent.id, name: 'run_checks' },
    executions: [{ nodeId: 'checks', status: 'completed' }],
  });
  // The agent continues its turn and its result routes as before.
  e.submit(workId, token, {});
  expect(e.run(runId).status).toBe('completed');
});

it('authorises calls by the current claim and enforces per-edge limits', async () => {
  const d = definition({}, { maxCallsPerAttempt: 1, maxCallsPerExecution: 2 });
  Object.assign(d.nodes[1], { maxAttempts: 3 });
  const { e, workId, token } = claimed(d);
  await expect(
    e.callTool({ workId, token: 'other', name: 'run_checks', arguments: {} }),
  ).rejects.toThrow(/Claim token does not match/);
  await expect(
    e.callTool({ workId, token, name: 'deploy', arguments: {} }),
  ).rejects.toThrow(/Unknown tool deploy. Available: run_checks/);
  await expect(
    e.callTool({ workId, token, name: 'run_checks', arguments: {} }),
  ).rejects.toThrow(/run_checks arguments/);
  const call = {
    workId,
    token,
    name: 'run_checks',
    arguments: { target: 'a' },
  };
  await e.callTool(call);
  await expect(e.callTool(call)).rejects.toThrow(
    /limit of 1 calls per claim attempt/,
  );
  e.reportFailure(workId, token, 'retry');
  const retry = e.claim(workId, worker).token!;
  await e.callTool({ ...call, token: retry });
  e.reportFailure(workId, retry, 'retry');
  const third = e.claim(workId, worker).token!;
  await expect(e.callTool({ ...call, token: third })).rejects.toThrow(
    /limit of 2 calls for this Agent execution/,
  );
});

it('holds calls under a pause and cancels them when the claim ends first', async () => {
  const { e, runId, workId, token } = claimed();
  const run = e.run(runId);
  e.pauses.create({
    target: { scope: 'workflow', workflowId: run.workflowId },
    actor: 'test',
    reason: 'maintenance',
  });
  const held = await e.callTool({
    workId,
    token,
    name: 'run_checks',
    arguments: { target: 'a' },
    waitMs: 0,
  });
  expect(held).toMatchObject({ status: 'running', blockedBy: 'pause' });
  e.reportFailure(workId, token, 'gave up');
  e.pump();
  expect(e.run(held.runId)).toMatchObject({
    status: 'cancelled',
    cancellationReason: 'calling claim ended before the tool started',
    executions: [],
  });
});

it('keeps tool edges through export and holds an imported tool Script for approval', async () => {
  const source = new Engine(new Store(':memory:'), process.cwd());
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(source, e);
  const w = source.create('Shared tools', '', definition());
  source.publish(w.id);
  importWorkflows(e.store, exportWorkflows(source.store, w.id));
  expect(e.workflow(w.id).draft.edges).toContainEqual(
    expect.objectContaining({ id: 'tool', kind: 'tool', target: 'checks' }),
  );
  const runId = e.start(w.id, {}).run.id;
  const work = e.available(runId)[0];
  const token = e.claim(work.id, worker).token!;
  const call = { workId: work.id, token, name: 'run_checks', waitMs: 0 };
  const held = await e.callTool({ ...call, arguments: { target: 'all' } });
  expect(held).toMatchObject({ status: 'waiting', blockedBy: 'approval' });
  await appRouter
    .createCaller({ engine: e })
    .scripts.approve({ runId: held.runId, executionId: held.executionId! });
  const done = await e.callTool({
    ...call,
    arguments: {},
    callId: held.callId,
    waitMs: 5000,
  });
  expect(done).toMatchObject({ status: 'completed', output: { passed: true } });
});
