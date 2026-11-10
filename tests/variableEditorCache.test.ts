// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider } from './uiTestProvider';
import { VariableRoute } from '../packages/ui/src/features/variables/Variables';

const read = vi.hoisted(() => vi.fn());
const manage = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      variables: { read: { query: read }, manage: { mutate: manage } },
    }),
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
  manage.mockReset();
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
  'keeps direct variable deletion in the header with references: %s',
  async (references) => {
    read.mockResolvedValue(savedVariable('secret', references));
    await show();
    const remove = container.querySelector<HTMLButtonElement>(
      'header button[aria-label="Delete variable"]',
    )!;
    expect(remove.textContent).toBe('Delete');
    expect(remove.hasAttribute('aria-haspopup')).toBe(false);
    expect(
      [...container.querySelectorAll('header button')]
        .map((button) => button.textContent)
        .filter(Boolean),
    ).toEqual(['Discard changes', 'Delete', 'Save changes']);
    expect(
      [...container.querySelectorAll('summary')].map(
        (summary) => summary.textContent,
      ),
    ).not.toContain('Danger zone');
    expect(container.textContent).not.toContain('Disable use');
    expect(container.textContent).not.toContain('Enable use');
    expect(container.textContent).toContain('Storage and recovery');
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
    expect(document.activeElement).toBe(remove);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(field('Name'), 'local_edit');
      field('Name').dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(remove.disabled).toBe(true);
    await act(async () => remove.click());
    expect(document.querySelector('[role=dialog]')).toBeNull();
  },
);

it('omits variable Delete while creating a new variable', async () => {
  await show(true, 'new');
  expect(container.querySelector('header')!.textContent).toContain('Create');
  expect(container.querySelector('header')!.textContent).not.toContain(
    'Delete',
  );
  expect(read).not.toHaveBeenCalled();
});

it('keeps already-disabled variables read-only about their status while metadata saves omit enablement', async () => {
  let saved = { ...savedVariable(), enabled: false, availability: 'disabled' };
  read.mockImplementation(async () => saved);
  manage.mockImplementation(async (input) => {
    saved = {
      ...saved,
      name: input.name,
      description: input.description,
      revision: saved.revision + 1,
    };
    return saved;
  });
  await show();
  expect(container.textContent).toContain(
    'This variable is disabled. Restore access with the CLI.',
  );
  expect(container.textContent).not.toContain('Enable use');
  expect(container.textContent).not.toContain('Disable use');
  expect(container.textContent).not.toContain('Danger zone');
  expect(manage).not.toHaveBeenCalled();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field('Name'), 'renamed_variable');
    field('Name').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(manage).toHaveBeenCalledWith({
    action: 'update',
    id: 'v',
    expectedRevision: 1,
    name: 'renamed_variable',
    description: 'Saved description',
  });
  expect(manage.mock.lastCall![0]).not.toHaveProperty('enabled');
  expect(saved.enabled).toBe(false);
  expect(container.textContent).toContain(
    'This variable is disabled. Restore access with the CLI.',
  );
});
