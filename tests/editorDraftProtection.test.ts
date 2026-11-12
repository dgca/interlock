// @vitest-environment jsdom
import { transferableAbortController } from 'node:util';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { routes } from '../packages/ui/src/routes';
import { UiTestProvider } from './uiTestProvider';

const rpc = vi.hoisted(() => ({
  saveBoard: vi.fn(),
  boardSettings: vi.fn(),
  createPrompt: vi.fn(),
  listPrompts: vi.fn(),
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
      workflows: { list: { query: empty } },
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

const board = {
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
    root.render(
      h(UiTestProvider, { env: 'test' }, h(RouterProvider, { router })),
    );
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
  let reject!: (error: Error) => void;
  rpc.saveBoard.mockReturnValueOnce(
    new Promise((_resolve, fail) => (reject = fail)),
  );
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

  await act(async () => reject(new Error('Board save failed')));
  expect(document.body.textContent).toContain('Board save failed');
  expect(field('Board name').value).toBe('Local board');
  expect(discardDialog()).toBeUndefined();
  let acknowledge!: () => void;
  rpc.saveBoard.mockReturnValueOnce(
    new Promise((resolve) => {
      acknowledge = () =>
        resolve({ ...board, name: 'Local board', revision: 4 });
    }),
  );
  await click('Save changes');
  await back();
  expect(router.state.location.pathname).toBe('/boards/board/settings');
  await act(async () => acknowledge());
  expect(router.state.location.pathname).toBe('/boards/board');
  await ready(() => expect(warnsBeforeUnload()).toBe(false));
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
  await escape();
  expect(discardDialog()).toBeDefined();
  await escape();
  expect(discardDialog()).toBeUndefined();
  await click('Close dialog', formDialog());
  await click('Keep editing');
  await click('Cancel', formDialog());
  await click('Keep editing');
  await back();
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  expect(field('Instructions').value).toBe(prompt.content);

  let reject!: (error: Error) => void;
  rpc.createPrompt.mockReturnValueOnce(
    new Promise((_resolve, fail) => (reject = fail)),
  );
  await submitTwice(field('Name'));
  expect(rpc.createPrompt).toHaveBeenCalledTimes(1);
  expect(button('Close dialog', formDialog()).disabled).toBe(true);
  await escape();
  await back();
  expect(discardDialog()).toBeUndefined();
  expect(router.state.location.pathname).toBe('/prompts');
  await act(async () => reject(new Error('Prompt save failed')));
  expect(document.body.textContent).toContain('Prompt save failed');
  expect(field('Instructions').value).toBe(prompt.content);

  // A failed refresh must not hide an acknowledged creation.
  rpc.createPrompt.mockResolvedValue(prompt);
  rpc.listPrompts.mockRejectedValue(new Error('Prompt refresh failed'));
  await click('Create prompt');
  expect(router.state.location.pathname).toBe('/prompts/new');
  expect(warnsBeforeUnload()).toBe(false);
  await ready(() => expect(field('Instructions').value).toBe(prompt.content));
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
  await escape();
  expect(discardDialog()).toBeDefined();
  await click('Keep editing');
  let reject!: (error: Error) => void;
  rpc.saveIntegration.mockReturnValueOnce(
    new Promise((_resolve, fail) => (reject = fail)),
  );
  await submitTwice(field('Name'));
  expect(rpc.saveIntegration).toHaveBeenCalledTimes(1);
  await back();
  expect(router.state.location.pathname).toBe('/settings/ai');
  expect(discardDialog()).toBeUndefined();
  await act(async () => reject(new Error('Integration save failed')));
  expect(document.body.textContent).toContain('Integration save failed');
  expect(field('Status command').value).toBe('local-status');
  rpc.saveIntegration.mockResolvedValue(undefined);
  await click('Save changes', formDialog());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(router.state.location.pathname).toBe('/settings/ai');
  expect(warnsBeforeUnload()).toBe(false);
});
