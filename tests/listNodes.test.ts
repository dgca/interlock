// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import { FlowNode } from '../packages/ui/src/features/workflows/FlowNode';

vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
vi.mock(
  '../packages/ui/node_modules/@xyflow/react',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    Handle: ({ id, type, ...props }: any) =>
      h('span', {
        'data-handle': id,
        'data-type': type,
        'aria-label': props['aria-label'],
      }),
  }),
);
vi.mock(
  '../packages/ui/src/components/ContractEditor/ContractEditor',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    ContractEditor: ({ label, value, onChange }: any) =>
      h(
        'section',
        { 'data-contract': label },
        h('span', {}, JSON.stringify(value)),
        h(
          'button',
          {
            onClick: () =>
              onChange({ type: 'array', items: { type: 'number' } }),
          },
          `Change ${label}`,
        ),
      ),
  }),
);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it('renders four labeled List handles with internal Start and End and retains two legacy Map handles', async () => {
  await act(async () =>
    root.render(
      h(FlowNode, {
        data: {
          node: nodeSchema.parse({ id: 'list', label: 'List', kind: 'list' }),
        },
      } as any),
    ),
  );
  expect(
    Array.from(container.querySelectorAll('[data-handle]')).map((el) => [
      el.getAttribute('data-handle'),
      el.getAttribute('data-type'),
    ]),
  ).toEqual([
    ['default', 'target'],
    ['complete', 'source'],
    ['item', 'source'],
    ['end', 'target'],
  ]);
  expect(container.textContent).toContain('Start');
  expect(container.textContent).not.toContain('Item result');
  expect(container.textContent).toContain('Out');
  await act(async () =>
    root.render(
      h(FlowNode, {
        data: {
          node: nodeSchema.parse({
            id: 'map',
            label: 'Old research',
            kind: 'map',
            workflowId: 'child',
            version: 1,
          }),
        },
      } as any),
    ),
  );
  expect(container.textContent).toContain('MAP (LEGACY)');
  expect(container.querySelectorAll('[data-handle]')).toHaveLength(2);
});
it('creates a List from the ordinary add dialog without a nested definition or workflow reference', async () => {
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Test',
          description: '',
          definition: blankDefinition(),
          workflows: [],
          creating: true,
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  const select = container.querySelector('select')!;
  expect(Array.from(select.options).map((o) => o.value)).toEqual([
    '',
    'agent',
    'script',
    'fetch',
    'condition',
    'workflow',
    'list',
  ]);
  await act(async () => {
    select.value = 'list';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Items path');
  expect(container.textContent).not.toContain('Child workflow');
  const add = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Add node',
  )!;
  await act(async () => add.click());
  const node = onApply.mock.calls[0][0].definition.nodes.at(-1);
  expect(node).toMatchObject({
    kind: 'list',
    itemsPath: '',
    concurrency: 5,
    failurePolicy: 'all',
  });
  expect(Object.keys(node).sort()).toEqual(
    [
      'id',
      'kind',
      'label',
      'position',
      'listId',
      'inputSchema',
      'outputSchema',
      'itemsPath',
      'concurrency',
      'failurePolicy',
    ].sort(),
  );
});

it('adds an Agent directly inside a List and connects its first item route', async () => {
  const onApply = vi.fn();
  const definition = blankDefinition();
  definition.nodes.push(
    nodeSchema.parse({ id: 'list', kind: 'list', label: 'List' }),
  );
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Test',
          description: '',
          definition,
          workflows: [],
          creating: true,
          parentListId: 'list',
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  const select = container.querySelector('select')!;
  await act(async () => {
    select.value = 'agent';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const add = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Add node',
  )!;
  await act(async () => add.click());
  const updated = onApply.mock.calls[0][0].definition;
  const member = updated.nodes.at(-1);
  expect(member).toMatchObject({
    kind: 'agent',
    listId: 'list',
    position: { x: 130, y: 160 },
  });
  expect(updated.edges.at(-1)).toMatchObject({
    source: 'list',
    port: 'item',
    target: member.id,
  });
  await act(async () =>
    root.render(h(FlowNode, { data: { node: member } } as any)),
  );
  expect(container.textContent).not.toContain('Item output');
  expect(container.textContent).toContain('Out');
});

it.each(['entry', 'exit'] as const)(
  'shares the %s contract with workflow settings without rewriting legacy constraints',
  async (kind) => {
    const definition = blankDefinition(),
      onApply = vi.fn();
    const shared = { type: 'array', items: { type: 'string' } };
    definition[kind === 'entry' ? 'inputSchema' : 'outputSchema'] = shared;
    const node = definition.nodes.find((n) => n.kind === kind)!;
    node.inputSchema = { minItems: 1 };
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
    expect(
      container.querySelector('[data-contract="Input / Output"]')!.textContent,
    ).toContain(JSON.stringify(shared));
    expect(
      container.querySelector(
        '[data-contract="Additional node input constraint"]',
      ),
    ).not.toBeNull();
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'Change Input / Output')!
        .click(),
    );
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'Apply changes')!
        .click(),
    );
    const result = onApply.mock.calls[0][0].definition;
    expect(result[kind === 'entry' ? 'inputSchema' : 'outputSchema']).toEqual({
      type: 'array',
      items: { type: 'number' },
    });
    expect(result.nodes.find((n: any) => n.kind === kind).inputSchema).toEqual({
      minItems: 1,
    });
  },
);
it('shows intrinsic List array contracts and explains selection by Items path', async () => {
  const definition = blankDefinition(),
    node = nodeSchema.parse({ id: 'list', label: 'List', kind: 'list' });
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
          onApply: vi.fn(),
        }),
      ),
    ),
  );
  expect(
    container.querySelector('[data-contract="Input"]')!.textContent,
  ).toContain('{"type":"array"}');
  expect(
    container.querySelector('[data-contract="Output"]')!.textContent,
  ).toContain('{"type":"array"}');
  expect(container.textContent).toContain('Input must be an array');
});
