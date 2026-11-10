// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { trpc, useQueryClient } from '../packages/ui/src/lib/query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  executorProfileSchema,
  nodeSchema,
  type WorkflowNode,
  type ExecutorPermissionMode,
} from '@interlock/core';
import { ExecutorSelect } from '../packages/ui/src/features/executors/ExecutorSelect';
import { NodeInspector } from '../packages/ui/src/features/workflows/NodeInspector';
import { ExecutionSettings } from '../packages/ui/src/features/executors/ExecutionSettings';
import { Harnesses as HarnessesPage } from '../packages/ui/src/features/executors/Harnesses';
const Harnesses = ({
  path = '/settings/ai',
  onDirty,
}: {
  path?: string;
  onDirty?: (dirty: boolean) => void;
}) =>
  h(MemoryRouter, { initialEntries: [path] }, h(HarnessesPage, { onDirty }));
const rpc = vi.hoisted(() => ({
  profiles: vi.fn(),
  models: vi.fn(),
  settings: vi.fn(),
  manage: vi.fn(),
  aliases: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      modelAliases: { read: { query: rpc.aliases } },
      stalls: {
        settings: {
          query: async () => ({ id: 'library', revision: 0, policy: {} }),
        },
        configure: {
          mutate: async (q: { expectedRevision: number; policy: unknown }) => ({
            id: 'library',
            revision: q.expectedRevision + 1,
            policy: q.policy,
          }),
        },
      },
      executors: {
        profiles: { query: rpc.profiles },
        settings: { query: rpc.settings },
        manage: { mutate: rpc.manage },
        models: { query: rpc.models },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
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
  rpc.aliases.mockImplementation(async (q) => {
    if (q.action === 'inspect') throw new Error('Model alias does not exist.');
    return { items: [], total: 0, offset: 0, limit: 10, truncated: false };
  });
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
    {
      ...harnessProfile(),
      model: undefined,
      effort: undefined,
      id: 'codex',
      name: 'Codex',
      permissions: 'full-access',
      enabled: true,
    },
    {
      ...harnessProfile(),
      model: undefined,
      effort: undefined,
      id: 'claude-code',
      name: 'Claude Code',
      permissions: 'read-only',
      enabled: true,
    },
  ]);
});
it('prevents edits while reloading shared settings after a revision conflict', async () => {
  await act(async () =>
    root.render(h(DesignSystemProvider, {}, h(ExecutionSettings))),
  );
  const input = container.querySelector<HTMLInputElement>(
    '#concurrency input:not([type="hidden"])',
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
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Models))));
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
it('refreshes models for the draft harness paths without submitting or replacing its selected model', async () => {
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
  await act(async () => button('Configure').click());
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="listbox"]',
  )!;
  let rejectRefresh!: (error: Error) => void;
  rpc.models.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectRefresh = reject;
    }),
  );
  await act(async () => button('Refresh models').click());
  expect(rpc.models).toHaveBeenLastCalledWith({
    profileId: 'codex',
    paths: { command: '/installed/codex', cwd: '/project' },
    refresh: true,
  });
  expect(button('Refresh models').disabled).toBe(true);
  expect(trigger.textContent).toContain('custom-model');
  expect(rpc.manage).not.toHaveBeenCalled();
  await act(async () => rejectRefresh(new Error('Discovery unavailable')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Discovery unavailable',
  );
  expect(button('Refresh models').disabled).toBe(false);
  expect(trigger.textContent).toContain('custom-model');
  await act(async () => button('Refresh models').click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(trigger.textContent).toContain('custom-model');
  expect(button('Save configuration').disabled).toBe(true);
  expect(rpc.manage).not.toHaveBeenCalled();
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
    root.render(h(DesignSystemProvider, {}, h(ExecutionSettings))),
  );
  await act(async () => setLimitMode('unlimited'));
  expect(
    container.querySelector('#concurrency input:not([type="hidden"])'),
  ).toBeNull();
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
    '#concurrency input:not([type="hidden"])',
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
    root.render(h(DesignSystemProvider, {}, h(ExecutionSettings))),
  );
  expect(
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="Assignment limit mode"]',
    )!.value,
  ).toBe('unlimited');
  expect(
    container.querySelector('#concurrency input:not([type="hidden"])'),
  ).toBeNull();
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
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
it('shows Pi installation guidance and allows adding a Pi configuration', async () => {
  rpc.profiles.mockResolvedValue([
    {
      ...harnessProfile(),
      id: 'pi',
      harness: 'pi',
      name: 'Pi',
      detection: { status: 'missing', message: 'pi not found' },
    },
  ]);
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
  expect(
    container.querySelector<HTMLAnchorElement>('a[href="https://pi.dev/"]'),
  ).not.toBeNull();
  await act(async () => button('Add configuration').click());
  const form = container.querySelector<HTMLFormElement>(
    'form[aria-label="Add harness configuration"]',
  )!;
  const select = form.querySelector('select')!;
  expect([...select.options].map((o) => o.value)).toContain('pi');
  await act(async () => {
    select.value = 'pi';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setInput(form.querySelector<HTMLInputElement>('input')!, 'Pi review');
  });
  rpc.manage.mockResolvedValue({});
  await act(async () =>
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
  expect(rpc.manage).toHaveBeenCalledWith({
    action: 'save',
    profile: {
      id: expect.stringMatching(/^pi-/),
      harness: 'pi',
      name: 'Pi review',
      enabled: false,
      expectedRevision: 0,
    },
  });
});
it('preserves open configuration edits across refresh and reloads only on explicit recovery', async () => {
  const original = harnessProfile();
  rpc.profiles.mockResolvedValue([original]);
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
  await act(async () => button('Configure').click());
  const input = container.querySelector<HTMLInputElement>(
    'input[maxlength="120"]',
  )!;
  await act(async () => setInput(input, 'Unsaved name'));
  expect(container.querySelector('#execution-settings')).toBeNull();
  expect(container.querySelector('a[href*="tab=execution"]')?.textContent).toBe(
    'Execution settings',
  );
  expect(container.querySelector('#harnesses')).not.toBeNull();
  expect(input.value).toBe('Unsaved name');
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

it('opens the requested AI task and maps legacy execution anchors before rendering', async () => {
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(Harnesses, { path: '/settings/ai?source=workflow#concurrency' }),
      ),
    ),
  );
  expect(container.querySelector('#concurrency')).toBeTruthy();
  expect(container.querySelector('#harnesses')).toBeNull();
  const harnessLink = container.querySelector<HTMLAnchorElement>(
    'a[href*="tab=harnesses"]',
  )!;
  expect(harnessLink.search).toContain('source=workflow');
  expect(harnessLink.hash).toBe('');
  await act(async () => harnessLink.click());
  expect(container.querySelector('#harnesses')).toBeTruthy();
  expect(container.querySelector('#concurrency')).toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href*="tab=model-aliases"]')!
      .click(),
  );
  expect(container.querySelector('#model-aliases')).toBeTruthy();
  expect(container.querySelector('#harnesses')).toBeNull();
});

