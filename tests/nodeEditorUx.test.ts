// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import {
  definitionSchema,
  nodeSchema,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';

vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let root: Root, container: HTMLDivElement;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

async function render(
  config: Record<string, unknown>,
  graph?: WorkflowDefinition,
) {
  const node = nodeSchema.parse({ id: 'step', label: 'Step', ...config });
  const definition =
    graph ??
    definitionSchema.parse({
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
async function chooseType(label: string, value: string) {
  const input = field(label) as HTMLInputElement;
  await act(async () => input.click());
  await act(async () =>
    document
      .getElementById(input.getAttribute('aria-controls')!)!
      .querySelector<HTMLElement>(`[role="option"][value="${value}"]`)!
      .click(),
  );
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
  await chooseType('Condition match value type', 'json');
  await fill('Condition match value, as JSON', '{');
  await click('Apply changes');
  expect(onApply).not.toHaveBeenCalled();
  await fill('Condition match value, as JSON', '42');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].equals).toBe(42);
});
it('suggests text and unknown fields for Wait while allowing another path', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'until', path: '' },
    inputSchema: {
      type: 'object',
      properties: {
        dueAt: { type: 'string' },
        count: { type: 'integer' },
        details: {
          type: 'object',
          properties: { deadline: { type: 'string' } },
        },
        unknown: {},
      },
    },
  });
  await act(async () => field('Timestamp input path').focus());
  const suggestions = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).map((option) => option.textContent);
  expect(suggestions).toContain('dueAt');
  expect(suggestions).toContain('details.deadline');
  expect(suggestions).toContain('unknown');
  expect(suggestions).not.toContain('count');
  expect(suggestions).not.toContain('details');
  await fill('Timestamp input path', 'customDeadline');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing.path).toBe(
    'customDeadline',
  );
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

it.each(['Required tools', 'Required skills'])(
  'keeps spaces while typing %s and uses commas to add tags',
  async (label) => {
    const { onApply } = await render({ kind: 'agent', prompt: 'Work' });
    await fill(label, 'web ');
    expect(field(label).value).toBe('web ');
    await fill(label, 'web search');
    await act(async () =>
      field(label).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ',',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(field(label).value).toBe('');
    await fill(label, 'read');
    await act(async () => field(label).blur());
    await click('Apply changes');
    const key = label === 'Required tools' ? 'tools' : 'skills';
    expect(onApply.mock.lastCall![0].definition.nodes[0].context[key]).toEqual([
      'web search',
      'read',
    ]);
  },
);
it('switches a Wait to a polling check and applies its schedule, path, value and deadline', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'duration', ms: 60_000 },
  });
  const resume = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).find((input) => input.value === 'poll')!;
  await act(async () => resume.click());
  const language = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((input) => ['javascript', 'bash'].includes(input.value));
  expect(language.find((input) => input.checked)?.value).toBe('javascript');
  await fill('Check every', '2');
  expect(field('Check every unit').value).toBe('60000');
  await fill('Check output field', 'body.state');
  const deadline = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((input) =>
    container
      .querySelector(`label[for="${input.id}"]`)
      ?.textContent?.includes('Give up after a deadline'),
  )!;
  await act(async () => deadline.click());
  await fill('Deadline', '1.5');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing).toMatchObject({
    kind: 'poll',
    everyMs: 120_000,
    timeoutMs: 90 * 60_000,
    check: { kind: 'script', language: 'javascript' },
    path: 'body.state',
    equals: true,
  });
});

it.each(['disable', 'duration', 'until'])(
  'removes the obsolete polling Timeout connection on Apply: %s',
  async (change) => {
    const config = {
      kind: 'wait',
      timing: {
        kind: 'poll',
        everyMs: 1000,
        timeoutMs: 1000,
        check: {
          kind: 'script',
          language: 'javascript',
          command: 'return false;',
        },
        path: '',
        equals: true,
      },
    };
    const graph = definitionSchema.parse({
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Start' },
        { id: 'step', label: 'Step', ...config },
        { id: 'exit', kind: 'exit', label: 'End' },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'step' },
        { id: 'out', source: 'step', target: 'exit' },
        { id: 'late', source: 'step', port: 'timeout', target: 'exit' },
      ],
    });
    const { onApply } = await render(config, graph);
    if (change === 'disable')
      await act(async () =>
        container
          .querySelector<HTMLInputElement>('input[type=checkbox]')!
          .click(),
      );
    else
      await act(async () =>
        container
          .querySelector<HTMLInputElement>(`input[value="${change}"]`)!
          .click(),
      );
    await click('Apply changes');
    const saved = onApply.mock.lastCall![0].definition;
    expect(saved.edges.map((edge: any) => edge.id)).toEqual(['in', 'out']);
    expect(saved.nodes.some((node: any) => node.id === 'exit')).toBe(true);
    expect(() => validateDefinition(saved)).not.toThrow();
  },
);

it('preserves a valid subsecond polling deadline when settings are applied unchanged', async () => {
  const { node, onApply } = await render({
    kind: 'wait',
    timing: {
      kind: 'poll',
      everyMs: 1000,
      timeoutMs: 500,
      check: {
        kind: 'script',
        language: 'javascript',
        command: 'return true;',
      },
      path: '',
      equals: true,
    },
  });
  await click('Apply changes');
  expect(onApply).toHaveBeenCalled();
  expect(onApply.mock.lastCall![0].definition.nodes[0]).toEqual(node);
});
