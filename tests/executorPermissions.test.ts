// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ExecutorPermissionMode } from '@interlock/core';
import { ExecutorSelect } from '../packages/ui/src/features/executors/ExecutorSelect';
import { ExecutionSettings } from '../packages/ui/src/features/executors/ExecutionSettings';
const rpc = vi.hoisted(() => ({
  profiles: vi.fn(),
  models: vi.fn(),
  settings: vi.fn(),
  manage: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    executors: {
      profiles: { query: rpc.profiles },
      settings: { query: rpc.settings },
      manage: { mutate: rpc.manage },
      models: { query: rpc.models },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Element.prototype.scrollIntoView = vi.fn();
  rpc.models.mockReset();
  rpc.manage.mockReset();
  rpc.settings.mockResolvedValue({ revision: 0, concurrency: 3 });
  rpc.models.mockResolvedValue({
    status: 'ready',
    models: [{ id: 'native-model', name: 'Native Model' }],
    truncated: false,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  rpc.profiles.mockResolvedValue([
    { id: 'codex', name: 'Codex', permissions: 'full-access', enabled: true },
    {
      id: 'claude-code',
      name: 'Claude Code',
      permissions: 'read-only',
      enabled: true,
    },
  ]);
});
it('prevents edits while reloading shared settings after a revision conflict', async () => {
  await act(async () =>
    root.render(h(MantineProvider, {}, h(ExecutionSettings))),
  );
  const input = container.querySelector('input')!;
  const fill = (value: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  rpc.manage.mockRejectedValueOnce(
    new Error('Execution settings changed. Reload before saving.'),
  );
  await act(async () => fill('5'));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click(),
  );
  expect(container.textContent).toContain('Execution settings changed');
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'save_settings',
    concurrency: 5,
    expectedRevision: 0,
  });
  let resolve!: (settings: { revision: number; concurrency: number }) => void;
  rpc.settings.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Reload settings')!
      .click(),
  );
  expect(input.disabled).toBe(true);
  await act(async () => resolve({ revision: 1, concurrency: 4 }));
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('4');
});
it('loads a workflow model picker on demand and lets it return to the harness default', async () => {
  function Models() {
    const [model, setModel] = useState<string>();
    return h(ExecutorSelect, {
      value: 'codex',
      onChange: () => {},
      workflowModel: model,
      onModelChange: setModel,
    });
  }
  await act(async () => root.render(h(MantineProvider, {}, h(Models))));
  expect(rpc.models).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    'Up to 3 Agent assignments at once across all harnesses and workflows.',
  );
  const trigger = container.querySelector(
    'button[aria-haspopup="listbox"]',
  ) as HTMLButtonElement;
  await act(async () => trigger.click());
  expect(rpc.models).toHaveBeenCalledWith({
    profileId: 'codex',
    paths: undefined,
    refresh: false,
  });
  const choose = (text: string) => {
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((e) => e.textContent?.includes(text));
    expect(option).toBeDefined();
    option!.click();
  };
  await act(async () => choose('Native Model'));
  expect(container.textContent).toContain('native-model · workflow override');
  await act(async () => trigger.click());
  await act(async () => choose('Use harness default'));
  expect(container.textContent).toContain('CLI default · inherited from Codex');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function Controls() {
  const [permissions, setPermissions] = useState<ExecutorPermissionMode>();
  return h(ExecutorSelect, {
    value: 'codex',
    onChange: () => {},
    workflowPermissions: permissions,
    onPermissionsChange: setPermissions,
  });
}
it('shows the inherited mode and lets the workflow override or restore it', async () => {
  await act(async () => root.render(h(MantineProvider, {}, h(Controls))));
  expect(container.textContent).toContain('Full access · inherited from Codex');
  const select = container.querySelectorAll('select')[1];
  expect([...select.options].map((o) => o.textContent)).toEqual([
    'Use harness default',
    'Read only',
    'Standard',
    'Full access',
  ]);
  await act(async () => {
    select.value = 'read-only';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Read only · workflow override');
  await act(async () => {
    select.value = '__default';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Full access · inherited from Codex');
});
it('shows effective workflow permissions for a node-specific executor without another override', async () => {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(ExecutorSelect, {
          value: 'claude-code',
          inherit: 'codex',
          workflowPermissions: 'standard',
          onChange: () => {},
        }),
      ),
    ),
  );
  expect(container.textContent).toContain('Standard · workflow override');
  expect(container.querySelectorAll('select')).toHaveLength(1);
});
