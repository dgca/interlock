// @vitest-environment jsdom
import { transferableAbortController } from 'node:util';
import {
  boardSettingsRevisionConflict,
  type SaveBoard,
  type WorkflowBoard,
} from '@interlock/core';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { trpc, useQueryClient } from '../packages/ui/src/lib/query';
import { routes } from '../packages/ui/src/routes';
import { UiTestProvider } from './uiTestProvider';

const rpc = vi.hoisted(() => ({
  saveBoard: vi.fn(),
  boardSettings: vi.fn(),
  createPrompt: vi.fn(),
  listPrompts: vi.fn(),
  listWorkflows: vi.fn(),
  saveIntegration: vi.fn(),
  profiles: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  const empty = async () => [];
  const emptyPage = async () => ({ items: [], total: 0, nextOffset: null });
  return {
    api: mockRpcClient({
      boards: {
        settings: { query: rpc.boardSettings },
        get: { query: async () => ({ board, columns: [], attentionCount: 0 }) },
        list: { query: empty },
        save: { mutate: rpc.saveBoard },
      },
      workflows: { list: { query: rpc.listWorkflows } },
      prompts: {
        list: { query: rpc.listPrompts },
        get: { query: async () => ({ usage: [] }) },
        create: { mutate: rpc.createPrompt },
      },
      requests: { list: { query: emptyPage } },
      triggers: { attention: { query: emptyPage } },
      executors: {
        profiles: { query: rpc.profiles },
        manage: { mutate: rpc.saveIntegration },
      },
      modelAliases: { list: { query: emptyPage } },
      connection: { query: async () => ({ engineUrl: 'http://localhost' }) },
    }),
    errorMessage: (error: Error) => error.message,
  };
});

const board: WorkflowBoard & {
  workflowIds: string[];
  protectedColumnIds: string[];
} = {
  id: 'board',
  name: 'Saved board',
  columns: [{ id: 'stage', name: 'Stage' }],
  workflowIds: [],
  protectedColumnIds: [],
  revision: 3,
};
const profile = {
  id: 'custom-existing',
  name: 'Test integration',
  harness: 'custom',
  mode: 'launcher',
  transport: 'subprocess',
  launchCommand: 'test-worker',
  statusCommand: 'test-status',
  permissions: 'standard',
  enabled: false,
  revision: 4,
  detection: { status: 'detected' },
};
const prompt = {
  id: 'new',
  name: 'Draft prompt',
  content: 'Draft instructions',
  description: '',
  revision: 1,
  createdAt: '2026-11-11T00:00:00Z',
  updatedAt: '2026-11-11T00:00:00Z',
};

let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let queryClient: ReturnType<typeof useQueryClient>;

function TestApp() {
  queryClient = useQueryClient();
  return h(RouterProvider, { router });
}
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(async () => {
  await Promise.all([
    import('../packages/ui/src/features/boards/BoardSettings'),
    import('../packages/ui/src/features/boards/Boards'),
    import('../packages/ui/src/features/executors/Harnesses'),
    import('../packages/ui/src/features/prompts/Prompts'),
  ]);
});

beforeEach(() => {
  vi.resetAllMocks();
  rpc.boardSettings.mockResolvedValue(board);
  rpc.listPrompts.mockResolvedValue([]);
  rpc.listWorkflows.mockResolvedValue([]);
  rpc.profiles.mockResolvedValue([profile]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // React Router uses Node's Request and needs the corresponding AbortSignal.
  vi.stubGlobal(
    'AbortController',
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
  if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

async function render(path: string) {
  router = createMemoryRouter(routes, { initialEntries: ['/boards', path] });
  await act(async () => {
    root.render(h(UiTestProvider, { env: 'test' }, h(TestApp)));
  });
  await act(async () => vi.dynamicImportSettled());
}

function button(label: string, within: ParentNode = document) {
  const match = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) =>
      !item.closest('[inert]') &&
      (item.getAttribute('aria-label') === label ||
        item.textContent?.trim() === label),
  );
  expect(match, label).toBeDefined();
  return match!;
}

function field(label: string) {
  const match = [...document.querySelectorAll('label')].find(
    (item) => item.textContent?.replace(/\s*\*$/, '').trim() === label,
  );
  const control = match
    ? document.getElementById(match.htmlFor)
    : document.querySelector(`[aria-label="${label}"]`);
  expect(control, label).toBeTruthy();
  return control as HTMLInputElement | HTMLTextAreaElement;
}

async function ready(check: () => unknown) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}

async function click(label: string, within?: ParentNode) {
  await act(async () => button(label, within).click());
}

async function fill(label: string, value: string) {
  const control = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(control),
      'value',
    )!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function back() {
  await act(async () => router.navigate(-1));
}

function escape() {
  return act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
}

function discardDialog() {
  return [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
    dialog.textContent?.includes('Discard unsaved changes?'),
  );
}

function formDialog() {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
    (element) => !element.closest('[inert]') && element.querySelector('form'),
  );
  expect(dialog).toBeTruthy();
  return dialog!;
}

function warnsBeforeUnload() {
  return !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function submitTwice(control: HTMLInputElement | HTMLTextAreaElement) {
  return act(async () => {
    const submit = () =>
      control.form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    submit();
    submit();
  });
}

it('guards Board column edits and holds navigation during a retryable save', async () => {
  await render('/boards/board/settings');
  await ready(() => field('Board name'));
  expect(warnsBeforeUnload()).toBe(false);
  await fill('Column 1 name', 'Changed stage');
  await click('Cancel');
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  expect(field('Column 1 name').value).toBe('Changed stage');
  await fill('Column 1 name', 'Stage');
  expect(warnsBeforeUnload()).toBe(false);

  await fill('Board name', 'Local board');
  expect(warnsBeforeUnload()).toBe(true);
  const failedSave = deferred<never>();
  rpc.saveBoard.mockReturnValueOnce(failedSave.promise);
  await submitTwice(field('Board name'));
  expect(rpc.saveBoard).toHaveBeenCalledTimes(1);
  expect(button('Cancel').disabled).toBe(true);
  expect(warnsBeforeUnload()).toBe(true);
  await back();
  await act(async () =>
    document
      .querySelector<HTMLAnchorElement>('nav a[href="/prompts"]')!
      .click(),
  );
  expect(router.state.location.pathname).toBe('/boards/board/settings');
  expect(discardDialog()).toBeUndefined();

  await act(async () => failedSave.reject(new Error('Board save failed')));
  expect(document.body.textContent).toContain('Board save failed');
  expect(field('Board name').value).toBe('Local board');
  expect(discardDialog()).toBeUndefined();
  const retry = deferred<typeof board>();
  const refresh = deferred<[]>();
  rpc.saveBoard.mockReturnValueOnce(retry.promise);
  rpc.listWorkflows.mockReturnValueOnce(refresh.promise);
  await click('Save changes');
  await back();
  expect(router.state.location.pathname).toBe('/boards/board/settings');
  await act(async () =>
    retry.resolve({ ...board, name: 'Local board', revision: 4 }),
  );
  expect(router.state.location.pathname).toBe('/boards/board');
  await ready(() => expect(warnsBeforeUnload()).toBe(false));
  expect(rpc.listWorkflows).toHaveBeenCalledTimes(2);
  const settingsRead = deferred<typeof board>();
  rpc.boardSettings.mockReturnValueOnce(settingsRead.promise);
  await act(async () => router.navigate('/boards/board/settings'));
  expect(
    document.querySelector('[aria-label="Loading board settings"]'),
  ).toBeTruthy();
  expect(rpc.boardSettings).toHaveBeenCalledTimes(2);
  await act(async () =>
    settingsRead.resolve({ ...board, name: 'Local board', revision: 4 }),
  );
  expect(field('Board name').value).toBe('Local board');
  await act(async () => refresh.resolve([]));
});

it('leaves a clean new Board freely and abandons its draft only after confirmation', async () => {
  await render('/boards/new');
  await ready(() => field('Board name'));
  await click('Cancel');
  expect(router.state.location.pathname).toBe('/boards');
  expect(discardDialog()).toBeUndefined();
  await act(async () => router.navigate('/boards/new'));
  await fill('Board name', 'Unsaved board');
  await click('Cancel');
  expect(router.state.location.pathname).toBe('/boards/new');
  await click('Discard changes');
  expect(router.state.location.pathname).toBe('/boards');
  await act(async () => router.navigate('/boards/new'));
  expect(field('Board name').value).toBe('');
});

it('keeps a Board conflict draft through background refresh and failed recovery, then saves the latest revision', async () => {
  let saved = board;
  rpc.boardSettings.mockImplementation(async () => saved);
  rpc.listWorkflows.mockResolvedValue([
    { id: 'workflow', name: 'Shared workflow', boardId: 'other-board' },
  ]);
  rpc.saveBoard.mockImplementation(async (input: SaveBoard) => {
    if (input.expectedRevision !== saved.revision)
      throw new Error(boardSettingsRevisionConflict);
    saved = { ...saved, name: input.name, revision: saved.revision + 1 };
    return saved;
  });

  await render('/boards/board/settings');
  await ready(() => field('Board name'));
  await fill('Board name', 'My local board');
  await fill('Column 1 name', 'My local stage');

  // Another client saves while the first editor keeps its original baseline.
  const firstRemoteSave = {
    ...board,
    name: 'First remote save',
    revision: 4,
  };
  saved = firstRemoteSave;
  const query = trpc.boards.settings.queryFilter({ id: board.id });
  await act(async () => queryClient.invalidateQueries(query));
  expect(field('Board name').value).toBe('My local board');
  await click('Save changes');
  expect(rpc.saveBoard).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: board.revision }),
  );
  expect(document.body.textContent).toContain(
    'Board settings changed elsewhere',
  );
  expect(button('Save changes').disabled).toBe(true);
  await click('Load latest');
  await click('Keep editing');
  expect(rpc.boardSettings).toHaveBeenCalledTimes(2);
  expect(field('Column 1 name').value).toBe('My local stage');

  const background = deferred<typeof board>();
  rpc.boardSettings.mockReturnValueOnce(background.promise);
  await act(async () => {
    void queryClient.invalidateQueries(query);
  });
  saved = {
    ...board,
    name: 'Second remote save',
    revision: 5,
    columns: [{ id: 'stage', name: 'Remote stage' }],
    workflowIds: ['workflow'],
    protectedColumnIds: ['stage'],
  };

  const failedRead = deferred<never>();
  rpc.boardSettings.mockReturnValueOnce(failedRead.promise);
  await click('Load latest');
  await act(async () => {
    const confirm = button('Discard changes');
    confirm.click();
    confirm.click();
  });
  expect(rpc.boardSettings).toHaveBeenCalledTimes(4);
  expect(field('Board name').disabled).toBe(true);
  expect(field('Column 1 name').disabled).toBe(true);
  expect(field('Workflows').disabled).toBe(true);
  await submitTwice(field('Board name'));
  expect(rpc.saveBoard).toHaveBeenCalledTimes(1);
  await act(async () => failedRead.reject(new Error('Read interrupted')));
  expect(document.body.textContent).toContain(
    'Could not load board settings. Read interrupted',
  );
  expect(field('Board name').value).toBe('My local board');
  expect(field('Column 1 name').value).toBe('My local stage');
  expect(warnsBeforeUnload()).toBe(true);

  await click('Load latest');
  await click('Discard changes');
  expect(rpc.boardSettings).toHaveBeenCalledTimes(5);
  await act(async () => background.resolve(firstRemoteSave));
  expect(field('Board name').value).toBe('Second remote save');
  expect(field('Column 1 name').value).toBe('Remote stage');
  expect(button('Remove Remote stage').disabled).toBe(true);
  expect(warnsBeforeUnload()).toBe(false);
  expect(document.body.textContent).not.toContain('Read interrupted');

  await fill('Board name', 'Save after recovery');
  await click('Save changes');
  expect(rpc.saveBoard).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      columns: [{ id: 'stage', name: 'Remote stage' }],
      workflowIds: ['workflow'],
      expectedBoards: { workflow: board.id },
    }),
  );
  expect(router.state.location.pathname).toBe('/boards/board');
});

