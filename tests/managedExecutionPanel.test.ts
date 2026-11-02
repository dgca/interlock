// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executorProfileSchema, type WorkRequest } from '@interlock/core';
import { ManagedExecutionPanel } from '../packages/ui/src/features/executors/ManagedExecutionPanel';
const rpc = vi.hoisted(() => ({ inspect: vi.fn(), manage: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    executors: {
      inspect: { query: rpc.inspect },
      manage: { mutate: rpc.manage },
    },
  },
  errorMessage: (e: Error) => e.message,
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  rpc.manage.mockReset().mockResolvedValue({ applied: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(allowOther: boolean) {
  const record = {
    id: 'execution:1',
    workId: 'work',
    runId: 'run',
    attempt: 1,
    state: 'needs_human',
    profile: executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
    }),
    command: '/fake/codex',
    cwd: '/fake/project',
    startedAt: new Date().toISOString(),
    logs: [],
    logCount: 0,
    requests: [
      {
        id: 'question',
        kind: 'question',
        title: 'Need a decision',
        detail: '',
        state: 'pending',
        questions: [
          {
            id: 'language',
            text: 'Which language?',
            options: ['TypeScript', 'Python'],
            allowOther,
          },
        ],
      },
    ],
  };
  rpc.inspect.mockResolvedValue({ items: [record], total: 1, history: [] });
  const work: WorkRequest = {
    id: 'work',
    runId: 'run',
    executionId: 'node-execution',
    nodeId: 'agent',
    label: 'Test',
    prompt: 'Test',
    input: 1,
    context: { mode: 'fresh', tools: [], skills: [], instructions: '' },
    outputSchema: {},
    status: 'claimed',
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
    executor: 'codex',
  };
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(ManagedExecutionPanel, { work, onRefresh: () => {} }),
      ),
    ),
  );
}
it('submits a custom native answer using the exact pending request identity', async () => {
  await render(true);
  const input = container.querySelector('textarea')!;
  expect(input).not.toBeNull();
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, 'Rust');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Send answers',
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'respond',
    executionId: 'execution:1',
    requestId: 'question',
    answer: { answers: { language: ['Rust'] } },
  });
});
it('keeps single-choice questions within their native options', async () => {
  await render(false);
  expect(container.querySelector('textarea')).toBeNull();
  const select = container.querySelector('select')!;
  await act(async () => {
    select.value = 'Python';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Send answers')!
      .click(),
  );
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({ answer: { answers: { language: ['Python'] } } }),
  );
});
