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
async function show(visible = true, id = 'v') {
  await act(async () =>
    root.render(
      h(
        UiTestProvider,
        { env: 'test' },
        visible
          ? h(
              MemoryRouter,
              { initialEntries: [`/variables/${id}`] },
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

function savedVariable(kind: 'secret' | 'config' = 'secret', references = 0) {
  return {
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
      total: references,
      offset: 0,
      limit: 25,
      truncated: false,
      activeRunCount: 0,
      runningComparisonCount: 0,
    },
    bindings: { items: [], total: 0, truncated: false },
    storage: {},
  };
}

it.each(['secret', 'config'] as const)(
  'reuses saved %s metadata on return while keeping unsaved edits out of the cache',
  async (kind) => {
    const saved = savedVariable(kind);
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

it.each([0, 1])(
  'keeps variable deletion in the header Actions menu with references: %s',
  async (references) => {
    read.mockResolvedValue(savedVariable('secret', references));
    await show();
    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>('header button'),
    ].find((button) => button.textContent === 'Actions')!;
    expect(actions.getAttribute('aria-haspopup')).toBe('menu');
    expect(
      [...container.querySelectorAll('header button')]
        .map((button) => button.textContent)
        .filter(Boolean),
    ).toEqual(['Discard changes', 'Actions', 'Save changes']);
    const danger = [...container.querySelectorAll('details')].find(
      (details) =>
        details.querySelector('summary')?.textContent === 'Danger zone',
    )!;
    expect(danger.textContent).toContain('Disable use');
    expect(danger.textContent).not.toContain('Delete variable');
    await act(async () => {
      actions.focus();
      actions.click();
    });
    const remove =
      document.querySelector<HTMLButtonElement>('[role=menuitem]')!;
    expect(remove.textContent).toBe('Delete variable');
    expect(remove.disabled).toBe(false);
    await act(async () => {
      remove.focus();
      remove.click();
    });
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    const confirm = [
      ...dialog.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Delete variable')!;
    expect(confirm.disabled).toBe(references > 0);
    expect(dialog.textContent).toContain(
      references
        ? 'This variable is still referenced.'
        : 'Delete this variable and its protected value revisions?',
    );
    await act(async () => {
      const cancel = [
        ...dialog.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) => button.textContent === 'Cancel')!;
      cancel.focus();
      cancel.click();
      await new Promise(requestAnimationFrame);
    });
    await act(async () => new Promise(requestAnimationFrame));
    expect(document.activeElement).toBe(actions);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(field('Name'), 'local_edit');
      field('Name').dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => actions.click());
    expect(
      document.querySelector<HTMLButtonElement>('[role=menuitem]')!.disabled,
    ).toBe(true);
  },
);

it('omits variable Actions while creating a new variable', async () => {
  await show(true, 'new');
  expect(container.querySelector('header')!.textContent).toContain('Create');
  expect(container.querySelector('header')!.textContent).not.toContain(
    'Actions',
  );
  expect(read).not.toHaveBeenCalled();
});
