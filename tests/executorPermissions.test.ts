// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  executorProfileSchema,
  type ExecutorPermissionMode,
} from '@interlock/core';
import { ExecutorSelect } from '../packages/ui/src/features/executors/ExecutorSelect';
import { ExecutionSettings } from '../packages/ui/src/features/executors/ExecutionSettings';
import { Harnesses } from '../packages/ui/src/features/executors/Harnesses';
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  const input = container.querySelector<HTMLInputElement>(
    'input:not([type="hidden"])',
  )!;
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
  vi.unstubAllGlobals();
});
const harnessProfile = () => ({
  ...executorProfileSchema.parse({
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
    model: 'custom-model',
    cwd: '/project',
    command: '/installed/codex',
    tools: ['git'],
    skills: ['review'],
    permissions: 'standard',
  }),
  detection: {
    status: 'detected',
    command: '/installed/codex',
    version: 'fixture',
  },
});
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
}
function setLimitMode(value: string) {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Assignment limit mode"]',
  )!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
it('saves Unlimited explicitly and accepts a larger numeric limit when returning to Limited', async () => {
  await act(async () =>
    root.render(h(MantineProvider, {}, h(ExecutionSettings))),
  );
  await act(async () => setLimitMode('unlimited'));
  expect(container.querySelector('input:not([type="hidden"])')).toBeNull();
  expect(container.textContent).toContain('Start every ready assignment');
  rpc.manage.mockResolvedValueOnce({ revision: 1, concurrency: null });
  await act(async () => button('Save limit').click());
  expect(rpc.manage).toHaveBeenLastCalledWith({
    action: 'save_settings',
    expectedRevision: 0,
    concurrency: null,
  });
  await act(async () => setLimitMode('limited'));
  const input = container.querySelector<HTMLInputElement>(
    'input:not([type="hidden"])',
  )!;
  expect(input.value).toBe('3');
  await act(async () => setInput(input, '25'));
  rpc.manage.mockResolvedValueOnce({ revision: 2, concurrency: 25 });
  await act(async () => button('Save limit').click());
  expect(rpc.manage).toHaveBeenLastCalledWith({
    action: 'save_settings',
    expectedRevision: 1,
    concurrency: 25,
  });
});
it('loads saved Unlimited and explains it in workflow settings', async () => {
  rpc.settings.mockResolvedValue({ revision: 2, concurrency: null });
  await act(async () =>
    root.render(h(MantineProvider, {}, h(ExecutionSettings))),
  );
  expect(
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="Assignment limit mode"]',
    )!.value,
  ).toBe('unlimited');
  expect(container.querySelector('input:not([type="hidden"])')).toBeNull();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(ExecutorSelect, {
          value: 'codex',
          onChange: () => {},
          onModelChange: () => {},
        }),
      ),
    ),
  );
  expect(container.textContent).toContain('No shared assignment limit');
  expect(container.textContent).not.toContain('Up to null');
});
it('preserves open configuration edits across refresh and reloads only on explicit recovery', async () => {
  const original = harnessProfile();
  rpc.profiles.mockResolvedValue([original]);
  await act(async () => root.render(h(MantineProvider, {}, h(Harnesses))));
  await act(async () => button('Configure').click());
  const input = container.querySelector<HTMLInputElement>(
    'input[maxlength="120"]',
  )!;
  await act(async () => setInput(input, 'Unsaved name'));
  const updated = { ...original, revision: 1, name: 'Updated elsewhere' };
  rpc.profiles.mockResolvedValue([updated]);
  rpc.manage.mockImplementation(async (q) => {
    if (q.action === 'list') return [updated];
    throw new Error('Harness configuration changed. Reload before saving.');
  });
  await act(async () => button('Check installations').click());
  expect(input.value).toBe('Unsaved name');
  await act(async () => button('Save configuration').click());
  expect(container.textContent).toContain('Harness configuration changed');
  expect(input.value).toBe('Unsaved name');
  await act(async () => button('Reload configuration').click());
  expect(input.value).toBe('Updated elsewhere');
  expect(button('Save configuration').disabled).toBe(true);
});
it('locks a pending save and preserves model, paths, capabilities and permissions', async () => {
  const original = harnessProfile();
  rpc.profiles.mockResolvedValue([original]);
  await act(async () => root.render(h(MantineProvider, {}, h(Harnesses))));
  await act(async () => button('Configure').click());
  const input = container.querySelector<HTMLInputElement>(
    'input[maxlength="120"]',
  )!;
  await act(async () => setInput(input, 'Renamed configuration'));
  let resolve!: (profile: unknown) => void;
  rpc.manage.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => button('Save configuration').click());
  expect(input.disabled).toBe(true);
  expect(button('Cancel editing').disabled).toBe(true);
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"]',
    )!.disabled,
  ).toBe(true);
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'save',
    profile: {
      id: 'codex',
      harness: 'codex',
      name: 'Renamed configuration',
      enabled: false,
      expectedRevision: 0,
      model: 'custom-model',
      cwd: '/project',
      command: '/installed/codex',
      permissions: 'standard',
      tools: ['git'],
      skills: ['review'],
    },
  });
  const updated = { ...original, name: 'Renamed configuration', revision: 1 };
  rpc.profiles.mockResolvedValue([updated]);
  await act(async () => resolve(updated));
  expect(button('Configure')).toBeDefined();
  await act(async () => button('Configure').click());
  await act(async () =>
    setInput(
      container.querySelector<HTMLInputElement>('input[maxlength="120"]')!,
      'Discard this',
    ),
  );
  await act(async () => button('Cancel editing').click());
  expect(document.activeElement).toBe(button('Configure'));
  await act(async () => button('Configure').click());
  expect(
    container.querySelector<HTMLInputElement>('input[maxlength="120"]')!.value,
  ).toBe('Renamed configuration');
});
it('offers recovery instead of an endless loading skeleton after a failed harness lookup', async () => {
  rpc.profiles.mockRejectedValueOnce(new Error('Harness lookup failed'));
  await act(async () => root.render(h(MantineProvider, {}, h(Harnesses))));
  expect(container.textContent).toContain('Harness lookup failed');
  expect(
    container.querySelector('[aria-label="Loading harnesses"]'),
  ).toBeNull();
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  await act(async () => button('Retry loading harnesses').click());
  expect(button('Configure')).toBeDefined();
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