it('retains the Board draft and its ordinary retry for a separate workflow membership rejection', async () => {
  await render('/boards/board/settings');
  await ready(() => field('Board name'));
  const message =
    'The board for Shared workflow changed. Review the selection and try again.';
  rpc.saveBoard.mockRejectedValue(new Error(message));
  await fill('Board name', 'My local board');
  await click('Save changes');
  expect(document.body.textContent).toContain(message);
  expect(document.body.textContent).not.toContain('Load latest');
  expect(field('Board name').value).toBe('My local board');
  expect(button('Save changes').disabled).toBe(false);
});

it('guards new prompt dismissal and Back, and opens the acknowledged prompt after a failed attempt', async () => {
  await render('/prompts');
  await ready(() => button('New prompt'));
  await click('New prompt');
  await escape();
  expect(discardDialog()).toBeUndefined();
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await click('New prompt');
  await fill('Name', prompt.name);
  await fill('Instructions', prompt.content);
  expect(warnsBeforeUnload()).toBe(true);
  await act(async () => field('Instructions').focus());
  await escape();
  expect(discardDialog()).toBeDefined();
  await escape();
  expect(discardDialog()).toBeUndefined();
  await ready(() => expect(document.activeElement).toBe(field('Instructions')));
  await click('Close dialog', formDialog());
  await click('Keep editing');
  await click('Cancel', formDialog());
  await click('Keep editing');
  await act(async () => field('Instructions').focus());
  await back();
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  await ready(() => expect(document.activeElement).toBe(field('Instructions')));
  expect(field('Instructions').value).toBe(prompt.content);

  const failedSave = deferred<never>();
  rpc.createPrompt.mockReturnValueOnce(failedSave.promise);
  await submitTwice(field('Name'));
  expect(rpc.createPrompt).toHaveBeenCalledTimes(1);
  expect(button('Close dialog', formDialog()).disabled).toBe(true);
  await escape();
  await back();
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname).toBe('/prompts');
  await act(async () => failedSave.reject(new Error('Prompt save failed')));
  expect(document.body.textContent).toContain('Prompt save failed');
  expect(field('Instructions').value).toBe(prompt.content);

  const refresh = deferred<never>();
  rpc.createPrompt.mockResolvedValue(prompt);
  rpc.listPrompts.mockReturnValueOnce(refresh.promise);
  await click('Create prompt');
  expect(router.state.location.pathname).toBe('/prompts/new');
  expect(warnsBeforeUnload()).toBe(false);
  await ready(() => expect(field('Instructions').value).toBe(prompt.content));
  expect(rpc.listPrompts).toHaveBeenCalledTimes(2);
  // The acknowledged prompt remains available after the background read fails.
  await act(async () => refresh.reject(new Error('Prompt refresh failed')));
  expect(field('Instructions').value).toBe(prompt.content);
});

