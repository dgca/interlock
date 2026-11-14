import { afterEach, expect, it } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  simulationFixtureSchema,
  type Json,
} from '@interlock/core';

// Kept apart from simulation.test.ts, which is at its size ceiling.
const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
});

async function simulate(answer: Json) {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'input',
    label: 'Approve',
    humanInput: {
      question: 'Approve?',
      answer: {
        kind: 'choice',
        choices: [
          { label: 'Approve', value: 'approve' },
          { label: 'Revise', value: 'revise', requireComment: true },
        ],
      },
    },
  });
  const w = e.create('Approval', '', definition);
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Approval',
      cases: [
        {
          id: 'case',
          name: 'Case',
          input: {},
          fixtures: [{ nodeId: 'agent', kind: 'input', output: answer }],
          assertions: [
            {
              kind: 'output',
              path: 'choice',
              operator: 'equals',
              expected: 'approve',
            },
          ],
        },
      ],
    },
  });
  const request = {
    action: 'run' as const,
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId: 'case',
    version: 1,
    requestId: crypto.randomUUID(),
  };
  e.simulations.request(request);
  for (let i = 0; i < 1000; i++) {
    const r = e.simulations.request({
      action: 'get',
      id: request.requestId,
    }) as { state: string; error?: string; substitutionCount: number };
    if (r.state !== 'running') return r;
    await tick();
  }
  throw new Error('Simulation did not settle');
}

it('answers Human input from a fixture and fails on an answer the choices reject', async () => {
  expect(await simulate({ choice: 'approve' })).toMatchObject({
    state: 'passed',
    substitutionCount: 1,
  });
  const rejected = await simulate({ choice: 'revise' });
  expect(rejected.state).toBe('failed');
  expect(rejected.error).toMatch(/comment/);
  expect(
    simulationFixtureSchema.safeParse({
      nodeId: 'agent',
      kind: 'input',
      error: 'x',
    }).success,
  ).toBe(false);
});
