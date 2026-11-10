// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VariableLibrary } from '../packages/ui/src/features/variables/Variables';
const rpc = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({ variables: { read: { query: rpc.read } } }),
    errorMessage: (error: Error) => error.message,
  };
});
const listing = (names: string[]) => ({
  items: names.map((name) => ({
    id: name,
    name,
    description: '',
    kind: 'config',
    availability: 'ready',
    updatedAt: '2026-11-08T12:00:00Z',
  })),
  total: names.length,
  truncated: false,
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  rpc.read.mockReset().mockResolvedValue(listing(['original_variable']));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(
          MemoryRouter,
          {},
          h(
            Routes,
            {},
            h(
              Route,
              { element: h(Outlet, { context: { tick: 0 } }) },
              h(Route, { path: '/', element: h(VariableLibrary) }),
            ),
          ),
        ),
      ),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(150));
}
it('keeps results tied to their search through loading, failure, and retry', async () => {
  await render();
  expect(container.textContent).toContain('original_variable');
  let reject!: (error: Error) => void;
  rpc.read.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search variables"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'new');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.textContent).not.toContain('original_variable');
  expect(container.textContent).toContain('Loading variables…');
  await act(async () => vi.advanceTimersByTimeAsync(150));
  await act(async () => reject(new Error('Search failed')));
  expect(container.textContent).toContain('Search failed');
  expect(container.textContent).not.toContain('original_variable');
  expect(container.textContent).not.toContain('No matching variables');
  expect(input.value).toBe('new');
  rpc.read.mockResolvedValueOnce(listing(['new_variable']));
  const retry = [...container.querySelectorAll('button')].find(
    (el) => el.textContent === 'Retry loading',
  )!;
  await act(async () => retry.click());
  await act(async () => vi.advanceTimersByTimeAsync(150));
  expect(rpc.read).toHaveBeenLastCalledWith({
    action: 'list',
    search: 'new',
    offset: 0,
  });
  expect(container.textContent).toContain('new_variable');
  expect(container.textContent).not.toContain('Search failed');
});

it('restores cached variables immediately on return and retains them on a background failure', async () => {
  await render();
  expect(container.textContent).toContain('original_variable');
  await act(async () =>
    root.render(h(DesignSystemProvider, {}, h('p', null, 'Other page'))),
  );
  let reject!: (error: Error) => void;
  rpc.read.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await render();
  expect(container.textContent).toContain('original_variable');
  expect(container.textContent).not.toContain('Loading variables');
  await act(async () => reject(new Error('Background refresh unavailable')));
  expect(container.textContent).toContain('original_variable');
  expect(container.textContent).toContain('Variables may be out of date');
  expect(container.textContent).toContain('Background refresh unavailable');
});
