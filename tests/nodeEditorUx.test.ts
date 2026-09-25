// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { definitionSchema, nodeSchema } from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';

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

async function render(config: Record<string, unknown>) {
  const node = nodeSchema.parse({ id: 'step', label: 'Step', ...config });
  const definition = definitionSchema.parse({
    nodes: [node, { id: 'exit', kind: 'exit', label: 'Exit' }],
    edges: [],
  });
  const onApply = vi.fn();
  const onClose = vi.fn();
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
          onApply,
          onClose,
        }),
      ),
    ),
  );
  return { node, onApply, onClose };
}
function field(label: string) {
  return Array.from(
    container.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input,select,textarea'),
  ).find(
    (el) =>
      el.getAttribute('aria-label') === label ||
      container
        .querySelector(`label[for="${el.id}"]`)
        ?.textContent?.replace(/\s*\*$/, '') === label,
  )!;
}
async function fill(label: string, value: string) {
  const el = field(label);
  await act(async () => el.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  await act(async () => {
    field(label).value = value;
    field(label).dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === text)!
      .click(),
  );
}
it.each(
  ['42', 42, false, null, { approved: true }, [1, 'a']].map((equals) => ({
    equals,
  })),
)(
  'preserves the Condition comparison $equals when applied without edits',
  async ({ equals }) => {
    const { node, onApply } = await render({
      kind: 'condition',
      path: 'status',
      equals,
    });
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0]).toEqual(node);
  },
);
it('keeps text distinct from numbers and blocks invalid Condition JSON', async () => {
  const { onApply } = await render({ kind: 'condition', path: '', equals: '' });
  await fill('Condition match value', '42');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].equals).toBe('42');
  onApply.mockClear();
  await select('Condition match value type', 'json');
  await fill('Condition match value, as JSON', '{');
  await click('Apply changes');
  expect(onApply).not.toHaveBeenCalled();
  await fill('Condition match value, as JSON', '42');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].equals).toBe(42);
});
it.each(['script', 'fetch'])(
  'edits %s timeouts in seconds and enforces the existing bounds',
  async (kind) => {
    const { onApply } = await render({
      kind,
      command: 'cat',
      url: 'https://example.com',
      timeoutMs: 30_000,
    });
    expect(field('Timeout').value).toBe('30');
    expect(field('Timeout unit').value).toBe('1000');
    await fill('Timeout', '121');
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
    await fill('Timeout', '0.05');
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
    await fill('Timeout', '1.5');
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0].timeoutMs).toBe(1500);
  },
);
it('preserves legacy Bash and exact millisecond durations', async () => {
  const { node, onApply } = await render({
    kind: 'script',
    command: 'cat',
    timeoutMs: 1501,
  });
  expect(field('Timeout').value).toBe('1501');
  expect(field('Timeout unit').value).toBe('1');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).toEqual(node);
  expect(onApply.mock.calls[0][0].definition.nodes[0].language).toBeUndefined();
});
it('keeps capability arrays intact, adds tags with Enter and accepts unfinished text on blur', async () => {
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Do work',
    context: { tools: ['Read', 'read'], skills: ['review'] },
  });
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].context.tools).toEqual([
    'Read',
    'read',
  ]);
  await fill('Required tools', 'search');
  await act(async () =>
    field('Required tools').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  await act(async () => field('Required skills').focus());
  await fill('Required skills', ' testing ');
  await act(async () => field('Required skills').blur());
  await click('Apply changes');
  const context = onApply.mock.lastCall![0].definition.nodes[0].context;
  expect(context.tools).toEqual(['Read', 'read', 'search']);
  expect(context.skills).toEqual(['review', 'testing']);
});
it('discards edited comparisons on Cancel', async () => {
  const { onApply, onClose, node } = await render({
    kind: 'condition',
    path: '',
    equals: 'before',
  });
  await fill('Condition match value', 'after');
  await click('Cancel');
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  expect(node).toHaveProperty('equals', 'before');
});
