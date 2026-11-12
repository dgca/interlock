// @vitest-environment jsdom
import { TRPCClientError } from '@interlock/client';
import { transferableAbortController } from 'node:util';
import {
  blankDefinition,
  boardSettingsRevisionConflict,
  promptRevisionConflict,
  variableRevisionConflict,
  type SaveBoard,
  type WorkflowBoard,
} from '@interlock/core';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { trpc, useQueryClient } from '../packages/ui/src/lib/query';
import { routes } from '../packages/ui/src/routes';
import { paths } from '../packages/ui/src/routes/paths';
import { UiTestProvider } from './uiTestProvider';

const rpc = vi.hoisted(() => ({
  saveBoard: vi.fn(),
  boardSettings: vi.fn(),
  readBoard: vi.fn(),
  createPrompt: vi.fn(),
  getPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  listPrompts: vi.fn(),
  listWorkflows: vi.fn(),
  saveIntegration: vi.fn(),
  profiles: vi.fn(),
  workflowVersions: vi.fn(),
  saveAutomation: vi.fn(),
  inspectAutomation: vi.fn(),
  readVariable: vi.fn(),
  saveVariable: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  const empty = async () => [];
  const emptyPage = async () => ({ items: [], total: 0, nextOffset: null });
  return {
    api: mockRpcClient({
      boards: {
        settings: { query: rpc.boardSettings },
        get: { query: rpc.readBoard },
        list: { query: empty },
        save: { mutate: rpc.saveBoard },
      },
      workflows: {
        list: { query: rpc.listWorkflows },
        versions: { query: rpc.workflowVersions },
      },
      prompts: {
        list: { query: rpc.listPrompts },
        get: { query: rpc.getPrompt },
        create: { mutate: rpc.createPrompt },
        update: { mutate: rpc.updatePrompt },
      },
      requests: { list: { query: emptyPage } },
      triggers: {
        attention: { query: emptyPage },
        inspect: { query: rpc.inspectAutomation },
        preview: { query: async () => ({ upcoming: [] }) },
        manage: { mutate: rpc.saveAutomation },
      },
      variables: {
        read: { query: rpc.readVariable },
        manage: { mutate: rpc.saveVariable },
      },
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
const variable = {
  id: 'variable',
  name: 'credential',
  description: '',
  kind: 'secret',
  availability: 'ready',
  enabled: true,
  revision: 1,
  valueRevision: 1,
};
const inspectVariable = (value = variable) => ({
  ...value,
  storage: {},
  dependencies: {
    items: [],
    total: 0,
    activeRunCount: 0,
    runningComparisonCount: 0,
  },
  bindings: { items: [], total: 0 },
});

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
    import('../packages/ui/src/features/automations/Automations'),
    import('../packages/ui/src/features/executors/Harnesses'),
    import('../packages/ui/src/features/prompts/Prompts'),
    import('../packages/ui/src/features/variables/Variables'),
  ]);
});

beforeEach(() => {
  vi.resetAllMocks();
  rpc.boardSettings.mockResolvedValue(board);
  rpc.readBoard.mockResolvedValue({ board, columns: [], attentionCount: 0 });
  rpc.listPrompts.mockResolvedValue([]);
  rpc.getPrompt.mockResolvedValue({ ...prompt, usage: [] });
  rpc.listWorkflows.mockResolvedValue([]);
  rpc.profiles.mockResolvedValue([profile]);
  rpc.readVariable.mockResolvedValue(inspectVariable());
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

function confirmedRejection(message: string) {
  return new TRPCClientError(message, {
    result: { error: { code: -32600, message, data: { code: 'BAD_REQUEST' } } },
  });
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
  await click('Back to board');
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
  expect(button('Back to board').disabled).toBe(true);
  expect(button('Discard changes').disabled).toBe(true);
  expect(warnsBeforeUnload()).toBe(true);
  await back();
  await act(async () =>
    document
      .querySelector<HTMLAnchorElement>('nav a[href="/prompts"]')!
      .click(),
  );
  expect(router.state.location.pathname).toBe('/boards/board/settings');
  expect(discardDialog()).toBeUndefined();

  await act(async () =>
    failedSave.reject(confirmedRejection('Board save failed')),
  );
  expect(document.body.textContent).toContain('Board save failed');
  expect(field('Board name').value).toBe('Local board');
  expect(discardDialog()).toBeUndefined();
  const retry = deferred<typeof board>();
  const refresh = deferred<[]>();
  rpc.saveBoard.mockReturnValueOnce(retry.promise);
  rpc.listWorkflows.mockReturnValueOnce(refresh.promise);
  rpc.readBoard.mockRejectedValue(new Error('Board read unavailable'));
  await click('Save changes');
  await back();
  expect(router.state.location.pathname).toBe('/boards/board/settings');
  await act(async () =>
    retry.resolve({ ...board, name: 'Local board', revision: 4 }),
  );
  expect(router.state.location.pathname).toBe('/boards/board');
  await ready(() => button('Retry board'));
  expect(document.querySelector('h1')?.textContent).toBe('Local board');
  expect(document.querySelector('header [role="status"]')?.textContent).toBe(
    'Saved',
  );
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

it('keeps an unacknowledged Board creation draft available without submitting it twice', async () => {
  rpc.saveBoard.mockRejectedValueOnce(new TRPCClientError('Failed to fetch'));
  await render(paths.boardNew);
  await fill('Board name', 'Possibly created board');
  await click('Create board');
  await submitTwice(field('Board name'));
  expect(rpc.saveBoard).toHaveBeenCalledTimes(1);
  expect(field('Board name').value).toBe('Possibly created board');
  expect(document.body.textContent).toContain(
    'could not confirm whether the board was created',
  );
  expect(document.querySelector('a[target="_blank"]')?.textContent).toContain(
    'Check Boards',
  );
});

it('checks Board settings before retrying an uncertain update', async () => {
  rpc.saveBoard.mockRejectedValueOnce(new TRPCClientError('Failed to fetch'));
  await render(paths.boardSettings(board.id));
  await ready(() => field('Board name'));
  await fill('Board name', 'Retained board edit');
  await click('Save changes');
  await submitTwice(field('Board name'));
  expect(rpc.saveBoard).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain(
    'could not confirm whether board settings were saved',
  );
  await click('Load latest');
  await click('Discard changes', discardDialog());
  expect(field('Board name').value).toBe('Retained board edit');
  expect(button('Save changes').disabled).toBe(false);
});

it('guards changes to the new automation draft and retains the acknowledged identity after a failed detail read', async () => {
  const draft = blankDefinition();
  rpc.listWorkflows.mockResolvedValue([
    { id: 'workflow', name: 'Target', draft, latestVersion: 1 },
  ]);
  rpc.workflowVersions.mockResolvedValue([{ version: 1, definition: draft }]);
  rpc.inspectAutomation.mockRejectedValue(
    new Error('Automation read unavailable'),
  );
  const current = '/automations/new?type=schedule&workflow=workflow';
  const next = '/automations/new?type=event&workflow=workflow';
  await render(current);
  await ready(() => field('Name'));
  await fill('Name', 'New schedule draft');
  await act(async () => router.navigate(`${current}&from=status%3Ddisabled`));
  expect(discardDialog()).toBeUndefined();
  await act(async () => router.navigate(next));
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  expect(field('Name').value).toBe('New schedule draft');

  const saved = {
    applied: true,
    trigger: { id: 'created', name: 'New schedule draft', revision: 1 },
  };
  const pending = deferred<typeof saved>();
  rpc.saveAutomation.mockReturnValueOnce(pending.promise);
  await submitTwice(field('Name'));
  expect(rpc.saveAutomation).toHaveBeenCalledTimes(1);
  expect(rpc.saveAutomation.mock.calls[0][0]).toMatchObject({
    enabled: false,
    workflowId: 'workflow',
  });
  await act(async () => router.navigate(next));
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname + router.state.location.search).toBe(
    `${current}&from=status%3Ddisabled`,
  );
  await act(async () => pending.resolve(saved));
  await ready(() =>
    expect(document.body.textContent).toContain('Could not refresh automation'),
  );
  expect(router.state.location.pathname + router.state.location.search).toBe(
    '/automations/created?from=status%3Ddisabled',
  );
  expect(document.querySelector('h1')?.textContent).toBe('New schedule draft');
  expect(document.querySelector('header [role="status"]')?.textContent).toBe(
    'Saved',
  );
});

it.each([
  ['a conflict', new Error(variableRevisionConflict)],
  ['an uncertain response', new TRPCClientError('Failed to fetch')],
])(
  'retains an entered Secret through %s and clears it on confirmed recovery',
  async (_label, failure) => {
    await render(paths.variable(variable.id));
    await ready(() => button('Replace value'));
    await click('Replace value');
    await fill('New secret value', 'first-synthetic-secret');
    rpc.saveVariable.mockRejectedValueOnce(failure);
    await click('Save changes');
    expect(field('New secret value').value).toBe('first-synthetic-secret');
    await click('Load latest');
    await click('Keep editing');
    expect(field('New secret value').value).toBe('first-synthetic-secret');
    rpc.readVariable.mockRejectedValueOnce(new Error('Recovery unavailable'));
    await click('Load latest');
    await click('Discard changes', discardDialog());
    expect(field('New secret value').value).toBe('first-synthetic-secret');
    expect(document.body.textContent).toContain('Recovery unavailable');
    const latest = { ...variable, revision: 2, description: 'Saved elsewhere' };
    rpc.readVariable.mockResolvedValue(inspectVariable(latest));
    await click('Load latest');
    await click('Discard changes', discardDialog());
    expect(field('Description').value).toBe('Saved elsewhere');
    expect(warnsBeforeUnload()).toBe(false);

    await click('Replace value');
    await fill('New secret value', 'replacement-synthetic-secret');
    const pending = deferred<typeof variable>();
    rpc.saveVariable.mockReturnValueOnce(pending.promise);
    await submitTwice(field('Name'));
    expect(rpc.saveVariable).toHaveBeenCalledTimes(2);
    expect(rpc.saveVariable.mock.calls[1][0]).toMatchObject({
      action: 'update',
      expectedRevision: 2,
      value: 'replacement-synthetic-secret',
    });
    await back();
    expect(discardDialog()).toBeUndefined();
    expect(router.state.location.pathname).toBe(paths.variable(variable.id));
    rpc.readVariable.mockRejectedValue(new Error('Refresh unavailable'));
    await act(async () =>
      pending.resolve({ ...latest, revision: 3, valueRevision: 2 }),
    );
    await ready(() => button('Retry variable details'));
    expect(warnsBeforeUnload()).toBe(false);
    expect(document.body.textContent).not.toContain(
      'replacement-synthetic-secret',
    );
    expect(
      JSON.stringify(
        queryClient.getQueriesData(trpc.variables.read.pathFilter()),
      ),
    ).not.toContain('replacement-synthetic-secret');
    expect(
      rpc.readVariable.mock.calls.every(
        ([input]) => input.action !== 'config_value',
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(button('Replace value'));
  },
);

it('keeps an uncertain Variable creation draft available for a catalog check', async () => {
  rpc.saveVariable.mockRejectedValueOnce(
    new TRPCClientError('Failed to fetch'),
  );
  await render(paths.variable('new'));
  await ready(() => field('Name'));
  await fill('Name', 'test_credential');
  await click('Create');
  await submitTwice(field('Name'));
  expect(rpc.saveVariable).toHaveBeenCalledTimes(1);
  expect(field('Name').value).toBe('test_credential');
  expect(document.querySelector('a[target="_blank"]')?.textContent).toContain(
    'Check Variables',
  );
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
  rpc.saveBoard.mockRejectedValue(confirmedRejection(message));
  await fill('Board name', 'My local board');
  await click('Save changes');
  expect(document.body.textContent).toContain(message);
  expect(document.body.textContent).not.toContain('Load latest');
  expect(field('Board name').value).toBe('My local board');
  expect(button('Save changes').disabled).toBe(false);
});

it('keeps Board settings usable and retries only unavailable workflow choices', async () => {
  rpc.listWorkflows.mockRejectedValue(new Error('Workflow list unavailable'));
  await render('/boards/board/settings');
  await ready(() => field('Board name'));
  expect(document.body.textContent).toContain('Could not load workflows.');
  expect(field('Board name').disabled).toBe(false);
  await fill('Board name', 'Unsaved rename');

  rpc.listWorkflows.mockResolvedValue([
    { id: 'workflow', name: 'Shared workflow' },
  ]);
  await click('Retry workflows');
  expect(rpc.listWorkflows).toHaveBeenCalledTimes(2);
  expect(rpc.boardSettings).toHaveBeenCalledTimes(1);
  expect(rpc.listPrompts).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('Could not load workflows.');

  rpc.listWorkflows.mockRejectedValue(
    new Error('Workflow refresh unavailable'),
  );
  await act(async () =>
    queryClient.refetchQueries(trpc.workflows.list.queryFilter()),
  );
  expect(document.body.textContent).toContain('Could not refresh workflows.');
  expect(button('Retry workflows')).toBeDefined();
  expect(field('Board name').value).toBe('Unsaved rename');
  expect(button('Save changes').disabled).toBe(false);
});

async function openNewPrompt() {
  const link = () =>
    document.querySelector<HTMLAnchorElement>(
      `header a[href="${paths.promptNew}"]`,
    );
  await ready(() => expect(link()).toBeTruthy());
  await act(async () => link()!.click());
  await ready(() => expect(field('Instructions')).toBeTruthy());
}

it('guards new prompt navigation and recovers an acknowledged creation after losing the response', async () => {
  await render('/prompts');
  await openNewPrompt();
  await click('Back to prompts');
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname).toBe(paths.prompts);

  await openNewPrompt();
  await fill('Name', prompt.name);
  await fill('Instructions', prompt.content);
  expect(warnsBeforeUnload()).toBe(true);
  await act(async () => field('Instructions').focus());
  await escape();
  expect(discardDialog()).toBeUndefined();
  await click('Cancel');
  expect(discardDialog()).toBeDefined();
  await escape();
  expect(discardDialog()).toBeUndefined();
  await ready(() => expect(document.activeElement).toBe(field('Instructions')));
  await back();
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  await ready(() => expect(document.activeElement).toBe(field('Instructions')));
  expect(field('Instructions').value).toBe(prompt.content);

  const failedSave = deferred<never>();
  rpc.createPrompt.mockReturnValueOnce(failedSave.promise);
  await submitTwice(field('Name'));
  expect(rpc.createPrompt).toHaveBeenCalledTimes(1);
  expect(button('Back to prompts').disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  await back();
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname).toBe(paths.promptNew);
  await act(async () => failedSave.reject(new Error('Prompt save failed')));
  expect(document.body.textContent).toContain(
    'could not confirm whether the prompt was saved',
  );
  expect(field('Instructions').value).toBe(prompt.content);
  expect(field('Instructions').closest('fieldset')?.disabled).toBe(true);
  const originalRequest = rpc.createPrompt.mock.calls[0][0];
  expect(originalRequest).toMatchObject({
    name: prompt.name,
    content: prompt.content,
    requestId: expect.any(String),
  });

  rpc.createPrompt.mockResolvedValue(prompt);
  rpc.getPrompt.mockRejectedValue(new Error('Prompt details unavailable'));
  rpc.listPrompts.mockRejectedValue(new Error('Prompt catalog unavailable'));
  await click('Retry creation');
  expect(rpc.createPrompt.mock.calls[1][0]).toEqual(originalRequest);
  expect(router.state.location.pathname).toBe('/prompts/new');
  expect(warnsBeforeUnload()).toBe(false);
  await ready(() => expect(field('Instructions').value).toBe(prompt.content));
  await ready(() => button('Retry prompt details'));
  rpc.getPrompt.mockResolvedValue({ ...prompt, usage: [] });
  await click('Retry prompt details');
  await ready(() =>
    expect(document.body.textContent).toContain('No workflows use this prompt'),
  );
  expect(field('Instructions').value).toBe(prompt.content);
  expect(rpc.createPrompt).toHaveBeenCalledTimes(2);
  await back();
  expect(router.state.location.pathname).toBe(paths.prompts);
});

it('allows correction after a confirmed prompt rejection', async () => {
  rpc.createPrompt
    .mockRejectedValueOnce(
      new TRPCClientError('Correct the prompt name', {
        result: {
          error: {
            code: -32600,
            message: 'Correct the prompt name',
            data: { code: 'BAD_REQUEST' },
          },
        },
      }),
    )
    .mockResolvedValue(prompt);
  await render('/prompts');
  await openNewPrompt();
  await fill('Name', 'First name');
  await fill('Instructions', prompt.content);
  await click('Create prompt');
  await ready(() =>
    expect(document.body.textContent).toContain('Correct the prompt name'),
  );
  expect(field('Name').closest('fieldset')?.disabled).toBe(false);
  await fill('Name', prompt.name);
  await click('Create prompt');
  expect(rpc.createPrompt.mock.calls[1][0]).toMatchObject({
    name: prompt.name,
  });
  expect(rpc.createPrompt.mock.calls[1][0].requestId).not.toBe(
    rpc.createPrompt.mock.calls[0][0].requestId,
  );
});

it('opens the create page and saves when neither catalog is available', async () => {
  rpc.listWorkflows.mockRejectedValue(
    new Error('Unrelated workflows read unavailable'),
  );
  rpc.listPrompts.mockRejectedValue(new Error('Prompt catalog unavailable'));
  rpc.createPrompt.mockResolvedValue(prompt);
  await render(paths.promptNew);
  await ready(() => expect(field('Instructions')).toBeTruthy());
  await fill('Name', prompt.name);
  await fill('Instructions', prompt.content);
  await click('Create prompt');
  await ready(() => expect(field('Instructions').value).toBe(prompt.content));
  expect(router.state.location.pathname).toBe('/prompts/new');
  expect(rpc.listWorkflows).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('Saved · Revision 1');
  expect(document.body.textContent).not.toContain(
    'Action completed, but the view could not refresh',
  );
  expect(document.body.textContent).not.toContain(
    'Unrelated workflows read unavailable',
  );
  expect(
    queryClient.getQueryData(trpc.prompts.list.queryKey()),
  ).toBeUndefined();
});

it('guards an existing prompt save and loads a conflicting revision only after confirmation', async () => {
  const catalog = deferred<(typeof prompt)[]>();
  rpc.listPrompts.mockReturnValueOnce(catalog.promise);
  await render(paths.prompt(prompt.id));
  await ready(() => expect(field('Instructions')).toBeTruthy());
  await fill('Instructions', 'My unsaved edit');
  const pending = deferred<never>();
  rpc.updatePrompt.mockReturnValueOnce(pending.promise);
  await submitTwice(field('Name'));
  expect(rpc.updatePrompt).toHaveBeenCalledExactlyOnceWith({
    id: prompt.id,
    revision: prompt.revision,
    name: prompt.name,
    description: prompt.description,
    content: 'My unsaved edit',
  });
  expect(warnsBeforeUnload()).toBe(true);
  await back();
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname).toBe(paths.prompt(prompt.id));
  await act(async () => pending.reject(new Error(promptRevisionConflict)));
  expect(field('Instructions').value).toBe('My unsaved edit');
  const latest = {
    ...prompt,
    revision: 2,
    content: 'Concurrent edit',
    usage: [],
  };
  const key = trpc.prompts.get.queryKey({ id: prompt.id });
  const olderDetail = deferred<typeof latest>();
  rpc.getPrompt
    .mockReturnValueOnce(olderDetail.promise)
    .mockResolvedValueOnce(latest)
    .mockRejectedValueOnce(new Error('Follow-up detail unavailable'));
  await act(async () => {
    void queryClient.refetchQueries({ queryKey: key, exact: true });
  });
  await click('Load latest');
  await click('Keep editing');
  expect(field('Instructions').value).toBe('My unsaved edit');
  await click('Load latest');
  await click('Discard changes', discardDialog());
  expect(field('Instructions').value).toBe(latest.content);
  await act(async () => olderDetail.resolve({ ...prompt, usage: [] }));
  expect(queryClient.getQueryData(key)).toEqual(latest);
  await ready(() => button('Retry prompt details'));
  expect(document.body.textContent).toContain('Saved · Revision 2');
  expect(warnsBeforeUnload()).toBe(false);
  expect(rpc.updatePrompt).toHaveBeenCalledTimes(1);
  const catalogKey = trpc.prompts.list.queryKey();
  expect(queryClient.getQueryState(catalogKey)?.fetchStatus).toBe('fetching');
  await act(async () => catalog.resolve([prompt]));
  expect(queryClient.getQueryData(catalogKey)).toEqual([prompt]);
  expect(rpc.listPrompts).toHaveBeenCalledTimes(1);
});

it('checks an uncertain update by ID and retains edits made after the attempted save', async () => {
  rpc.updatePrompt.mockRejectedValueOnce(
    new TRPCClientError('Failed to fetch'),
  );
  await render(paths.prompt(prompt.id));
  await ready(() => expect(field('Instructions')).toBeTruthy());
  await fill('Name', '  Normalized name  ');
  await fill('Instructions', 'Submitted instructions');
  await click('Save changes');
  await ready(() => button('Check saved prompt'));
  const stored = {
    ...prompt,
    revision: 2,
    name: 'Normalized name',
    content: 'Submitted instructions',
    usage: [],
  };
  await act(async () => {
    queryClient.setQueryData(
      trpc.prompts.get.queryKey({ id: prompt.id }),
      stored,
    );
  });
  expect(document.body.textContent).toContain(
    'could not confirm whether your changes were saved',
  );
  expect(document.body.textContent).not.toContain('changed elsewhere');
  await fill('Instructions', 'Newer local instructions');
  rpc.getPrompt.mockRejectedValueOnce(new Error('Read unavailable'));
  await click('Check saved prompt');
  expect(document.body.textContent).toContain('Read unavailable');
  expect(field('Instructions').value).toBe('Newer local instructions');
  rpc.getPrompt.mockResolvedValue(stored);
  await click('Check saved prompt');
  expect(rpc.getPrompt).toHaveBeenLastCalledWith({ id: prompt.id });
  expect(document.body.textContent).toContain('Unsaved changes · Revision 2');
  expect(field('Instructions').value).toBe('Newer local instructions');
  expect(rpc.updatePrompt).toHaveBeenCalledTimes(1);
  expect(button('Save changes').disabled).toBe(false);
  rpc.updatePrompt.mockResolvedValue({
    ...stored,
    revision: 3,
    content: 'Newer local instructions',
  });
  await click('Save changes');
  expect(rpc.updatePrompt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      revision: 2,
      content: 'Newer local instructions',
    }),
  );
});

it.each([
  [
    'a newer version',
    { ...prompt, revision: 2, content: 'Another edit' },
    'Load latest',
  ],
  ['the previous version', prompt, 'Save changes'],
])(
  'retains an uncertain draft when the saved prompt shows %s',
  async (_label, stored, action) => {
    rpc.updatePrompt.mockRejectedValueOnce(
      new TRPCClientError('Failed to fetch'),
    );
    await render(paths.prompt(prompt.id));
    await ready(() => expect(field('Instructions')).toBeTruthy());
    await fill('Instructions', 'My edit');
    await click('Save changes');
    rpc.getPrompt.mockResolvedValue({ ...stored, usage: [] });
    await click('Check saved prompt');
    expect(field('Instructions').value).toBe('My edit');
    expect(button(action).disabled).toBe(false);
    expect(rpc.updatePrompt).toHaveBeenCalledTimes(1);
    if (action === 'Load latest') {
      await click(action);
      expect(discardDialog()).toBeDefined();
      expect(field('Instructions').value).toBe('My edit');
    }
  },
);

it('guards integration routes and retains an acknowledged save when refreshing fails', async () => {
  await render('/settings/ai');
  const openLink = async (href: string) => {
    const find = () =>
      document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    await ready(() => expect(find()).not.toBeNull());
    await act(async () => find()!.click());
    await act(async () => vi.dynamicImportSettled());
  };
  await openLink(paths.integrationNew);
  await fill('Name', 'Unsaved integration');
  await click('Cancel');
  await click('Keep editing');
  expect(field('Name').value).toBe('Unsaved integration');
  expect(warnsBeforeUnload()).toBe(true);
  await act(async () => router.navigate('/settings/ai?tab=model-aliases'));
  expect(discardDialog()).toBeDefined();
  await click('Discard changes');
  expect(router.state.location.search).toBe('?tab=model-aliases');
  expect(warnsBeforeUnload()).toBe(false);

  await act(async () => router.navigate('/settings/ai?tab=harnesses'));
  await click('Edit defaults for Test integration');
  await openLink(paths.integration(profile.id));
  await fill('Status command', 'local-status');
  const failedSave = deferred<never>();
  rpc.saveIntegration.mockReturnValueOnce(failedSave.promise);
  await submitTwice(field('Name'));
  expect(rpc.saveIntegration).toHaveBeenCalledTimes(1);
  await back();
  expect(router.state.location.pathname).toBe(paths.integration(profile.id));
  expect(discardDialog()).toBeUndefined();
  await act(async () =>
    failedSave.reject(
      TRPCClientError.from({
        error: {
          message: 'Integration save failed',
          code: -32600,
          data: { code: 'BAD_REQUEST' },
        },
      }),
    ),
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
  await click('Save changes');
  expect(router.state.location.pathname).toBe(paths.integration(profile.id));
  expect(warnsBeforeUnload()).toBe(false);
  expect(field('Name').value).toBe(saved.name);
  await act(async () => refresh.reject(new Error('Profiles unavailable')));
  expect(field('Status command').value).toBe(saved.statusCommand);
  expect(document.body.textContent).toContain('Profiles unavailable');
  rpc.profiles.mockResolvedValue([{ ...saved, detection }]);
  await click('Retry loading harnesses');
  expect(rpc.saveIntegration).toHaveBeenCalledTimes(2);

  const latest = { ...saved, statusCommand: 'second-edit', revision: 6 };
  await fill('Status command', latest.statusCommand);
  rpc.saveIntegration.mockResolvedValueOnce(latest);
  await click('Save changes');
  expect(rpc.saveIntegration).toHaveBeenLastCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({ expectedRevision: saved.revision }),
    }),
  );
});

