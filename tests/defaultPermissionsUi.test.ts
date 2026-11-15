// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  executorProfileSchema,
  type ExecutorPermissionMode,
} from '@interlock/core';
import { UiTestProvider } from './uiTestProvider';
import { ExecutorSelect } from '../packages/ui/src/features/executors/ExecutorSelect';
import { Harnesses } from '../packages/ui/src/features/executors/Harnesses';
import { DefaultPermissionsSettings } from '../packages/ui/src/features/executors/DefaultPermissions';

type Manage = { action: string; profile?: Record<string, unknown> };
const rpc = vi.hoisted(() => ({
  profiles: vi.fn(),
  settings: vi.fn(),
  manage: vi.fn<(q: Manage) => Promise<unknown>>(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      executors: {
        profiles: { query: rpc.profiles },
        settings: { query: rpc.settings },
        manage: { mutate: rpc.manage },
        models: { query: vi.fn() },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
const codex = (permissions?: ExecutorPermissionMode, enabled = true) => ({
  ...executorProfileSchema.parse({
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
    enabled,
    permissions,
  }),
  detection: { status: 'detected', command: '/installed/codex' },
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  Element.prototype.scrollIntoView = vi.fn();
  rpc.manage.mockReset();
  rpc.settings.mockResolvedValue({ revision: 0, concurrency: 3 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
/** Runs a UI action, then lets pending queries and saves settle. */
const settle = (action: () => void) =>
  act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve));
  });
const render = (node: ReturnType<typeof h>) =>
  settle(() => root.render(h(UiTestProvider, {}, node)));
const select = (index: number) => container.querySelectorAll('select')[index];
const choose = (target: HTMLSelectElement, value: string) =>
  settle(() => {
    target.value = value;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });

function WorkflowPermissions() {
  const [permissions, setPermissions] = useState<ExecutorPermissionMode>();
  return h(ExecutorSelect, {
    value: 'codex',
    onChange: () => {},
    workflowPermissions: permissions,
    onPermissionsChange: setPermissions,
  });
}
it('shows the resolved workflow level and its source, and lets the workflow override or restore it', async () => {
  rpc.profiles.mockResolvedValue([codex('full-access')]);
  await render(h(WorkflowPermissions));
  expect(container.textContent).toContain('Full access · set on Codex');
  expect([...select(1).options].map((o) => o.textContent)).toEqual([
    'Use default',
    'Read only',
    'Standard',
    'Full access',
  ]);
  await choose(select(1), 'read-only');
  expect(container.textContent).toContain('Read only · workflow override');
  await choose(select(1), '__default');
  expect(container.textContent).toContain('Full access · set on Codex');
});
it('resolves a harness without its own level to Full access while no default is stored', async () => {
  rpc.profiles.mockResolvedValue([codex()]);
  await render(h(WorkflowPermissions));
  expect(container.textContent).toContain('Full access · from AI Settings');
  rpc.settings.mockResolvedValue({
    revision: 1,
    concurrency: 3,
    defaultPermissions: 'standard',
  });
  await render(h('div'));
  await render(h(WorkflowPermissions));
  expect(container.textContent).toContain('Standard · from AI Settings');
});

// Ask once: only before a shared default exists (a stored default enables
// directly; see the custom integration test in executorPermissions), Cancel
// leaves the harness off, and confirming saves the default before enabling.
it('asks once for the shared default when a harness is first enabled', async () => {
  rpc.profiles.mockResolvedValue([codex(undefined, false)]);
  rpc.manage.mockImplementation((q) =>
    Promise.resolve(
      q.action === 'save_settings'
        ? { revision: 1, concurrency: 3, defaultPermissions: 'full-access' }
        : { ...q.profile, revision: 1 },
    ),
  );
  await render(h(MemoryRouter, {}, h(Harnesses)));
  const toggle = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Enable Codex"]',
    )!;
  const dialog = () => document.querySelector('[role="dialog"]');
  const dialogButton = (text: string) =>
    [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === text,
    )!;
  await settle(() => toggle().click());
  expect(dialog()?.textContent).toContain('How should managed agents run?');
  await settle(() => dialogButton('Cancel').click());
  expect(dialog()).toBeNull();
  expect(rpc.manage).not.toHaveBeenCalled();
  expect(toggle().checked).toBe(false);
  await settle(() => toggle().click());
  expect(
    dialog()!.querySelector<HTMLInputElement>('input[value="full-access"]')!
      .checked,
  ).toBe(true);
  await settle(() => dialogButton('Enable Codex').click());
  expect(rpc.manage.mock.calls.map(([q]) => q)).toEqual([
    {
      action: 'save_settings',
      expectedRevision: 0,
      concurrency: 3,
      defaultPermissions: 'full-access',
    },
    expect.objectContaining({ action: 'save' }),
  ]);
  expect(rpc.manage.mock.calls[1][0].profile).toMatchObject({
    id: 'codex',
    enabled: true,
    permissions: undefined,
  });
  expect(dialog()).toBeNull();
  await settle(() =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Edit defaults for Codex"]',
      )!
      .click(),
  );
  expect(
    [...container.querySelectorAll('option')].map((o) => o.textContent),
  ).toContain('Use default · Full access');
});

it('keeps a harness from being enabled until the shared default can be read', async () => {
  rpc.profiles.mockResolvedValue([codex(undefined, false)]);
  rpc.settings.mockRejectedValue(new Error('Settings offline'));
  await render(h(MemoryRouter, {}, h(Harnesses)));
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Enable Codex"]',
    )!.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('Could not load execution settings.');
});

it('rereads settings and retries once when the first-enable save is stale', async () => {
  rpc.profiles.mockResolvedValue([codex(undefined, false)]);
  rpc.settings
    .mockResolvedValueOnce({ revision: 0, concurrency: 3 })
    .mockResolvedValue({ revision: 4, concurrency: 2 });
  rpc.manage
    .mockRejectedValueOnce(new Error('Execution settings changed.'))
    .mockImplementation((q) =>
      Promise.resolve(
        q.action === 'save_settings'
          ? { revision: 5, concurrency: 2, defaultPermissions: 'standard' }
          : { ...q.profile, revision: 1 },
      ),
    );
  await render(h(MemoryRouter, {}, h(Harnesses)));
  await settle(() =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Enable Codex"]')!
      .click(),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  await settle(() =>
    dialog.querySelector<HTMLInputElement>('input[value="standard"]')!.click(),
  );
  await settle(() =>
    [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent === 'Enable Codex')!
      .click(),
  );
  expect(rpc.manage.mock.calls.map(([q]) => q)).toEqual([
    expect.objectContaining({ expectedRevision: 0 }),
    {
      action: 'save_settings',
      expectedRevision: 4,
      concurrency: 2,
      defaultPermissions: 'standard',
    },
    expect.objectContaining({ action: 'save' }),
  ]);
});

it('offers an unset default so Standard can be saved explicitly', async () => {
  rpc.manage.mockResolvedValue({
    revision: 1,
    concurrency: 3,
    defaultPermissions: 'standard',
  });
  await render(h(DefaultPermissionsSettings));
  expect(select(0).selectedOptions[0].textContent).toBe(
    'Not set (Full access)',
  );
  const save = () =>
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(save().disabled).toBe(true);
  await choose(select(0), 'standard');
  expect(save().disabled).toBe(false);
  await settle(() => save().click());
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'save_settings',
    expectedRevision: 0,
    concurrency: 3,
    defaultPermissions: 'standard',
  });
  expect([...select(0).options].map((o) => o.textContent)).not.toContain(
    'Not set (Full access)',
  );
});
