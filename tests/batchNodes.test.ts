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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('renders four labeled Batch handles with internal Start and End', async () => {
  await act(async () =>
    root.render(
      h(FlowNode, {
        data: {
          node: nodeSchema.parse({
            id: 'batch',
            label: 'Batch',
            kind: 'batch',
          }),
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
});
it('creates a Batch from the ordinary add dialog without a nested definition or workflow reference', async () => {
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
    'agent',
    'script',
    'fetch',
    'condition',
    'workflow',
    'batch',
  ]);
  await act(async () => {
    select.value = 'batch';
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
    kind: 'batch',
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
      'batchId',
      'inputSchema',
      'outputSchema',
      'itemsPath',
      'concurrency',
      'failurePolicy',
    ].sort(),
  );
});

it('adds an Agent directly inside a Batch and connects its first item route', async () => {
  const onApply = vi.fn();
  const definition = blankDefinition();
  definition.nodes.push(
    nodeSchema.parse({ id: 'batch', kind: 'batch', label: 'Batch' }),
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
          parentBatchId: 'batch',
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
    batchId: 'batch',
    position: { x: 130, y: 160 },
  });
  expect(updated.edges.at(-1)).toMatchObject({
    source: 'batch',
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
it('shows intrinsic Batch array contracts and explains selection by Items path', async () => {
  const definition = blankDefinition(),
    node = nodeSchema.parse({ id: 'batch', label: 'Batch', kind: 'batch' });
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

it.each([
  'entry',
  'exit',
  'agent',
  'script',
  'fetch',
  'condition',
  'workflow',
  'batch',
])('keeps the contract summary last in %s metadata', async (kind) => {
  const node = nodeSchema.parse({
    id: 'node',
    label: 'Example',
    kind,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'string' },
    prompt: 'Write a greeting',
    command: 'return "hello";',
    url: 'https://example.com',
    path: 'ready',
    equals: true,
    workflowId: 'child',
    version: 1,
  });
  await act(async () => root.render(h(FlowNode, { data: { node } } as any)));
  const lines = Array.from(container.querySelectorAll('small'));
  expect(lines.at(-1)?.textContent).toBe('Object → Text');
  if (kind === 'fetch') expect(lines[0].textContent).toBe('Method: GET');
});

it.each([undefined, 'parent'])(
  'places a new Script clear of an existing Batch in scope %s',
  async (parentBatchId) => {
    let definition = blankDefinition();
    if (parentBatchId)
      definition.nodes.push(
        nodeSchema.parse({ id: parentBatchId, kind: 'batch', label: 'Parent' }),
      );
    const add = async (kind: string) => {
      const onApply = vi.fn();
      await act(async () =>
        root.render(
          h(
            MantineProvider,
            {},
            h(SettingsDialog, {
              key: kind,
              name: 'Test',
              description: '',
              definition,
              workflows: [],
              creating: true,
              parentBatchId,
              onClose: vi.fn(),
              onApply,
            }),
          ),
        ),
      );
      await act(async () => {
        const select = container.querySelector('select')!;
        select.value = kind;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () =>
        Array.from(container.querySelectorAll('button'))
          .find((b) => b.textContent === 'Add node')!
          .click(),
      );
      definition = onApply.mock.calls[0][0].definition;
      return definition.nodes.at(-1)!;
    };
    const batch = await add('batch');
    const script = await add('script');
    const { canvasGraph } =
      await import('../packages/ui/src/features/workflows/canvasGraph');
    const rendered = canvasGraph(definition).nodes.find(
      (n) => n.id === batch.id,
    )!;
    const overlapX =
      Math.min(batch.position.x + rendered.width!, script.position.x + 220) -
      Math.max(batch.position.x, script.position.x);
    const overlapY =
      Math.min(batch.position.y + rendered.height!, script.position.y + 116) -
      Math.max(batch.position.y, script.position.y);
    expect(
      overlapX <= 0 || overlapY <= 0,
      `Batch and Script overlap by ${overlapX} × ${overlapY}`,
    ).toBe(true);
  },
);
it('creates a named unpublished child from Add node and keeps the dialog after a failed save', async () => {
  const onCreateChild = vi
    .fn()
    .mockRejectedValue(new Error('Draft changed elsewhere'));
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Parent',
          description: 'Unsaved',
          definition: blankDefinition(),
          workflows: [],
          creating: true,
          onClose: vi.fn(),
          onApply,
          onCreateChild,
        }),
      ),
    ),
  );
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = 'workflow';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(
    container.querySelector<HTMLInputElement>('input[value="existing"]')!
      .checked,
  ).toBe(true);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="child"]')!.click(),
  );
  expect(container.textContent).not.toContain('Pinned version');
  const label = Array.from(container.querySelectorAll('label')).find((el) =>
    el.textContent?.startsWith('Child workflow name'),
  )!;
  const input = document.getElementById(label.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Gather evidence');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Save and create child')!
      .click(),
  );
  expect(onCreateChild).toHaveBeenCalledTimes(1);
  const [name, settings, nodeId] = onCreateChild.mock.calls[0];
  expect(name).toBe('Gather evidence');
  expect(settings.description).toBe('Unsaved');
  expect(
    settings.definition.nodes.find((n: any) => n.id === nodeId),
  ).toMatchObject({
    kind: 'workflow',
    label: 'Gather evidence',
    version: null,
  });
  expect(onApply).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Draft changed elsewhere');
});
it('offers only library workflows and the current parents children as targets', async () => {
  const workflows = [
    { id: 'library', name: 'Library', latestVersion: 1 },
    {
      id: 'owned',
      name: 'My child',
      ownerWorkflowId: 'parent',
      latestVersion: 0,
    },
    {
      id: 'other',
      name: 'Other child',
      ownerWorkflowId: 'other-parent',
      latestVersion: 1,
    },
  ] as any;
  const node = nodeSchema.parse({
    id: 'ref',
    kind: 'workflow',
    label: 'Ref',
    workflowId: 'owned',
    version: null,
  });
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Parent',
          description: '',
          definition: blankDefinition(),
          workflows,
          workflowId: 'parent',
          node,
          onClose: vi.fn(),
          onApply: vi.fn(),
        }),
      ),
    ),
  );
  const options = Array.from(container.querySelectorAll('option')).map(
    (o) => o.textContent,
  );
  expect(options).toContain('My child · Not published');
  expect(options).toContain('Library');
  expect(options).not.toContain('Other child');
});
