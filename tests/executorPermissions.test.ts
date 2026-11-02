// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ExecutorPermissionMode } from '@interlock/core';
import { ExecutorSelect } from '../packages/ui/src/features/executors/ExecutorSelect';
const rpc = vi.hoisted(() => ({ profiles: vi.fn(), models: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    executors: {
      profiles: { query: rpc.profiles },
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
