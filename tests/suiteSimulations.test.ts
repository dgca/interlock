import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  await tick();
});

const content = (answer: number) => ({
  name: 'Answers',
  cases: [
    {
      id: 'answer',
      name: 'Answer',
      input: {},
      fixtures: [
        { nodeId: 'agent', kind: 'agent' as const, output: { answer } },
      ],
      assertions: [
        {
          kind: 'output' as const,
          path: 'answer',
          operator: 'equals' as const,
          expected: 42,
        },
      ],
    },
    { id: 'idle', name: 'Never run', input: {} },
  ],
});

async function run(e: Engine, suite: { id: string; revision: number }) {
  const requestId = crypto.randomUUID();
  e.simulations.request({
    action: 'run',
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId: 'answer',
    version: 1,
    requestId,
  });
  for (let i = 0; i < 1000; i++) {
    const r = e.simulations.request({ action: 'get', id: requestId }) as {
      state: string;
    };
    if (r.state !== 'running') return r;
    await tick();
  }
  throw new Error('Simulation did not settle');
}

it('reads the latest simulation of each case in one suite with its checks', async () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  const api = appRouter.createCaller({ engine: e });
  const w = e.create('Answers', '', blankDefinition());
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: content(7),
  });
  const other = e.testbench.createSuite({
    workflowId: w.id,
    content: content(7),
  });
  expect(await run(e, suite)).toMatchObject({ state: 'failed' });
  const fixed = e.testbench.updateSuite({
    id: suite.id,
    revision: 1,
    content: content(42),
  });
  // A later simulation of the same case replaces the earlier one; another
  // suite's newer result for a case with the same ID stays out.
  expect(await run(e, fixed)).toMatchObject({ state: 'passed' });
  expect(await run(e, other)).toMatchObject({ state: 'failed' });

  const result = await api.testbench.suiteSimulations({ id: suite.id });
  expect(result.suiteRevision).toBe(2);
  expect(result.cases.map((c) => c.caseId)).toEqual(['answer', 'idle']);
  expect(result.cases[1].simulation).toBeNull();
  expect(result.cases[0].simulation).toMatchObject({
    state: 'passed',
    suiteRevision: 2,
    checks: [
      {
        status: 'pass',
        assertion: { kind: 'output', path: 'answer', expected: 42 },
        expectedOmitted: false,
      },
    ],
  });
});
