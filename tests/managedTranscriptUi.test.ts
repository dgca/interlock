// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { ManagedTranscript } from '../packages/ui/src/features/executors/ManagedTranscript';
import {
  transcriptLimits,
  type MessageReceipt,
  type TranscriptPage,
} from '@interlock/core';
const rpc = vi.hoisted(() => ({
  transcript: vi.fn(),
  manage: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      executors: {
        transcript: { query: rpc.transcript },
        manage: { mutate: rpc.manage },
        receipt: { query: rpc.receipt },
      },
    }),
    errorMessage: (e: Error) => e.message,
  };
});
let root: Root, container: HTMLDivElement;
const page: TranscriptPage = {
  items: [
    {
      sequence: 1,
      kind: 'assistant',
      at: new Date().toISOString(),
      text: 'Working',
    },
  ],
  retainedBytes: 100,
  retainedEntries: 1,
  omitted: 0,
  gap: false,
  older: null,
  newer: null,
  limits: transcriptLimits,
  capability: 'conversation',
  messageAvailable: true,
};
const receipt: MessageReceipt = {
  executionId: 'attempt',
  requestId: 'request',
  status: 'accepted',
  source: 'ui',
  operator: 'local-user',
  at: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  rpc.transcript.mockReset().mockResolvedValue(page);
  rpc.manage.mockReset();
  rpc.receipt.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(executionId = 'attempt', opened = true) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        null,
        h(ManagedTranscript, {
          key: executionId,
          executionId,
          current: executionId === 'attempt',
          opened,
        }),
      ),
    ),
  );
}
function button(label: string) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
}
async function type(text: string) {
  const field = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('loads on demand and preserves an accepted send when the following transcript refresh fails', async () => {
  await render();
  expect(rpc.transcript).toHaveBeenCalledTimes(1);
  await type('Skip the install\nUse vendor');
  let resolve!: (value: MessageReceipt) => void;
  rpc.manage.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    button('Send message').click();
    button('Send message')?.click();
  });
  expect(rpc.manage).toHaveBeenCalledTimes(1);
  expect(rpc.manage.mock.calls[0][0].message).toContain('\n');
  rpc.transcript.mockRejectedValue(new Error('Refresh failed'));
  await act(async () => {
    resolve(receipt);
  });
  expect(container.textContent).toContain('Message accepted by the harness');
  expect(container.textContent).toContain('Refresh failed');
  expect(container.querySelector('textarea')!.value).toBe('');
});
it('preserves uncertain request identity and reads its receipt instead of sending again', async () => {
  await render();
  await type('Guidance');
  rpc.manage.mockRejectedValue(new Error('Lost response'));
  await act(async () => button('Send message').click());
  expect(button('Check delivery')).toBeDefined();
  expect(container.querySelector('textarea')!.value).toBe('Guidance');
  rpc.receipt.mockResolvedValue({ receipt: { ...receipt, status: 'unknown' } });
  await act(async () => button('Check delivery').click());
  expect(container.textContent).toContain('This request will not be resent');
  expect(rpc.manage).toHaveBeenCalledTimes(1);
  expect(button('Send message')).toBeUndefined();
});

it('never displays latest-page rows while a different cursor loads or fails, and recovers the exact cached query', async () => {
  rpc.transcript.mockResolvedValueOnce({ ...page, older: 10 });
  await render();
  let reject!: (error: Error) => void;
  rpc.transcript.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => button('Older').click());
  expect(container.textContent).not.toContain('Working');
  expect(
    container.querySelector('[aria-label="Loading transcript"]'),
  ).not.toBeNull();
  await act(async () => reject(new Error('Older page unavailable')));
  expect(container.textContent).toContain('Older page unavailable');
  expect(container.textContent).not.toContain('Working');
  rpc.transcript.mockResolvedValueOnce(page);
  await act(async () => button('Latest').click());
  expect(container.textContent).toContain('Working');
});

it('isolates historical-attempt responses and never offers its message controls', async () => {
  let resolve!: (page: TranscriptPage) => void;
  const current = new Promise<TranscriptPage>((done) => {
    resolve = done;
  });
  rpc.transcript.mockImplementation(
    ({ executionId }: { executionId: string }) =>
      executionId === 'attempt'
        ? current
        : Promise.resolve({
            ...page,
            messageAvailable: false,
            items: [{ ...page.items[0], text: 'Historical content' }],
          }),
  );
  await render();
  await render('older-attempt');
  expect(container.textContent).toContain('Historical content');
  expect(container.querySelector('textarea')).toBeNull();
  await act(async () =>
    resolve({
      ...page,
      items: [{ ...page.items[0], text: 'Current content' }],
    }),
  );
  expect(container.textContent).not.toContain('Current content');
  await render();
  expect(container.textContent).toContain('Current content');
  expect(container.querySelector('textarea')).not.toBeNull();
});

it('preserves the active draft while the conversation view is hidden', async () => {
  await render();
  await type('Draft to keep');
  await render('attempt', false);
  await render();
  expect(container.querySelector('textarea')!.value).toBe('Draft to keep');
});

it('keeps draft and uncertain delivery identity across page changes', async () => {
  rpc.transcript.mockResolvedValueOnce({ ...page, older: 10 });
  await render();
  await type('Keep this guidance');
  rpc.manage.mockRejectedValue(new Error('Lost response'));
  await act(async () => button('Send message').click());
  let resolve!: (value: TranscriptPage) => void;
  rpc.transcript.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => button('Older').click());
  expect(container.querySelector('textarea')!.value).toBe('Keep this guidance');
  expect(button('Check delivery')).toBeDefined();
  await act(async () => resolve({ ...page, older: null }));
  rpc.receipt.mockResolvedValue({ receipt: { ...receipt, status: 'unknown' } });
  await act(async () => button('Check delivery').click());
  expect(container.textContent).toContain('This request will not be resent');
  expect(rpc.receipt.mock.calls[0][0].requestId).toBe(
    rpc.manage.mock.calls[0][0].requestId,
  );
  expect(rpc.manage).toHaveBeenCalledTimes(1);
});