it('clears dirty policy state when leaving its task and restores the saved policy on return', async () => {
  const onDirty = vi.fn();
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(Harnesses, { path: '/settings/ai?tab=execution', onDirty }),
      ),
    ),
  );
  const input = container.querySelector<HTMLInputElement>(
    '#concurrency input:not([type="hidden"])',
  )!;
  await act(async () => setInput(input, '5'));
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href*="tab=harnesses"]')!
      .click(),
  );
  expect(onDirty).toHaveBeenLastCalledWith(false);
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href*="tab=execution"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLInputElement>(
      '#concurrency input:not([type="hidden"])',
    )!.value,
  ).toBe('3');
});
it('locks a pending save and preserves model, paths, capabilities and permissions', async () => {
  const original = harnessProfile();
  rpc.profiles.mockResolvedValue([original]);
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
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
  expect(button('Refresh models').disabled).toBe(true);
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
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
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
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Controls))));
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
        DesignSystemProvider,
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

it('offers model-specific effort with node inheritance, native reset and incompatible model feedback', async () => {
  rpc.profiles.mockResolvedValue([
    { ...harnessProfile(), model: 'native-model', effort: 'high' },
  ]);
  rpc.models.mockResolvedValue({
    status: 'ready',
    truncated: false,
    models: [
      {
        id: 'native-model',
        name: 'Native Model',
        effortLevels: ['low', 'high'],
      },
      { id: 'other-model', name: 'Other Model', effortLevels: ['medium'] },
    ],
  });
  const changes: unknown[] = [];
  function NodeModel() {
    const [model, setModel] = useState<string>();
    const [effort, setEffort] = useState<string | null>();
    return h(ExecutorSelect, {
      value: undefined,
      inherit: 'codex',
      onChange: () => {},
      workflowModel: 'native-model',
      workflowEffort: 'high',
      nodeModel: model,
      nodeEffort: effort,
      onNodeModelChange: setModel,
      onNodeEffortChange: (v) => {
        changes.push(v);
        setEffort(v);
      },
    });
  }
  await act(async () => root.render(h(DesignSystemProvider, {}, h(NodeModel))));
  expect(rpc.models).toHaveBeenCalled();
  expect(container.textContent).toContain(
    'native-model · inherited from workflow',
  );
  const effortSelect = () =>
    [...container.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.textContent === 'Use native default'),
    )!;
  expect([...effortSelect().options].map((o) => o.value)).toEqual([
    '__inherit',
    '__native',
    'low',
    'high',
  ]);
  await act(async () => {
    effortSelect().value = 'low';
    effortSelect().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(changes.at(-1)).toBe('low');
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((e) => e.textContent?.includes('Other Model'))!
      .click(),
  );
  expect(container.textContent).toContain('not reported for other-model');
  expect([...effortSelect().options].map((o) => o.value)).toContain('medium');
  expect([...effortSelect().options].map((o) => o.value)).not.toContain('high');
  await act(async () => {
    effortSelect().value = '__native';
    effortSelect().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(changes.at(-1)).toBeNull();
  expect(container.textContent).not.toContain('not reported for other-model');
  await act(async () => {
    effortSelect().value = '__inherit';
    effortSelect().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(changes.at(-1)).toBeUndefined();
  expect(container.textContent).toContain(
    'Thinking effort high is not reported for other-model',
  );
});

it('hides managed model controls for connected nodes and removes manual capability fields from harness settings', async () => {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(ExecutorSelect, {
          value: null,
          inherit: 'codex',
          onChange: () => {},
          nodeModel: 'saved',
          nodeEffort: 'high',
          onNodeModelChange: () => {},
          onNodeEffortChange: () => {},
        }),
      ),
    ),
  );
  expect(container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Harnesses))));
  await act(async () => button('Configure').click());
  expect(container.textContent).not.toContain('Available tools');
  expect(container.textContent).not.toContain('Available skills');
});

