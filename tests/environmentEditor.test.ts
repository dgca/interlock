// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type ScriptEnvironment,
} from '@interlock/core';
import {
  EnvironmentEditor,
  type ScriptEnvironmentSettings,
} from '../packages/ui/src/features/variables/EnvironmentEditor';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import {
  createQueryClient,
  refreshQueries,
  trpc,
} from '../packages/ui/src/lib/query';
const read = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({ variables: { read: { query: read } } }),
    errorMessage: (e: Error) => e.message,
  };
});
let settings: ScriptEnvironmentSettings | undefined;
let root: Root,
  container: HTMLDivElement,
  latest: ScriptEnvironment | undefined,
  queryClient: ReturnType<typeof createQueryClient>;
let variables: {
  id: string;
  name: string;
  description: string;
  kind: string;
  availability: string;
}[];
let initial: ScriptEnvironment | undefined,
  language: 'javascript' | 'bash' | undefined,
  polling = false,
  key = 0;
function Harness() {
  const [value, setValue] = useState<ScriptEnvironmentSettings>({
    environment: initial,
  });
  return h(EnvironmentEditor, {
    value,
    language,
    polling,
    onChange: (patch) => {
      const next = { ...value, ...patch };
      latest = next.environment;
      settings = next;
      setValue(next);
    },
  });
}
const button = (text: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
async function click(text: string) {
  await act(async () => button(text).click());
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 190));
  });
}
async function render(
  value?: ScriptEnvironment,
  scriptLanguage?: 'javascript' | 'bash',
  scriptCheck = false,
) {
  initial = value;
  latest = value;
  language = scriptLanguage;
  polling = scriptCheck;
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { client: queryClient },
        h(Harness, { key: ++key }),
      ),
    ),
  );
  await settle();
}
async function choose(name: string, row = 0) {
  const picker = container.querySelectorAll<HTMLInputElement>(
    'input[role="combobox"]',
  )[row];
  if (picker.getAttribute('aria-expanded') !== 'true')
    await act(async () => picker.click());
  const options = document.querySelectorAll<HTMLElement>(
    `[role="listbox"][aria-labelledby="${picker.id}-label"] [role="option"]`,
  );
  const option = [...options].find((o) =>
    o.textContent?.startsWith(`${name} · `),
  );
  expect(option, `option ${name}`).toBeTruthy();
  await act(async () => option!.click());
}
async function input(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  variables = [
    {
      id: 'token',
      name: 'GITHUB_TOKEN',
      description: 'Pull requests and repository access',
      kind: 'secret',
      availability: 'ready',
    },
    {
      id: 'other',
      name: 'Other_token',
      description: 'A second credential',
      kind: 'secret',
      availability: 'ready',
    },
    {
      id: 'url',
      name: 'api.url',
      description: 'Service endpoint',
      kind: 'config',
      availability: 'ready',
    },
  ];
  read.mockReset().mockImplementation(async (q) =>
    q.action === 'inspect'
      ? {
          ...variables.find(
            (v) => v.id === (q.id === 'portable-token' ? 'token' : q.id),
          ),
          dependencies: {},
        }
      : {
          items: variables.filter(
            (v) =>
              !q.search ||
              `${v.name} ${v.description}`
                .toLowerCase()
                .includes(q.search.toLowerCase()),
          ),
          total: variables.length,
        },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = createQueryClient();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('adds a complete same-name mapping by selecting a saved variable, with optional alias editing', async () => {
  await render(undefined, 'javascript');
  await click('Add variable');
  await settle();
  expect(document.activeElement?.getAttribute('role')).toBe('combobox');
  await choose('GITHUB_TOKEN');
  expect(latest).toEqual([{ name: 'GITHUB_TOKEN', variableId: 'token' }]);
  expect(container.textContent).toContain('process.env.GITHUB_TOKEN');
  expect(container.textContent).not.toContain('Use in script as');
  await click('Change environment name');
  const name = container.querySelector<HTMLInputElement>(
    'input:not([role="combobox"]):not([type="hidden"]):not([type="radio"])',
  )!;
  await input(name, 'API_KEY');
  expect(latest).toEqual([{ name: 'API_KEY', variableId: 'token' }]);
  expect(container.textContent).toContain('process.env.API_KEY');
  await choose('Other_token');
  expect(latest).toEqual([{ name: 'API_KEY', variableId: 'other' }]);
});
it('preserves case, uses Bash access for omitted legacy language, and retains keys after central renames', async () => {
  await render();
  await click('Add variable');
  await settle();
  await choose('Other_token');
  expect(container.textContent).toContain('$Other_token');
  variables[1].name = 'RENAMED';
  await click('Refresh variables');
  await settle();
  expect(
    container.querySelector<HTMLInputElement>('input[role="combobox"]')!.value,
  ).toContain('RENAMED');
  expect(latest).toEqual([{ name: 'Other_token', variableId: 'other' }]);
  expect(container.textContent).toContain('$Other_token');
});
it('shows an editable suggestion for invalid source names and blocks duplicate environment names', async () => {
  await render([{ name: 'api_url', variableId: 'token' }], 'javascript');
  await click('Add variable');
  await settle();
  await choose('api.url', 1);
  expect(latest?.[1]).toEqual({ name: 'api_url', variableId: 'url' });
  expect(container.textContent).toContain('Confirm or edit this suggestion');
  expect(container.textContent).toContain('already used');
  const name = [
    ...container.querySelectorAll<HTMLInputElement>('input[pattern]'),
  ].at(-1)!;
  expect(name.checkValidity()).toBe(false);
  await input(name, 'OTHER_URL');
  expect(name.isConnected).toBe(true);
  expect(name.checkValidity()).toBe(true);
  expect(latest?.[1].name).toBe('OTHER_URL');
  await input(name, 'bad.name');
  expect(name.checkValidity()).toBe(false);
});
it('preserves row editing state after removing another row', async () => {
  await render([
    { name: 'FIRST', variableId: 'token' },
    { name: 'SECOND', variableId: 'other' },
  ]);
  await act(async () =>
    [...container.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Change environment name')[1]
      .click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Remove FIRST"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLInputElement>('input[pattern]')!.value,
  ).toBe('SECOND');
  expect(latest).toEqual([{ name: 'SECOND', variableId: 'other' }]);
});
it('keeps an imported reference and its label during metadata refresh failures', async () => {
  await render([{ name: 'API_KEY', variableId: 'portable-token' }]);
  expect(
    container.querySelector<HTMLInputElement>('input[role="combobox"]')!.value,
  ).toContain('GITHUB_TOKEN');
  read.mockRejectedValue(Error('Connection lost. Refresh to try again.'));
  await click('Refresh variables');
  await settle();
  expect(
    container.querySelector<HTMLInputElement>('input[role="combobox"]')!.value,
  ).toContain('GITHUB_TOKEN');
  expect(container.textContent).toContain('Connection lost');
  expect(container.textContent).not.toContain('Missing variable');
  expect(latest).toEqual([{ name: 'API_KEY', variableId: 'portable-token' }]);
});
it('keeps the selected reference while a different variable search fails', async () => {
  await render([{ name: 'API_KEY', variableId: 'token' }]);
  const picker = container.querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  )!;
  expect(picker.value).toContain('GITHUB_TOKEN');
  const original = read.getMockImplementation()!;
  let fail!: (error: Error) => void;
  const pending = new Promise((_, reject) => {
    fail = reject;
  });
  read.mockImplementation((query) =>
    query.action === 'list' && query.search === 'token'
      ? pending
      : original(query),
  );

  await act(async () => picker.click());
  await input(picker, 'token');
  const options = () =>
    document.getElementById(picker.getAttribute('aria-controls')!)
      ?.textContent ?? '';
  expect(options()).not.toContain('Other_token');
  await settle();
  await act(async () => fail(new Error('Search unavailable')));
  expect(options()).not.toContain('Other_token');
  expect(container.textContent).toContain('Search unavailable');
  await act(async () => picker.blur());
  expect(picker.value).toContain('GITHUB_TOKEN');
  expect(latest).toEqual([{ name: 'API_KEY', variableId: 'token' }]);
});

it('finds variables by description without leaking the selected label into server search', async () => {
  await render(undefined, 'javascript');
  await click('Add variable');
  await settle();
  const picker = container.querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  )!;
  await input(picker, 'repository');
  await settle();
  expect(
    [...document.querySelectorAll('[role="option"]')].some((o) =>
      o.textContent?.includes('Pull requests and repository access'),
    ),
  ).toBe(true);
  await choose('GITHUB_TOKEN');
  await settle();
  expect(
    read.mock.calls
      .filter(([q]) => q.action === 'list')
      .every(([q]) => !q.search?.includes(' · ')),
  ).toBe(true);
});
it('clears the old naming explanation when replacing a source', async () => {
  await render(undefined, 'javascript');
  await click('Add variable');
  await settle();
  await choose('api.url');
  expect(container.textContent).toContain('Confirm or edit this suggestion');
  await choose('GITHUB_TOKEN');
  expect(latest).toEqual([{ name: 'api_url', variableId: 'token' }]);
  expect(container.textContent).not.toContain(
    'Confirm or edit this suggestion',
  );
});
it('makes clearing a source accessible, preserves its target name and restores picker focus', async () => {
  await render([{ name: 'API_KEY', variableId: 'token' }], 'javascript');
  const clear = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Clear variable"]',
  )!;
  expect(clear.getAttribute('aria-hidden')).toBe('false');
  expect(clear.tabIndex).toBe(0);
  await act(async () => {
    clear.focus();
    clear.click();
  });
  const picker = container.querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  )!;
  expect(document.activeElement).toBe(picker);
  expect(picker.validity.valid).toBe(false);
  expect(latest).toEqual([{ name: 'API_KEY', variableId: '' }]);
});
it('uses shared cache refresh without renaming the script key', async () => {
  await render([{ name: 'API_KEY', variableId: 'token' }], 'javascript');
  variables[0].name = 'RENAMED_TOKEN';
  await act(async () =>
    refreshQueries(queryClient, trpc.variables.read.queryFilter()),
  );
  await settle();
  expect(
    container.querySelector<HTMLInputElement>('input[role="combobox"]')!.value,
  ).toContain('RENAMED_TOKEN');
  expect(latest).toEqual([{ name: 'API_KEY', variableId: 'token' }]);
  expect(container.textContent).toContain('process.env.API_KEY');
});
it.each(['invalid alias', 'unselected search'] as const)(
  'keeps %s in the modal and focuses its control on Apply',
  async (mode) => {
    const definition = blankDefinition();
    const node = nodeSchema.parse({
      id: 'agent',
      kind: 'script',
      label: 'Script',
      language: 'javascript',
      command: 'return {};',
      environment: [
        {
          name: mode === 'invalid alias' ? 'BAD.NAME' : '',
          variableId: mode === 'invalid alias' ? 'token' : '',
        },
      ],
    });
    definition.nodes[1] = node;
    const onApply = vi.fn();
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          {},
          h(SettingsDialog, {
            node,
            name: 'Test',
            description: '',
            definition,
            workflows: [],
            onClose: vi.fn(),
            onApply,
          }),
        ),
      ),
    );
    await settle();
    const field = document.querySelector<HTMLInputElement>(
      mode === 'invalid alias' ? 'input[pattern]' : 'input[role="combobox"]',
    )!;
    if (mode === 'unselected search')
      await input(field, 'typed but not selected');
    expect(field.validity.valid).toBe(false);
    const apply = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Apply changes',
    )!;
    const report = vi.spyOn(field, 'reportValidity');
    await act(async () => {
      apply.focus();
      apply.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    expect(report).toHaveBeenCalled();
    if (mode === 'unselected search')
      expect(document.body.textContent).toContain(
        'Choose a saved variable or remove this entry.',
      );
  },
);

