// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import type { Json } from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import { switchDefinition } from './fixtures/switch';

vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(values: Json[], { withFallback = true } = {}) {
  const definition = switchDefinition(withFallback);
  const node = definition.nodes[1];
  if (node.kind !== 'switch') throw new Error('Expected Switch');
  node.cases = values.map((equals, index) => ({
    port: `branch-${index}`,
    equals,
  }));
  definition.edges = [
    ...definition.edges.filter((edge) => edge.source !== node.id),
    ...[
      ...node.cases.map((entry) => entry.port),
      ...(node.default === undefined ? [] : [node.default]),
    ].map((port) => ({
      id: port,
      source: node.id,
      port,
      target: 'exit',
    })),
  ];
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Test',
          description: '',
          definition,
          node,
          workflows: [],
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  return { onApply, node };
}
async function fill(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    const prototype =
      field.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  const field = container.querySelector<HTMLSelectElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function apply() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Apply changes',
  )!;
  await act(async () => button.click());
}
const cases = (onApply: ReturnType<typeof vi.fn>) =>
  onApply.mock.calls[0][0].definition.nodes[1].cases;

async function chooseUnmatched(value: string) {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
      .click(),
  );
}

it('preserves existing fallbacks and their connections when settings are applied', async () => {
  const { onApply } = await render(['ticket']);
  expect(
    container.querySelector<HTMLInputElement>('input[value="fallback"]')!
      .checked,
  ).toBe(true);
  expect(container.textContent).toContain('Fallback branch name');
  await apply();
  const definition = onApply.mock.calls[0][0].definition;
  expect(definition.nodes[1].default).toBe('none');
  expect(
    definition.edges.some(
      (edge: any) => edge.source === 'route' && edge.port === 'none',
    ),
  ).toBe(true);
});

it('warns before removing a fallback connection and restores it if toggled back before applying', async () => {
  const { onApply } = await render(['ticket']);
  await chooseUnmatched('fail');
  expect(container.textContent).not.toContain('Fallback branch name');
  expect(container.textContent).toContain(
    'Applying these changes removes connections for: none.',
  );
  await chooseUnmatched('fallback');
  expect(container.textContent).not.toContain('connections for: none.');
  await chooseUnmatched('fail');
  await apply();
  const definition = onApply.mock.calls[0][0].definition;
  expect(definition.nodes[1].default).toBeUndefined();
  expect(definition.edges.some((edge: any) => edge.port === 'none')).toBe(
    false,
  );
});

it('allows adding a fallback to a Switch that previously failed on no match', async () => {
  const { onApply } = await render(['ticket'], { withFallback: false });
  expect(
    container.querySelector<HTMLInputElement>('input[value="fail"]')!.checked,
  ).toBe(true);
  await chooseUnmatched('fallback');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].default).toBe('fallback');
});

it('opens every JSON value type without changing existing definitions', async () => {
  const values: Json[] = ['42', 42, false, null, { route: 'ticket' }, [1, 'a']];
  const { onApply, node } = await render(values);
  expect(container.textContent).toContain(
    'Checks a value and follows one matching branch.',
  );
  expect(container.textContent).toContain('Input is JSON data');
  expect(container.textContent).not.toContain('ID:');
  expect(
    container.querySelector<HTMLInputElement>(
      '[aria-label="Case 1 match value"]',
    )!.value,
  ).toBe('42');
  expect(
    Array.from(
      container.querySelectorAll<HTMLSelectElement>(
        'select[aria-label$="type"]',
      ),
    ).map((select) => select.value),
  ).toEqual(['text', 'number', 'boolean', 'null', 'json', 'json']);
  await apply();
  expect(cases(onApply)).toEqual(node.cases);
});

it('edits plain text and typed values without coercing numeric-looking strings', async () => {
  const { onApply } = await render(['', 0, true, null, {}]);
  await fill('Case 1 match value', '42');
  await fill('Case 2 match value', '-3.5');
  await select('Case 3 match value', 'false');
  await fill('Case 5 match value, as JSON', '[1,{"done":true}]');
  await apply();
  expect(cases(onApply).map((entry: any) => entry.equals)).toEqual([
    '42',
    -3.5,
    false,
    null,
    [1, { done: true }],
  ]);
});

it('preserves a scalar when switching between JSON and its ordinary editor', async () => {
  const { onApply } = await render(['ticket']);
  await select('Case 1 match value type', 'json');
  await select('Case 1 match value type', 'text');
  await apply();
  expect(cases(onApply)[0].equals).toBe('ticket');
});

it('blocks applying an invalid number until it is corrected', async () => {
  const { onApply } = await render([1]);
  await fill('Case 1 match value', '-');
  await apply();
  expect(onApply).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Enter a number');
  await fill('Case 1 match value', '1e2');
  await apply();
  expect(cases(onApply)[0].equals).toBe(100);
});

it('keeps invalid JSON with its case when another case is removed', async () => {
  const { onApply } = await render(['remove me', {}]);
  await fill('Case 2 match value, as JSON', '[');
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Remove case 1"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Case 1 match value, as JSON"]',
    )!.value,
  ).toBe('[');
  await apply();
  expect(onApply).not.toHaveBeenCalled();
  await fill('Case 1 match value, as JSON', '[]');
  await apply();
  expect(cases(onApply)).toEqual([{ port: 'branch-1', equals: [] }]);
});