it('switches node model controls and advisory tiers without losing either setting', async () => {
  let saved: WorkflowNode;
  function Editor() {
    const [node, setNode] = useState(() =>
      nodeSchema.parse({
        id: 'agent',
        kind: 'agent',
        label: 'Agent',
        prompt: 'Work',
        executor: 'codex',
        model: 'native-model',
        effort: 'high',
        context: { tier: 'fast' },
      }),
    );
    saved = node;
    return h(NodeInspector, {
      node,
      workflows: [],
      section: 'execution',
      onChange: setNode,
    });
  }
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Editor))));
  const field = (label: string) =>
    [...container.querySelectorAll<HTMLSelectElement>('select')].find(
      (el) =>
        container.querySelector(`label[for="${el.id}"]`)?.textContent === label,
    )!;
  expect(field('Model tier')).toBeUndefined();
  expect(container.textContent).toContain('node override');
  await act(async () => {
    field('Executor').value = '__manual';
    field('Executor').dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(field('Model tier').value).toBe('fast');
  expect(container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
  expect(saved!).toMatchObject({
    model: 'native-model',
    effort: 'high',
    context: { tier: 'fast' },
  });
  await act(async () => {
    field('Executor').value = 'codex';
    field('Executor').dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(field('Model tier')).toBeUndefined();
  expect(saved!).toMatchObject({
    model: 'native-model',
    effort: 'high',
    context: { tier: 'fast' },
  });
});

it('keeps cached harness rows visible when returning while their background read is pending', async () => {
  rpc.profiles.mockResolvedValue([harnessProfile()]);
  const renderHarnesses = (visible: boolean) =>
    act(async () => {
      root.render(h(DesignSystemProvider, {}, visible ? h(Harnesses) : null));
    });
  await renderHarnesses(true);
  expect(button('Configure')).toBeTruthy();
  await renderHarnesses(false);
  rpc.profiles.mockImplementationOnce(() => new Promise(() => {}));
  await renderHarnesses(true);
  expect(button('Configure')).toBeTruthy();
  expect(
    container.querySelector('[aria-label="Loading harnesses"]'),
  ).toBeNull();
});

it('updates an unedited open harness from refreshed data without marking it dirty', async () => {
  const onDirty = vi.fn();
  const original = harnessProfile();
  rpc.profiles.mockResolvedValue([original]);
  await act(async () =>
    root.render(h(DesignSystemProvider, {}, h(Harnesses, { onDirty }))),
  );
  await act(async () => button('Configure').click());
  const input = container.querySelector<HTMLInputElement>(
    'input[maxlength="120"]',
  )!;
  const updated = {
    ...original,
    revision: original.revision + 1,
    name: 'Updated elsewhere',
  };
  rpc.profiles.mockResolvedValue([updated]);
  rpc.manage.mockResolvedValue([]);
  await act(async () => button('Check installations').click());
  expect(input.value).toBe('Updated elsewhere');
  expect(onDirty).toHaveBeenLastCalledWith(false);
  await act(async () => setInput(input, 'Local edit'));
  rpc.manage.mockImplementation(async (q) => {
    if (q.action === 'save') throw new Error('Save blocked for this check');
    return [];
  });
  await act(async () => button('Save configuration').click());
  expect(rpc.manage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({
        expectedRevision: updated.revision,
        name: 'Local edit',
      }),
    }),
  );
});

it('orders detected harnesses first and each group by saved name across enable/refetch without remounting open drafts', async () => {
  const base = harnessProfile();
  const missing = { status: 'missing', message: 'Not installed' };
  const source = Object.freeze([
    {
      ...base,
      id: 'missing-z',
      name: 'Zulu missing',
      enabled: true,
      detection: missing,
    },
    { ...base, id: 'detected-z', name: 'Zulu detected', enabled: false },
    { ...base, id: 'tie-b', name: 'twin', enabled: true },
    {
      ...base,
      id: 'missing-a',
      name: 'alpha missing',
      enabled: false,
      detection: missing,
    },
    { ...base, id: 'detected-a', name: 'Alpha detected', enabled: true },
    { ...base, id: 'tie-a', name: 'Twin', enabled: false },
  ]);
  let response = source;
  rpc.profiles.mockReset().mockImplementation(async () => response);
  rpc.manage.mockImplementation(async (request) => {
    expect(request.action).toBe('save');
    response = Object.freeze(
      [...source].reverse().map((profile) =>
        profile.id === request.profile.id
          ? {
              ...profile,
              enabled: request.profile.enabled,
              revision: profile.revision + 1,
            }
          : profile,
      ),
    );
    return {};
  });
  const onDirty = vi.fn();
  await act(async () =>
    root.render(h(DesignSystemProvider, {}, h(Harnesses, { onDirty }))),
  );
  const names = () =>
    [
      ...container.querySelectorAll('#harnesses > div > section[aria-label]'),
    ].map((section) => section.getAttribute('aria-label'));
  const expected = [
    'Alpha detected',
    'Twin',
    'twin',
    'Zulu detected',
    'alpha missing',
    'Zulu missing',
  ];
  expect(names()).toEqual(expected);
  expect(source.map((profile) => profile.id)).toEqual([
    'missing-z',
    'detected-z',
    'tie-b',
    'missing-a',
    'detected-a',
    'tie-a',
  ]);
  const alpha = container.querySelector<HTMLElement>(
    'section[aria-label="Alpha detected"]',
  )!;
  const configure = alpha.querySelector<HTMLButtonElement>(
    'button[aria-controls]',
  )!;
  await act(async () => configure.click());
  const draft = alpha.querySelector<HTMLInputElement>(
    'input[maxlength="120"]',
  )!;
  await act(async () => setInput(draft, 'ZZZ unsaved draft'));
  expect(onDirty).toHaveBeenLastCalledWith(true);
  const toggle = container.querySelector<HTMLInputElement>(
    'input[aria-label="Enable Zulu detected"]',
  )!;
  await act(async () => {
    toggle.focus();
    toggle.click();
  });
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'save',
      profile: expect.objectContaining({
        id: 'detected-z',
        enabled: true,
        expectedRevision: base.revision,
      }),
    }),
  );
  expect(rpc.profiles).toHaveBeenCalledTimes(2);
  expect(names()).toEqual(expected);
  expect(
    container.querySelector('input[aria-label="Enable Zulu detected"]'),
  ).toBe(toggle);
  expect(toggle.checked).toBe(true);
  expect(alpha.querySelector('input[maxlength="120"]')).toBe(draft);
  expect(configure.getAttribute('aria-expanded')).toBe('true');
  expect(draft.value).toBe('ZZZ unsaved draft');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  expect(source.map((profile) => profile.id)).toEqual([
    'missing-z',
    'detected-z',
    'tie-b',
    'missing-a',
    'detected-a',
    'tie-a',
  ]);
});

