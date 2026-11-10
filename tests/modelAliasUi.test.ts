// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SavedModelAlias } from '@interlock/core';
import { ModelAliases } from '../packages/ui/src/features/executors/ModelAliases';
import { ModelSettings } from '../packages/ui/src/features/executors/ModelSettings';

const rpc = vi.hoisted(() => ({
  read: vi.fn(),
  mutate: vi.fn(),
  models: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    modelAliases: { read: { query: rpc.read }, mutate: { mutate: rpc.mutate } },
    executors: { models: { query: rpc.models } },
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/design-system/Modal/Modal', () => ({
  Modal: ({ title, children }: any) =>
    h('section', { role: 'dialog', 'aria-label': title }, children),
}));
const profiles = [{ id: 'codex', name: 'Codex', enabled: true }] as any;
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
        (alias) => alias.id === q.id || alias.name === q.id,
      );
      if (!alias) throw new Error('Model alias does not exist.');
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
async function renderSection(onDirty = vi.fn()) {
  await act(async () =>
    root.render(
      h(DesignSystemProvider, {}, h(ModelAliases, { profiles, onDirty })),
    ),
  );
  await settle();
  return onDirty;
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
    container.querySelector<HTMLElement>('[aria-label="Edit alias reviewer"]')!,
  );
}

it('edits ordered candidates with the inspected revision and preserves effort/profile settings', async () => {
  const onDirty = await renderSection();
  await edit();
  await click(
    container.querySelector<HTMLElement>('[aria-label="Move choice 2 up"]')!,
  );
  await fill(labelled('Alias name') as HTMLInputElement, 'reviewer-next');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await click(button('Save alias'));
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
  expect(container.textContent).toContain('Alias reviewer-next saved.');
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

it('creates an alias using a concrete model picker and cancels another draft without writes', async () => {
  await renderSection();
  await click(button('New alias'));
  await fill(labelled('Alias name') as HTMLInputElement, 'builder');
  const select = labelled('Harness for choice 1') as HTMLSelectElement;
  await act(async () => {
    select.value = 'codex';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(labelled('Model for choice 1'));
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.startsWith('Native Model'))!;
  await click(option);
  await click(button('Save alias'));
  expect(rpc.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      name: 'builder',
      candidates: [{ model: 'native-model', profileId: 'codex' }],
    }),
  );
  await click(button('New alias'));
  await fill(labelled('Alias name') as HTMLInputElement, 'discarded');
  await click(button('Cancel'));
  expect(rpc.mutate).toHaveBeenCalledTimes(1);
});

it('keeps edits on conflicts and explicitly reloads the saved revision before another save', async () => {
  await renderSection();
  await edit();
  await fill(labelled('Alias name') as HTMLInputElement, 'unsaved');
  rpc.mutate.mockRejectedValueOnce(
    new Error('Model alias changed elsewhere. Reload before saving.'),
  );
  await click(button('Save alias'));
  expect((labelled('Alias name') as HTMLInputElement).value).toBe('unsaved');
  records[0] = { ...fixture(), revision: 5, description: 'Changed elsewhere' };
  await click(button('Reload saved alias'));
  await click(button('Reload', document.querySelector('[role="dialog"]')!));
  expect((labelled('Alias name') as HTMLInputElement).value).toBe('reviewer');
  await fill(labelled('Alias name') as HTMLInputElement, 'reviewer-reloaded');
  await click(button('Save alias'));
  expect(rpc.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      description: 'Changed elsewhere',
    }),
  );
});

it('confirms deletion with the current revision and explains future-run impact', async () => {
  await renderSection();
  await edit();
  await click(button('Delete alias'));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(
    'New runs referencing this alias will be blocked',
  );
  expect(rpc.mutate).not.toHaveBeenCalled();
  await click(button('Delete alias', dialog));
  expect(rpc.mutate).toHaveBeenCalledWith({
    action: 'delete',
    id: 'alias-reviewer',
    expectedRevision: 4,
  });
  expect(container.textContent).toContain('No model aliases yet.');
});

it('pages bounded results and recovers from a list failure', async () => {
  records = Array.from({ length: 12 }, (_, index) => ({
    ...fixture(),
    id: `alias-${index}`,
    name: `role-${index}`,
  }));
  rpc.read.mockRejectedValueOnce(new Error('Temporarily unavailable'));
  await renderSection();
  await click(button('Retry loading aliases'));
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
  expect(document.body.textContent).toContain('Model aliases');
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent?.startsWith('reviewer'))!;
  await click(option);
  expect(changed).toHaveBeenCalledWith('alias-reviewer');
  expect(labelled('Model').textContent).toContain('reviewer · model alias');
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
    'Alias candidate effort settings take precedence',
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
  expect(changed).toHaveBeenCalledWith(literal);
  expect(container.textContent).not.toContain('could not be loaded');
});
