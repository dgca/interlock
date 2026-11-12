// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SavedModelAlias } from '@interlock/core';
import { TRPCClientError } from '@interlock/client';
import { AgentPresets } from '../packages/ui/src/features/executors/AgentPresets';
import { ModelSettings } from '../packages/ui/src/features/executors/ModelSettings';

const rpc = vi.hoisted(() => ({
  read: vi.fn(),
  mutate: vi.fn(),
  models: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      modelAliases: {
        read: { query: rpc.read },
        mutate: { mutate: rpc.mutate },
      },
      executors: { models: { query: rpc.models } },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
vi.mock('../packages/ui/src/design-system/Modal/Modal', () => ({
  Modal: ({ title, children }: any) =>
    h('section', { role: 'dialog', 'aria-label': title }, children),
}));
const profiles = [
  {
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
    enabled: true,
    detection: { status: 'detected' },
  },
] as any;
let root: Root, container: HTMLDivElement, records: SavedModelAlias[];
const fixture = (): SavedModelAlias => ({
  id: 'alias-reviewer',
  name: 'reviewer',
  description: 'Review code',
  revision: 4,
  createdAt: '',
  updatedAt: '',
  candidates: [
    { model: 'native-model', profileId: 'codex', effort: 'high' },
    { model: 'backup-model', profileId: 'codex' },
  ],
});
beforeEach(() => {
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
  Element.prototype.scrollIntoView = vi.fn();
  records = [fixture()];
  rpc.read.mockReset();
  rpc.mutate.mockReset();
  rpc.models.mockReset();
  rpc.models.mockResolvedValue({
    status: 'ready',
    models: [
      {
        id: 'native-model',
        name: 'Native Model',
        effortLevels: ['low', 'high'],
      },
    ],
    truncated: false,
  });
  rpc.read.mockImplementation(async (q) => {
    if (q.action === 'inspect') {
      const alias = records.find(
        (alias) => alias.id === q.id || (!q.exactId && alias.name === q.id),
      );
      if (!alias)
        throw TRPCClientError.from({
          error: {
            message: 'Model alias does not exist.',
            code: -32603,
            data: { domainRejection: true },
          },
        });
      return structuredClone(alias);
    }
    const filtered = records.filter(
      (alias) =>
        !q.search || `${alias.name} ${alias.description}`.includes(q.search),
    );
    const offset = q.offset ?? 0,
      limit = q.limit ?? 25;
    return {
      items: structuredClone(filtered.slice(offset, offset + limit)),
      total: filtered.length,
      offset,
      limit,
      truncated: offset + limit < filtered.length,
    };
  });
  rpc.mutate.mockImplementation(async (q) => {
    if (q.action === 'delete') {
      records = records.filter((alias) => alias.id !== q.id);
      return { id: q.id };
    }
    const saved = {
      ...fixture(),
      ...q,
      id: q.id ?? 'alias-new',
      revision: (q.expectedRevision ?? 0) + 1,
    };
    records = [...records.filter((alias) => alias.id !== saved.id), saved];
    return saved;
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
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function renderSection(harnesses = profiles) {
  await act(async () =>
    root.render(
      h(DesignSystemProvider, {}, h(AgentPresets, { profiles: harnesses })),
    ),
  );
  await settle();
}
function button(name: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === name,
  )!;
}
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
  await settle();
}
function labelled(name: string) {
  const label = [...document.querySelectorAll('label')].find(
    (label) => label.textContent?.replace(/\s*\*$/, '') === name,
  )!;
  return document.getElementById(label.htmlFor)!;
}
async function fill(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function edit() {
  await click(
    container.querySelector<HTMLElement>(
      '[aria-label="Edit preset reviewer"]',
    )!,
  );
}

it('edits ordered candidates with the inspected revision and preserves effort/profile settings', async () => {
  await renderSection();
  await edit();
  await click(
    container.querySelector<HTMLElement>('[aria-label="Move choice 2 up"]')!,
  );
  await fill(labelled('Name') as HTMLInputElement, 'reviewer-next');
  await click(button('Save changes'));
  expect(rpc.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'update',
      id: 'alias-reviewer',
      expectedRevision: 4,
      name: 'reviewer-next',
      candidates: [
        { model: 'backup-model', profileId: 'codex' },
        { model: 'native-model', profileId: 'codex', effort: 'high' },
      ],
    }),
  );
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('Preset reviewer-next saved.');
});

it('creates an alias using a concrete model picker and cancels another draft without writes', async () => {
  await renderSection();
  await click(button('New preset'));
  await fill(labelled('Name') as HTMLInputElement, 'builder');
  const select = labelled('Harness') as HTMLSelectElement;
  await act(async () => {
    select.value = 'codex';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(labelled('Model'));
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.startsWith('Native Model'))!;
  await click(option);
  await click(button('Create preset'));
  expect(rpc.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      name: 'builder',
      candidates: [{ model: 'native-model', profileId: 'codex' }],
    }),
  );
  await click(button('New preset'));
  await fill(labelled('Name') as HTMLInputElement, 'discarded');
  await click(button('Cancel'));
  expect(rpc.mutate).toHaveBeenCalledTimes(1);
});

it('labels unavailable harnesses in saved presets and keeps the choice editable', async () => {
  await renderSection([
    { ...profiles[0], detection: { status: 'unavailable' } },
  ]);
  expect(container.textContent).toContain('Codex · unavailable');
  await edit();
  const harness = labelled('Harness') as HTMLSelectElement;
  expect(harness.selectedOptions[0].textContent).toBe('Codex · unavailable');
  expect(harness.selectedOptions[0].disabled).toBe(false);
  expect(harness.disabled).toBe(false);
  expect(rpc.mutate).not.toHaveBeenCalled();
});

it('focuses alias editing and protects dirty Back navigation without losing candidate state', async () => {
  await renderSection();
  await edit();
  expect(
    document.querySelector('[role="dialog"][aria-label="Edit preset"]'),
  ).toBeTruthy();
  await fill(labelled('Name') as HTMLInputElement, 'unsaved');
  await click(button('Cancel'));
  expect(
    document.querySelector(
      '[role="dialog"][aria-label="Discard unsaved changes?"]',
    ),
  ).toBeTruthy();
  await click(button('Keep editing'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('unsaved');
  await click(button('Cancel'));
  await click(button('Discard changes'));
  expect(document.querySelector('form')).toBeNull();
  expect(rpc.mutate).not.toHaveBeenCalled();
});

it('keeps edits on conflicts and explicitly reloads the saved revision before another save', async () => {
  await renderSection();
  await edit();
  await fill(labelled('Name') as HTMLInputElement, 'unsaved');
  rpc.mutate.mockRejectedValueOnce(
    new Error('Model alias changed elsewhere. Reload before saving.'),
  );
  await click(button('Save changes'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('unsaved');
  records[0] = { ...fixture(), revision: 5, description: 'Changed elsewhere' };
  await click(button('Load latest'));
  await click(button('Keep editing'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('unsaved');
  await click(button('Load latest'));
  await click(button('Discard changes'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('reviewer');
  await fill(labelled('Name') as HTMLInputElement, 'reviewer-reloaded');
  await click(button('Save changes'));
  expect(rpc.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      description: 'Changed elsewhere',
    }),
  );
});

it('checks an uncertain preset save without discarding local input', async () => {
  await renderSection();
  await edit();
  await fill(labelled('Name') as HTMLInputElement, 'local name');
  rpc.mutate.mockRejectedValueOnce(new Error('Failed to fetch'));
  await click(button('Save changes'));
  records[0] = { ...fixture(), revision: 5, name: 'local name' };
  await click(button('Check saved preset'));
  expect(document.body.textContent).toContain(
    'A newer preset revision is saved',
  );
  expect((labelled('Name') as HTMLInputElement).value).toBe('local name');
  expect(button('Save changes').disabled).toBe(true);
  await click(button('Load latest'));
  await click(button('Discard changes'));
  expect(rpc.mutate).toHaveBeenCalledTimes(1);
  expect(button('Save changes').disabled).toBe(true);
});

it('confirms deletion with the current revision and explains future-run impact', async () => {
  await renderSection();
  await edit();
  await click(button('Delete preset'));
  const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
  expect(dialog.textContent).toContain(
    'New runs referencing this preset will be blocked',
  );
  expect(rpc.mutate).not.toHaveBeenCalled();
  await click(button('Delete preset', dialog));
  expect(rpc.mutate).toHaveBeenCalledWith({
    action: 'delete',
    id: 'alias-reviewer',
    exactId: true,
    expectedRevision: 4,
  });
  expect(container.textContent).toContain('No agent presets yet');
});

it.each(['update', 'delete'] as const)(
  'keeps an acknowledged preset %s visible after a failed refresh',
  async (action) => {
    await renderSection();
    await edit();
    if (action === 'update') {
      await fill(labelled('Name') as HTMLInputElement, 'new reviewer');
    } else {
      await click(button('Delete preset'));
    }
    rpc.read.mockRejectedValueOnce(new Error('Catalog unavailable'));
    const scope =
      action === 'delete'
        ? [...document.querySelectorAll('[role="dialog"]')].at(-1)!
        : document;
    await click(
      button(action === 'delete' ? 'Delete preset' : 'Save changes', scope),
    );
    expect(
      container.querySelector('[aria-label="Edit preset reviewer"]'),
    ).toBeNull();
    if (action === 'update')
      expect(
        container.querySelector('[aria-label="Edit preset new reviewer"]'),
      ).toBeTruthy();
    else expect(container.textContent).toContain('Preset reviewer deleted.');
    expect(container.textContent).toContain(
      'Could not refresh agent presets. Showing the last loaded data. Catalog unavailable',
    );
    await click(button('Retry agent presets'));
    expect(rpc.mutate).toHaveBeenCalledTimes(1);
  },
);

it('keeps the first saved preset actionable while the catalog cannot refresh', async () => {
  records = [];
  await renderSection();
  await click(button('New preset'));
  await fill(labelled('Name') as HTMLInputElement, 'first reviewer');
  const harness = labelled('Harness') as HTMLSelectElement;
  await act(async () => {
    harness.value = 'codex';
    harness.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(labelled('Model'));
  const model = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.includes('Native Model'))!;
  await click(model);
  rpc.read.mockRejectedValueOnce(new Error('Catalog unavailable'));
  await click(button('Create preset'));
  expect(container.textContent).toContain('Preset first reviewer saved.');
  expect(container.textContent).toContain(
    'Could not refresh agent presets. Showing the last loaded data. Catalog unavailable',
  );
  expect(container.textContent).not.toContain('No agent presets yet');
  expect(
    container.querySelector('[aria-label="Edit preset first reviewer"]'),
  ).toBeNull();

  const reads = rpc.read.mock.calls.length;
  await click(button('Open saved preset'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('first reviewer');
  expect(rpc.read).toHaveBeenCalledTimes(reads);
  await click(button('Cancel'));
  expect(button('Open saved preset')).toBeTruthy();
  await click(button('Retry agent presets'));
  expect(
    container.querySelector('[aria-label="Edit preset first reviewer"]'),
  ).toBeTruthy();
  expect(button('Open saved preset')).toBeUndefined();
  expect(rpc.mutate).toHaveBeenCalledTimes(1);
});

it('opens a found preset after uncertain creation only after discarding the local draft', async () => {
  await renderSection();
  await click(button('New preset'));
  await fill(labelled('Name') as HTMLInputElement, 'builder');
  const harness = labelled('Harness') as HTMLSelectElement;
  await act(async () => {
    harness.value = 'codex';
    harness.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(labelled('Model'));
  const model = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.includes('Native Model'))!;
  await click(model);
  rpc.mutate.mockRejectedValueOnce(new Error('Failed to fetch'));
  await click(button('Create preset'));
  records.push({
    ...fixture(),
    id: 'alias-new',
    name: 'builder',
    description: 'Saved preset',
  });
  await click(button('Check saved preset'));
  await click(button('Open saved preset'));
  await click(button('Keep editing'));
  expect((labelled('Name') as HTMLInputElement).value).toBe('builder');
  await click(button('Open saved preset'));
  await click(button('Discard changes'));
  expect((labelled('Description') as HTMLTextAreaElement).value).toBe(
    'Saved preset',
  );
  expect(rpc.read).toHaveBeenLastCalledWith({
    action: 'inspect',
    id: 'alias-new',
    exactId: true,
  });
  expect(rpc.mutate).toHaveBeenCalledTimes(1);
});

it('pages bounded results and recovers from a list failure', async () => {
  records = Array.from({ length: 12 }, (_, index) => ({
    ...fixture(),
    id: `alias-${index}`,
    name: `role-${index}`,
  }));
  rpc.read.mockRejectedValueOnce(new Error('Temporarily unavailable'));
  await renderSection();
  await click(button('Retry agent presets'));
  expect(container.textContent).toContain('role-0');
  expect(container.textContent).not.toContain('role-11');
  await click(button('Next'));
  expect(rpc.read).toHaveBeenLastCalledWith({
    action: 'list',
    offset: 10,
    limit: 10,
  });
  expect(container.textContent).toContain('role-11');
  expect(container.textContent).not.toContain('role-0');
});

it('selects stable alias IDs and leaves thinking effort to candidate settings', async () => {
  const changed = vi.fn();
  function Picker() {
    const [model, setModel] = useState<string>();
    return h(ModelSettings, {
      allowAliases: true,
      label: 'Model',
      defaultLabel: 'Use default',
      effortDefaultLabel: 'Use default',
      profileId: 'codex',
      model,
      onModelChange: (value) => {
        changed(value);
        setModel(value);
      },
      onEffortChange: vi.fn(),
    });
  }
  await act(async () => root.render(h(DesignSystemProvider, {}, h(Picker))));
  await settle();
  await click(labelled('Model'));
  expect(document.body.textContent).toContain('Agent presets');
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.startsWith('reviewer'))!;
  await click(option);
  expect(changed).toHaveBeenCalledWith('alias-reviewer');
  expect(labelled('Model').textContent).toContain('reviewer · agent preset');
  expect(container.textContent).not.toContain('alias-reviewer');
  expect(container.textContent).not.toContain('Thinking effort');
  expect(container.textContent).toContain(
    'Its candidates can choose their own harness and thinking effort.',
  );
});

it('preserves explicit effort overrides on an alias without claiming they are unsupported', async () => {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(ModelSettings, {
          allowAliases: true,
          label: 'Model',
          defaultLabel: 'Use default',
          effortDefaultLabel: 'Use default',
          profileId: 'codex',
          model: 'alias-reviewer',
          effort: 'high',
          onModelChange: vi.fn(),
          onEffortChange: vi.fn(),
        }),
      ),
    ),
  );
  await settle();
  expect(container.textContent).toContain(
    'Preset candidate effort settings take precedence',
  );
  expect(container.textContent).not.toContain('unavailable');
  expect((labelled('Thinking effort') as HTMLSelectElement).value).toBe('high');
  expect(rpc.models).not.toHaveBeenCalled();
});

it('selects a long literal model ID without sending it as an alias search', async () => {
  const changed = vi.fn();
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(ModelSettings, {
          allowAliases: true,
          label: 'Model',
          defaultLabel: 'Use default',
          effortDefaultLabel: 'Use default',
          onModelChange: changed,
          onEffortChange: vi.fn(),
        }),
      ),
    ),
  );
  await click(labelled('Model'));
  rpc.read.mockClear();
  const literal = `provider/${'m'.repeat(129)}`;
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find or enter a model ID"]',
  )!;
  await fill(search, literal);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  expect(rpc.read).not.toHaveBeenCalled();
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent === `Use custom model: ${literal}`)!;
  await click(option);
  expect(changed).toHaveBeenCalledWith(literal, 'literal');
  expect(container.textContent).not.toContain('could not be loaded');
});

it('retains cached aliases with refresh feedback after a background read fails', async () => {
  await renderSection();
  expect(container.textContent).toContain('reviewer');
  rpc.read.mockRejectedValueOnce(new Error('Alias refresh failed'));
  await click(
    document.querySelector<HTMLElement>('[aria-label="Refresh presets"]')!,
  );
  expect(container.textContent).toContain('Alias refresh failed');
  expect(container.textContent).toContain('reviewer');
  expect(
    document.querySelector('[aria-label="Edit preset reviewer"]'),
  ).not.toBeNull();
});