it('shares cached harness reads across selector remounts and retains them after a background error', async () => {
  let visible = true;
  let client!: ReturnType<typeof useQueryClient>;
  const change = vi.fn();
  function Selectors() {
    client = useQueryClient();
    return visible
      ? h(ExecutorSelect, {
          value: 'codex',
          onChange: change,
          onPermissionsChange: vi.fn(),
        })
      : null;
  }
  const render = () => root.render(h(DesignSystemProvider, {}, h(Selectors)));
  await act(async () => render());
  expect(container.textContent).toContain('Full access · inherited from Codex');
  visible = false;
  await act(async () => render());
  let failProfiles!: (error: Error) => void;
  let failSettings!: (error: Error) => void;
  rpc.profiles.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      failProfiles = reject;
    }),
  );
  rpc.settings.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      failSettings = reject;
    }),
  );
  visible = true;
  await act(async () => render());
  expect(container.textContent).toContain('Full access · inherited from Codex');
  expect(container.textContent).toContain('Up to 3 Agent assignments');
  expect(container.querySelector('select')!.value).toBe('codex');
  expect(change).not.toHaveBeenCalled();
  await act(async () => {
    failProfiles(new Error('Profiles offline'));
    failSettings(new Error('Settings offline'));
  });
  expect(container.textContent).toContain('Profiles offline');
  expect(container.textContent).toContain(
    'Shared assignment limit could not be loaded.',
  );
  expect(container.textContent).toContain('Full access · inherited from Codex');
  expect(container.querySelector('select')!.value).toBe('codex');
  expect(client.getQueryData(trpc.executors.profiles.queryKey())).toHaveLength(
    2,
  );
  expect(change).not.toHaveBeenCalled();
});