it('discards a custom integration draft on confirmed tab navigation and keeps a failed edit available', async () => {
  await render('/settings/ai');
  await ready(() => button('Add integration'));
  await click('Add integration');
  await fill('Name', 'Unsaved integration');
  await click('Cancel', formDialog());
  await click('Keep editing');
  expect(field('Name').value).toBe('Unsaved integration');
  expect(warnsBeforeUnload()).toBe(true);
  await act(async () => router.navigate('/settings/ai?tab=model-aliases'));
  expect(discardDialog()).toBeDefined();
  await click('Discard changes');
  expect(router.state.location.search).toBe('?tab=model-aliases');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(warnsBeforeUnload()).toBe(false);
  await back();
  await click('Add integration');
  expect(field('Name').value).toBe('');
  await click('Close dialog', formDialog());

  await click('Edit defaults for Test integration');
  await click('Edit integration');
  await fill('Status command', 'local-status');
  await act(async () => {
    const command = field('Status command');
    command.closest('details')!.open = true;
    command.focus();
  });
  await escape();
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  await ready(() =>
    expect(document.activeElement).toBe(field('Status command')),
  );
  const failedSave = deferred<never>();
  rpc.saveIntegration.mockReturnValueOnce(failedSave.promise);
  await submitTwice(field('Name'));
  expect(rpc.saveIntegration).toHaveBeenCalledTimes(1);
  await back();
  expect(router.state.location.pathname).toBe('/settings/ai');
  expect(discardDialog()).toBeUndefined();
  await act(async () =>
    failedSave.reject(new Error('Integration save failed')),
  );
  expect(document.body.textContent).toContain('Integration save failed');
  expect(field('Status command').value).toBe('local-status');
  const refresh = deferred<(typeof profile)[]>();
  const { detection, ...configuration } = profile;
  const saved = {
    ...configuration,
    name: 'Renamed integration',
    statusCommand: 'local-status',
    revision: 5,
  };
  await fill('Name', saved.name);
  rpc.saveIntegration.mockResolvedValue(saved);
  rpc.profiles.mockReturnValueOnce(refresh.promise);
  await click('Save changes', formDialog());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(router.state.location.pathname).toBe('/settings/ai');
  expect(warnsBeforeUnload()).toBe(false);
  expect(rpc.profiles).toHaveBeenCalledTimes(2);

  await click('Edit integration');
  expect(field('Name').value).toBe(saved.name);
  expect(field('Status command').value).toBe(saved.statusCommand);
  const latest = { ...saved, statusCommand: 'second-edit', revision: 6 };
  await fill('Status command', latest.statusCommand);
  rpc.saveIntegration.mockResolvedValueOnce(latest);
  rpc.profiles.mockReturnValueOnce(refresh.promise);
  await click('Save changes', formDialog());
  expect(rpc.saveIntegration).toHaveBeenLastCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({ expectedRevision: saved.revision }),
    }),
  );
  await act(async () => router.navigate('/boards'));
  expect(router.state.location.pathname).toBe('/boards');
  await act(async () => refresh.resolve([{ ...latest, detection }]));
});
