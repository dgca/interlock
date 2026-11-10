// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RetentionSettings } from '../packages/ui/src/features/runs/RetentionSettings';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  configure: vi.fn(),
  status: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: {
      retentionSettings: { query: mocks.settings },
      configureRetention: { mutate: mocks.configure },
      retentionStatus: { query: mocks.status },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const library = {
  scope: 'library',
  revision: 0,
  policy: null,
  effectivePolicy: null,
  inherited: false,
};
beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.settings.mockResolvedValue(library);
  mocks.status.mockResolvedValue({
    nextCheckAt: null,
    lastSweep: null,
    lastError: null,
    storage: { databaseBytes: 8192, reusableBytes: 4096 },
    intervalMs: 3600000,
    batchLimit: 100,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = (workflowId?: string) =>
  act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RetentionSettings, { workflowId }),
      ),
    ),
  );
const saveButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Save retention settings',
  )!;
const mode = () => container.querySelector<HTMLSelectElement>('select')!;
const changeMode = (value: string) =>
  act(async () => {
    mode().value = value;
    mode().dispatchEvent(new Event('change', { bubbles: true }));
  });
const input = (label: string) => {
  const control = [...container.querySelectorAll('label')].find(
    (l) => l.textContent === label,
  )!;
  return document.getElementById(control.htmlFor) as HTMLInputElement;
};
const enter = (control: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = () =>
  act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

it('keeps disabled defaults and requires a deliberate valid threshold before saving, including zero count', async () => {
  await render();
  expect(mode().value).toBe('disabled');
  expect(saveButton().disabled).toBe(true);
  expect(mocks.configure).not.toHaveBeenCalled();
  await changeMode('enabled');
  expect(saveButton().disabled).toBe(true);
  expect(container.textContent).toContain('Set at least one limit');
  await enter(input('Completed run trees to keep'), '0');
  expect(saveButton().disabled).toBe(false);
  mocks.configure.mockResolvedValue({
    ...library,
    revision: 1,
    policy: { maxCompletedRuns: 0 },
    effectivePolicy: { maxCompletedRuns: 0 },
  });
  await submit();
  expect(mocks.configure).toHaveBeenCalledWith({
    workflowId: undefined,
    expectedRevision: 0,
    policy: { maxCompletedRuns: 0 },
  });
  expect(saveButton().disabled).toBe(true);
  expect(container.textContent).toContain('Retention settings saved.');
  expect(container.textContent).toContain('newest 0 completed trees');
  expect(container.textContent).toContain('The file may not shrink.');
});

it('saves a disabled workflow override then restores inheritance using the current revision', async () => {
  const inherited = {
    scope: 'workflow',
    workflowId: 'workflow',
    revision: 2,
    inherited: true,
    effectivePolicy: { maxAgeDays: 30 },
  };
  mocks.settings.mockResolvedValue(inherited);
  await render('workflow');
  expect(mode().value).toBe('inherit');
  expect(container.textContent).toContain(
    'Saved library policy: Delete trees last updated more than 30 days ago',
  );
  await changeMode('disabled');
  mocks.configure.mockResolvedValue({
    ...inherited,
    revision: 3,
    inherited: false,
    policy: null,
    effectivePolicy: null,
  });
  await submit();
  expect(mocks.configure).toHaveBeenLastCalledWith({
    workflowId: 'workflow',
    expectedRevision: 2,
    policy: null,
  });
  await changeMode('inherit');
  mocks.configure.mockResolvedValue({ ...inherited, revision: 4 });
  await submit();
  expect(mocks.configure).toHaveBeenLastCalledWith({
    workflowId: 'workflow',
    expectedRevision: 3,
    policy: 'inherit',
  });
  expect(mode().value).toBe('inherit');
});

it('preserves unsaved thresholds and the reviewed revision after a stale save error until reload', async () => {
  await render();
  await changeMode('enabled');
  await enter(input('Maximum age in days'), '14');
  mocks.configure.mockRejectedValue(
    new Error('Retention settings changed; reload before saving'),
  );
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'reload before saving',
  );
  expect(input('Maximum age in days').value).toBe('14');
  expect(mocks.configure).toHaveBeenCalledWith({
    workflowId: undefined,
    expectedRevision: 0,
    policy: { maxAgeDays: 14 },
  });
  mocks.settings.mockResolvedValue({
    ...library,
    revision: 7,
    policy: { maxCompletedRuns: 5 },
    effectivePolicy: { maxCompletedRuns: 5 },
  });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'Reload settings')!
      .click(),
  );
  expect(input('Completed run trees to keep').value).toBe('5');
  expect(saveButton().disabled).toBe(true);
});
