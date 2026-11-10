// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executorProfileSchema, type WorkRequest } from '@interlock/core';
import { ManagedExecutionPanel } from '../packages/ui/src/features/executors/ManagedExecutionPanel';
const rpc = vi.hoisted(() => ({
  inspect: vi.fn(),
  manage: vi.fn(),
  models: vi.fn(),
  transcript: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      executors: {
        inspect: { query: rpc.inspect },
        manage: { mutate: rpc.manage },
        models: { query: rpc.models },
        transcript: { query: rpc.transcript },
      },
    }),
    errorMessage: (e: Error) => e.message,
  };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  rpc.transcript.mockReset().mockResolvedValue({
    items: [],
    retainedEntries: 0,
    retainedBytes: 0,
    gap: false,
    omitted: 0,
    older: null,
    newer: null,
    capability: 'unavailable',
    messageAvailable: false,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  rpc.models.mockResolvedValue({
    status: 'ready',
    models: [{ id: 'working', name: 'Working model' }],
    truncated: false,
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  rpc.inspect.mockReset();
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
  await mount(work);
  return { record, work };
}
async function mount(work: WorkRequest) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(ManagedExecutionPanel, { work, onRefresh: () => {} }),
      ),
    ),
  );
}
it('submits a custom native answer using the exact pending request identity', async () => {
  await render(true);
  await chooseView('details');
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
  const sendButton = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Send answers',
  )!;
  expect(sendButton.disabled).toBe(false);
  await act(async () => sendButton.click());
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
  const select = [...container.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'Python'),
  )!;
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

async function chooseView(view: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${view}"]`,
  )!;
  await act(async () => input.click());
}
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(result, `Button: ${text}`).toBeDefined();
  return result!;
}
async function permission() {
  const fixture = await render(false);
  fixture.record.requests = [
    {
      id: 'permission',
      kind: 'permission',
      title: 'Review this command',
      detail: 'echo exact-command',
      state: 'pending',
      questions: [],
    },
  ];
  rpc.inspect.mockResolvedValue({
    items: [fixture.record],
    total: 1,
    history: [],
  });
  await mount({ ...fixture.work });
  return fixture;
}
it('selects a replacement and retries a model hold without a stopped-session confirmation', async () => {
  const fixture = await render(false);
  const record = {
    ...fixture.record,
    state: 'needs_model',
    requests: [],
    error: 'model_not_found',
  };
  rpc.inspect.mockResolvedValue({ items: [record], total: 1, history: [] });
  await mount({ ...fixture.work, status: 'held' });
  expect(container.textContent).toContain('Choose a replacement model');
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(button('Retry with selected model').disabled).toBe(true);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  const choice = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => el.textContent?.includes('Working model'))!;
  expect(choice).toBeDefined();
  await act(async () => choice.click());
  await act(async () => button('Retry with selected model').click());
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'retry_model',
    executionId: record.id,
    model: 'working',
  });
  expect(button('Retry with selected model').disabled).toBe(true);
  expect(container.textContent).toContain('Replacement recorded');
});
it('submits one exact approval, prevents repeated clicks, and shows the recorded outcome', async () => {
  await permission();
  let resolve!: (value: unknown) => void;
  rpc.manage.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    button('Allow once').click();
    button('Allow once').click();
  });
  expect(rpc.manage).toHaveBeenCalledTimes(1);
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'respond',
    executionId: 'execution:1',
    requestId: 'permission',
    answer: { allow: true },
  });
  expect(button('Sending decision…').disabled).toBe(true);
  await act(async () => resolve({ applied: true }));
  expect(container.textContent).toContain(
    'Allowed once. The agent can continue with this action.',
  );
  expect(container.querySelector('[aria-label="Requested action"]')).toBeNull();
});
it('records a denial even if refreshing fails, without offering the same request again', async () => {
  await permission();
  rpc.inspect.mockRejectedValue(new Error('Connection lost'));
  await act(async () => button('Deny').click());
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({ answer: { allow: false } }),
  );
  expect(container.textContent).toContain(
    'Denied. The agent will receive your decision.',
  );
  expect(container.textContent).toContain(
    'The action was recorded, but details could not refresh.',
  );
  expect(
    [...container.querySelectorAll('button')].some(
      (b) => b.textContent === 'Allow once',
    ),
  ).toBe(false);
  expect(button('Reload execution')).toBeDefined();
});
it('retains a failed question answer and allows correction and retry', async () => {
  await render(false);
  const select = [...container.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'Python'),
  )!;
  await act(async () => {
    select.value = 'Python';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  rpc.manage.mockRejectedValueOnce(new Error('The request expired'));
  await act(async () => button('Send answers').click());
  expect(container.textContent).toContain('The request expired');
  expect(select.value).toBe('Python');
  expect(button('Send answers').disabled).toBe(false);
});
it('does not claim a new approval when another client already answered the request', async () => {
  await permission();
  rpc.manage.mockResolvedValue({ applied: false });
  await act(async () => button('Allow once').click());
  expect(container.textContent).toContain('This request was already answered.');
  expect(container.textContent).not.toContain(
    'Allowed once. The agent can continue',
  );
});
async function recovery(status: WorkRequest['status'] = 'held') {
  const fixture = await render(false);
  fixture.record.state = 'interrupted';
  fixture.record.requests = [];
  const work = { ...fixture.work, status };
  await mount(work);
  return { ...fixture, work };
}
it('requires explicit stop confirmation, scopes recovery to that execution, and resets it for a new attempt', async () => {
  const { work, record } = await recovery();
  expect(button('Retry assignment').disabled).toBe(true);
  expect(container.textContent).toContain('Retrying can repeat those changes.');
  const checkbox = container.querySelector(
    'input[type=checkbox]',
  ) as HTMLInputElement;
  await act(async () => checkbox.click());
  expect(button('Retry assignment').disabled).toBe(false);
  await act(async () => button('Retry assignment').click());
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'reconcile',
    executionId: 'execution:1',
    confirmStopped: true,
  });
  expect(container.textContent).toContain('Recovery confirmed.');
  expect(checkbox.checked).toBe(false);
  await act(async () => checkbox.click());
  record.attempt = 2;
  await mount({ ...work, attempt: 2 });
  expect(
    (container.querySelector('input[type=checkbox]') as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(button('Retry assignment').disabled).toBe(true);
});
it('offers resource reconciliation without promising to retry a cancelled assignment', async () => {
  await recovery('cancelled');
  expect(button('Confirm stopped').disabled).toBe(true);
  expect(container.textContent).toContain('It does not restart the run.');
  expect(container.textContent).not.toContain('Retry starts a new attempt');
});
it('shows an inspection failure and reloads without starting an agent action', async () => {
  const { work, record } = await render(false);
  rpc.inspect.mockRejectedValueOnce(new Error('Inspection unavailable'));
  await mount({ ...work });
  expect(container.textContent).toContain('Inspection unavailable');
  rpc.inspect.mockResolvedValue({ items: [record], total: 1, history: [] });
  await act(async () => button('Reload execution').click());
  expect(container.textContent).toContain('Need a decision');
  expect(rpc.manage).not.toHaveBeenCalled();
});
it('shows submission on the deny action rather than implying that approval was selected', async () => {
  await permission();
  let resolve!: (value: unknown) => void;
  rpc.manage.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => button('Deny').click());
  expect(button('Allow once').disabled).toBe(true);
  expect(button('Sending decision…').disabled).toBe(true);
  await act(async () => resolve({ applied: true }));
  expect(container.textContent).toContain(
    'Denied. The agent will receive your decision.',
  );
});

