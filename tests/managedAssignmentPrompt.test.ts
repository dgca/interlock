import { expect, it } from 'vitest';
import type { WorkRequest } from '@interlock/core';
import { assignmentPrompt } from '../packages/runtime/src/executors/contracts';
import { freshContextInstructions } from '../packages/runtime/src/agentInstructions';

it('executes fresh managed work in its existing isolated session while retaining resource rules', () => {
  const work = {
    executionId: 'execution',
    nodeId: 'agent',
    label: 'Test',
    status: 'claimed',
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date().toISOString(),
    id: 'work',
    runId: 'run',
    prompt: 'Write the test marker.',
    input: {},
    outputSchema: {},
    context: {
      mode: 'fresh',
      tools: [],
      skills: [],
      instructions: 'Use the supplied command only.',
    },
    resources: ['test-checkout'],
    executionInstructions: freshContextInstructions('root-run', 'work'),
  } as WorkRequest;
  const prompt = assignmentPrompt(work);
  expect(prompt).not.toContain(
    'Run it in a fresh session or an isolated subagent',
  );
  expect(prompt).not.toContain('Tell the user to paste');
  expect(prompt).toContain('already created');
  expect(prompt).toContain('test-checkout');
  expect(prompt).toContain('Stop using them and stop subprocesses');
  expect(prompt).toContain('Use the supplied command only.');
});
