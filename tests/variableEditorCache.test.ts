// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider } from './uiTestProvider';
import { VariableRoute } from '../packages/ui/src/features/variables/Variables';

import {
  refreshQueries,
  trpc,
  useQueryClient,
} from '../packages/ui/src/lib/query';

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
let root: Root, container: HTMLDivElement;
let client: ReturnType<typeof useQueryClient>;
const onEditorGuard = vi.fn();
function Context() {
  client = useQueryClient();
  return h(Outlet, {
    context: {
      onEditorGuard,
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
  onEditorGuard.mockReset();
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
      action === 'inspect'
        ? saved
        : { id: 'v', value: 'Saved config value', valueRevision: 1 },
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
    await act(async () => refreshQueries(client));
    expect(field('Name').value).toBe('local_edit');
    expect(onEditorGuard).toHaveBeenLastCalledWith('dirty');
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

it('retains the last Config value when reading a new revision fails and retries that revision', async () => {
  let current = savedVariable('config');
  let failValueRead = false;
  read.mockImplementation(async ({ action }) => {
    if (action === 'inspect') return current;
    if (failValueRead) throw new Error('Config read failed');
    return {
      id: 'v',
      value: `Value revision ${current.valueRevision}`,
      valueRevision: current.valueRevision,
    };
  });
  await show();
  expect(field('Config value').value).toBe('Value revision 1');

  current = { ...current, revision: 2, valueRevision: 2 };
  failValueRead = true;
  await act(async () => refreshQueries(client));
  expect(field('Config value').value).toBe('Value revision 1');
  expect(field('Config value').disabled).toBe(true);
  expect(container.textContent).toContain('Config read failed');

  failValueRead = false;
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry Config value',
  )!;
  read.mockClear();
  await act(async () => retry.click());
  expect(field('Config value').value).toBe('Value revision 2');
  expect(field('Config value').disabled).toBe(false);
  expect(read.mock.calls.map(([input]) => input)).toEqual([
    { action: 'config_value', id: 'v' },
  ]);
});

it('rejects a Config value from a newer revision until the metadata catches up', async () => {
  let metadata = savedVariable('config');
  read.mockImplementation(async ({ action }) =>
    action === 'inspect'
      ? metadata
      : { id: 'v', value: 'Value revision 2', valueRevision: 2 },
  );
  await show();
  expect(field('Config value').value).toBe('');
  expect(field('Config value').disabled).toBe(true);
  expect(container.textContent).toContain(
    'The Config value changed while loading.',
  );
  const key = trpc.variables.read.queryFilter({
    action: 'config_value',
    id: 'v',
  });
  expect(
    client.getQueriesData(key).every(([, data]) => data === undefined),
  ).toBe(true);

  metadata = { ...metadata, revision: 2, valueRevision: 2 };
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry Config value',
  )!;
  read.mockClear();
  await act(async () => retry.click());
  expect(read.mock.calls.map(([input]) => input.action)).toEqual([
    'inspect',
    'config_value',
  ]);
  expect(field('Config value').value).toBe('Value revision 2');
  expect(field('Config value').disabled).toBe(false);
});

it('keeps a portable Variable draft tied to its saved variable across a rebind', async () => {
  const original = {
    ...savedVariable('config'),
    referenceId: 'portable',
  };
  let target = original;
  read.mockImplementation(async ({ action, id }) =>
    action === 'inspect'
      ? target
      : { id, value: `Config for ${id}`, valueRevision: 1 },
  );
  manage.mockImplementation(async ({ name }) => ({
    ...original,
    name,
    revision: 2,
  }));

  await show(true, 'portable');
  expect(field('Config value').value).toBe('Config for v');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field('Name'), 'local_edit');
    field('Name').dispatchEvent(new Event('input', { bubbles: true }));
  });
  target = { ...original, id: 'other', name: 'other_variable' };
  await act(async () => refreshQueries(client));
  expect(field('Name').value).toBe('local_edit');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(manage).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'v',
      expectedRevision: 1,
      name: 'local_edit',
    }),
  );
  await act(async () => refreshQueries(client));
  expect(field('Name').value).toBe('other_variable');
  expect(field('Config value').value).toBe('Config for other');
});
