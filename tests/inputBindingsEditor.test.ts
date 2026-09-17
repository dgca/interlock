// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { nodeSchema, type WorkflowNode } from '@interlock/core';
import { InputBindingsEditor } from '../packages/ui/src/features/workflows/InputBindingsEditor';
import { nestedBatches } from './fixtures/batch';
let root: Root, container: HTMLDivElement, latest: WorkflowNode;
let nodes: WorkflowNode[];
const changed = vi.fn();
function Harness() {
  const [node, setNode] = useState(latest);
  return h(InputBindingsEditor, {
    node,
    nodes,
    onChange: (inputBindings) => {
      latest = { ...node, inputBindings };
      changed(inputBindings);
      setNode(latest);
    },
  });
}
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
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  latest = nodeSchema.parse({
    id: 'consumer',
    kind: 'script',
    label: 'Follow up',
    language: 'javascript',
    command: 'return input;',
  });
  nodes = [
    nodeSchema.parse({
      id: 'triage',
      kind: 'agent',
      label: 'Triage',
      prompt: 'Decide',
    }),
    latest,
  ];
  changed.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(h(MantineProvider, {}, h(Harness))));
}
async function input(label: string, value: string) {
  const el = Array.from(container.querySelectorAll('textarea,input')).find(
    (e) =>
      e.getAttribute('aria-label') === label ||
      container.querySelector(`label[for="${e.id}"]`)?.textContent === label,
  ) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent) === label,
  )!;
async function click(label: string) {
  await act(async () => button(label).click());
}
async function select(label: string, value: string) {
  const el = container.querySelector(
    `select[aria-label="${label}"]`,
  ) as HTMLSelectElement;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('leaves default input untouched and adds fields using the first source option', async () => {
  await render();
  const mode = container.querySelector('select')!;
  expect(mode.options[0].text).toBe('Previous step output');
  expect(mode.value).toBe('previous');
  expect(button('Add input field')).toBeUndefined();
  await select('Source', 'fields');
  await click('Advanced JSON');
  await click('Use field editor');
  expect(changed).not.toHaveBeenCalled();
  await click('Add input field');
  const source = container.querySelector(
    'select[aria-label="Read from for field 1"]',
  ) as HTMLSelectElement;
  expect(source.options[0].text).toBe('Previous step output');
  expect(source.value).toBe('input');
  expect(latest.inputBindings).toEqual({
    field: { source: 'input', path: '' },
  });
  await input('Input field 1', 'decision');
  await select('Read from for field 1', 'node');
  expect(container.querySelector('select:invalid')).not.toBeNull();
  await select('Node for field 1', 'triage');
  await input('Output path for field 1', 'answer.text');
  expect(latest.inputBindings).toEqual({
    decision: { source: 'node', nodeId: 'triage', path: 'answer.text' },
  });
  await click('Advanced JSON');
  expect(
    JSON.parse(
      (container.querySelector('textarea') as HTMLTextAreaElement).value,
    ),
  ).toEqual(latest.inputBindings);
  await click('Use field editor');
  await click('Remove field 1');
  expect(latest.inputBindings).toBeUndefined();
});

it('filters node choices to the same Batch scope and retains unavailable draft references', async () => {
  const definition = nestedBatches(2);
  latest.batchId = 'batch1';
  latest.inputBindings = {
    decision: { source: 'node', nodeId: 'deleted', path: '' },
  };
  nodes = [...definition.nodes, latest];
  await render();
  const picker = container.querySelector(
    'select[aria-label="Node for field 1"]',
  ) as HTMLSelectElement;
  expect(Array.from(picker.options).map((option) => option.value)).toEqual([
    '',
    'deleted',
    'work',
    'consumer',
  ]);
  expect(picker.value).toBe('deleted');
  expect(changed).not.toHaveBeenCalled();
  const sources = container.querySelector(
    'select[aria-label="Read from for field 1"]',
  ) as HTMLSelectElement;
  expect(Array.from(sources.options).at(-1)?.value).toBe('itemInput');
});

it('rejects duplicate field names without overwriting a binding', async () => {
  await render();
  await select('Source', 'fields');
  await click('Add input field');
  await click('Add input field');
  const before = latest.inputBindings;
  await input('Input field 2', 'field');
  expect(container.querySelector('input:invalid')).not.toBeNull();
  expect(latest.inputBindings).toEqual(before);
  await input('Input field 2', 'receipt');
  expect(container.querySelector('input:invalid')).toBeNull();
  expect(Object.keys(latest.inputBindings!)).toEqual(['field', 'receipt']);
});

it('validates advanced bindings and preserves explicit empty objects until reset', async () => {
  await render();
  await select('Source', 'fields');
  await click('Advanced JSON');
  await input('Input fields JSON', '{"decision":{"source":"node"}}');
  expect(container.querySelector('textarea:invalid')).not.toBeNull();
  expect(changed).not.toHaveBeenCalled();
  await input(
    'Input fields JSON',
    '{"decision":{"source":"node","nodeId":"triage"}}',
  );
  expect(latest.inputBindings).toEqual({
    decision: { source: 'node', nodeId: 'triage', path: '' },
  });
  await input('Input fields JSON', '{}');
  expect(latest.inputBindings).toEqual({});
  await click('Use field editor');
  expect(container.textContent).toContain('empty input object');
  await select('Source', 'previous');
  expect(latest.inputBindings).toBeUndefined();
});

it('switches back to whole previous output without changing the expected format', async () => {
  latest.inputSchema = { type: 'object', required: ['answer'] };
  const schema = latest.inputSchema;
  latest.inputBindings = {
    answer: { source: 'node', nodeId: 'triage', path: '' },
  };
  await render();
  expect(
    (
      container.querySelector(
        'select[aria-label="Source"]',
      ) as HTMLSelectElement
    ).value,
  ).toBe('fields');
  await click('Advanced JSON');
  await input('Input fields JSON', '{');
  expect(container.querySelector(':invalid')).not.toBeNull();
  await select('Source', 'previous');
  expect(latest.inputBindings).toBeUndefined();
  expect(latest.inputSchema).toEqual(schema);
  expect(container.querySelector(':invalid')).toBeNull();
  expect(button('Advanced JSON')).toBeUndefined();
  await select('Source', 'fields');
  expect(container.querySelector('input')).toBeNull();
  expect(latest.inputBindings).toBeUndefined();
});
