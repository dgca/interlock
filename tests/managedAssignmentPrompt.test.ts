import { expect, it } from 'vitest';
import type { WorkRequest } from '@interlock/core';
import { assignmentPrompt } from '../packages/runtime/src/executors/contracts';
import { freshContextInstructions } from '../packages/runtime/src/agentInstructions';
import { toolCallToken } from '../packages/runtime/src/toolCalls';

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

it('describes Interlock tools to a managed session only when attached, without a credential', () => {
  const work = {
    id: 'work',
    runId: 'run',
    token: 'claim-token',
    prompt: 'Fix it.',
    input: {},
    outputSchema: {},
    context: { mode: 'current', tools: [], skills: [] },
    tools: [
      {
        name: 'run_checks',
        description: 'Script step "Run checks". Returns its output.',
        inputSchema: { type: 'object' },
        maxCallsPerAttempt: 10,
        maxCallsPerExecution: 30,
      },
    ],
  } as unknown as WorkRequest;
  const attached = assignmentPrompt(work, undefined, [
    'save_memory_note',
    'call_workflow_tool',
  ]);
  expect(attached).toContain('"name":"run_checks"');
  expect(attached).toContain('call_workflow_tool tool');
  expect(attached).toContain('save_memory_note tool');
  const bare = assignmentPrompt(work);
  for (const text of ['run_checks', 'call_', 'save_memory_note'])
    expect(bare).not.toContain(text);
  for (const prompt of [attached, bare]) {
    expect(prompt).not.toContain('claim-token');
    expect(prompt).not.toContain(toolCallToken('claim-token'));
  }
});