it('keeps the integration draft through a conflict until Load latest is confirmed', async () => {
  await render(paths.integration(profile.id));
  await ready(() => field('Name'));
  await fill('Status command', 'my-status');
  rpc.saveIntegration.mockRejectedValueOnce(
    new Error('Harness configuration changed. Reload before saving.'),
  );
  await click('Save changes');
  rpc.profiles.mockResolvedValue([
    {
      ...profile,
      statusCommand: 'remote-status',
      revision: profile.revision + 1,
    },
  ]);
  await click('Load latest');
  await click('Keep editing');
  expect(field('Status command').value).toBe('my-status');
  await click('Load latest');
  await click('Discard changes', discardDialog());
  await ready(() =>
    expect(field('Status command').value).toBe('remote-status'),
  );
});

it('checks an uncertain integration creation by its original profile ID', async () => {
  await render(paths.integrationNew);
  await ready(() => field('Name'));
  await fill('Name', 'New integration');
  await fill('Turn command', 'fixture-command');
  rpc.saveIntegration.mockRejectedValueOnce(
    new TRPCClientError('Failed to fetch'),
  );
  await click('Create integration');
  const attempted = rpc.saveIntegration.mock.calls[0][0].profile;
  const saved = {
    ...attempted,
    revision: 1,
    detection: { status: 'detected' },
  };
  rpc.profiles.mockResolvedValue([saved]);
  await click('Check saved integration');
  expect(document.body.textContent).toContain(
    'A newer integration revision is saved',
  );
  expect(field('Turn command').value).toBe('fixture-command');
  await click('Load latest');
  await click('Discard changes', discardDialog());
  await ready(() =>
    expect(router.state.location.pathname).toBe(
      paths.integration(attempted.id),
    ),
  );
  expect(rpc.saveIntegration).toHaveBeenCalledTimes(1);
  expect(field('Name').value).toBe('New integration');
});