it('gates selector reads and refreshes inherited settings without replacing a local permission override', async () => {
  let enabled = false;
  let workflowSettings = false;
  let client!: ReturnType<typeof useQueryClient>;
  function Selector() {
    client = useQueryClient();
    const [permissions, setPermissions] = useState<ExecutorPermissionMode>();
    return h(ExecutorSelect, {
      value: 'codex',
      onChange: vi.fn(),
      enabled,
      workflowPermissions: permissions,
      onPermissionsChange: workflowSettings ? setPermissions : undefined,
    });
  }
  rpc.profiles.mockClear();
  rpc.settings.mockClear();
  const render = () => root.render(h(DesignSystemProvider, {}, h(Selector)));
  await act(async () => render());
  expect(rpc.profiles).not.toHaveBeenCalled();
  expect(rpc.settings).not.toHaveBeenCalled();
  enabled = true;
  await act(async () => render());
  expect(rpc.profiles).toHaveBeenCalledTimes(1);
  expect(rpc.settings).not.toHaveBeenCalled();
  workflowSettings = true;
  await act(async () => render());
  expect(rpc.settings).toHaveBeenCalledTimes(1);
  const permissions = container.querySelectorAll('select')[1];
  await act(async () => {
    permissions.value = 'read-only';
    permissions.dispatchEvent(new Event('change', { bubbles: true }));
  });
  rpc.profiles.mockResolvedValue([
    { ...harnessProfile(), permissions: 'standard' },
  ]);
  await act(async () => {
    await client.invalidateQueries(trpc.executors.profiles.pathFilter());
  });
  expect(permissions.value).toBe('read-only');
  expect(container.textContent).toContain('Read only · workflow override');
});