it('shows the execution context for the selected language and polling mode', async () => {
  await render(undefined, 'javascript');
  const scriptHelp = container.querySelector<HTMLDetailsElement>('details')!;
  expect(scriptHelp.open).toBe(false);
  await act(async () => scriptHelp.querySelector('summary')!.click());
  expect(scriptHelp.open).toBe(true);
  expect(scriptHelp.textContent).toContain('process.env.INTERLOCK_RUN_ID');
  expect(scriptHelp.textContent).toContain('INTERLOCK_EXECUTION_ID');
  expect(scriptHelp.textContent).not.toContain('INTERLOCK_POLL_CHECK_NUMBER');

  await render(undefined, 'bash', true);
  const checkHelp = container.querySelector<HTMLDetailsElement>('details')!;
  await act(async () => checkHelp.querySelector('summary')!.click());
  expect(checkHelp.textContent).toContain('$INTERLOCK_RUN_ID');
  expect(checkHelp.textContent).toContain('INTERLOCK_POLL_CHECK_NUMBER');
});

it('keeps existing bindings when switching to minimal mode with passthrough names', async () => {
  await render([{ name: 'API_KEY', variableId: 'token' }]);
  const minimal = [...container.querySelectorAll('label')].find(
    (label) => label.textContent === 'Minimal',
  )!;
  act(() => minimal.click());
  const names = container.querySelector<HTMLInputElement>(
    'input[placeholder="Add a name"]',
  )!;
  await input(names, 'GH_TOKEN');
  act(() => names.blur());
  expect(settings).toEqual({
    environment: [{ name: 'API_KEY', variableId: 'token' }],
    environmentMode: 'minimal',
    environmentPassthrough: ['GH_TOKEN'],
  });
});
