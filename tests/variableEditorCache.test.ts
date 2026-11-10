// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider } from './uiTestProvider';
import { VariableRoute } from '../packages/ui/src/features/variables/Variables';

const read = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({ variables: { read: { query: read } } }),
    errorMessage: (error: Error) => error.message,
  };
});
let root: Root, container: HTMLDivElement, tick: number;
const onDirty = vi.fn();
function Context() {
  return h(Outlet, {
    context: {
      tick,
      onDirty,
      act: async (fn: () => Promise<unknown>) => {
        await fn();
      },
    },
  });
}
async function show(visible = true) {
  await act(async () =>
    root.render(
      h(
        UiTestProvider,
        { env: 'test' },
        visible
          ? h(
              MemoryRouter,
              { initialEntries: ['/variables/v'] },
              h(
                Routes,
                {},
                h(
                  Route,
                  { element: h(Context) },
                  h(Route, {
                    path: '/variables/:variableId',
                    element: h(VariableRoute),
                  }),
                ),
              ),
            )
          : h('p', null, 'Other page'),
      ),
    ),
  );
}
function field(name: string) {
  const label = [...container.querySelectorAll<HTMLLabelElement>('label')].find(
    (label) => label.textContent?.startsWith(name),
  )!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
}
beforeEach(() => {
  tick = 0;
  onDirty.mockReset();
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  read.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(['secret', 'config'] as const)(
  'reuses saved %s metadata on return while keeping unsaved edits out of the cache',
  async (kind) => {
    const saved = {
      id: 'v',
      name: 'saved_variable',
      description: 'Saved description',
      kind,
      enabled: true,
      revision: 1,
      valueRevision: 1,
      availability: 'ready',
      createdAt: '2026-11-09T12:00:00Z',
      updatedAt: '2026-11-09T12:00:00Z',
      dependencies: {
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        truncated: false,
        activeRunCount: 0,
        runningComparisonCount: 0,
      },
      bindings: { items: [], total: 0, truncated: false },
      storage: {},
    };
    read.mockImplementation(async ({ action }) =>
      action === 'inspect' ? saved : { id: 'v', value: 'Saved config value' },
    );
    await show();
    expect(field('Name').value).toBe('saved_variable');
    if (kind === 'config') {
      expect(field('Config value').value).toBe('Saved config value');
      expect(
        read.mock.calls
          .filter(([input]) => input.action === 'config_value')
          .map(([input]) => input),
      ).toEqual([{ action: 'config_value', id: 'v' }]);
    }
    const count = read.mock.calls.length;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(field('Name'), 'local_edit');
      field('Name').dispatchEvent(new Event('input', { bubbles: true }));
    });
    tick += 1;
    await show();
    expect(field('Name').value).toBe('local_edit');
    expect(onDirty).toHaveBeenLastCalledWith(true);
    expect(read).toHaveBeenCalledTimes(count);
    await show(false);
    read.mockImplementationOnce(() => new Promise(() => {}));
    await show();
    expect(field('Name').value).toBe('saved_variable');
    expect(container.textContent).not.toContain('Loading variable');
    if (kind === 'config')
      expect(field('Config value').value).toBe('Saved config value');
    else
      expect(
        read.mock.calls.every(([input]) => input.action === 'inspect'),
      ).toBe(true);
  },
);