it('keeps the conversation draft through the Details view and isolates historical attempt controls', async () => {
  const { record, work } = await render(false);
  const active = {
    ...record,
    id: 'execution:2',
    attempt: 2,
    requests: [],
    state: 'running',
  };
  const old = { ...active, id: 'execution:0', attempt: 0, state: 'completed' };
  rpc.inspect.mockResolvedValue({ items: [active], total: 2, history: [old] });
  rpc.transcript.mockImplementation(
    ({ executionId }: { executionId: string }) =>
      Promise.resolve({
        items: [
          {
            sequence: 1,
            kind: 'assistant',
            at: new Date().toISOString(),
            text:
              executionId === old.id ? 'Historical message' : 'Current message',
          },
        ],
        retainedEntries: 1,
        retainedBytes: 100,
        gap: false,
        omitted: 0,
        older: null,
        newer: null,
        capability: 'conversation',
        messageAvailable: executionId === active.id,
      }),
  );
  await mount({ ...work, attempt: 2 });
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, 'Draft guidance');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await chooseView('details');
  const detailPanel = container.querySelector<HTMLElement>(
    'section[aria-label="Execution details"]',
  )!;
  expect(detailPanel.textContent).toContain('Harness');
  expect(detailPanel.hidden).toBe(false);
  await chooseView('conversation');
  expect(container.querySelector('textarea')!.value).toBe('Draft guidance');
  const select = container.querySelector(
    'select[aria-label="Execution attempt"]',
  )! as HTMLSelectElement;
  await act(async () => {
    select.value = old.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Historical message');
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.textContent).toContain(
    'Messages can only be sent to the current active attempt',
  );
});
