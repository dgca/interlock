// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition, type Workflow } from '@interlock/core';
import { listDefinition, nestedLists } from './fixtures/list';
import { WorkflowEditor } from '../packages/ui/src/features/workflows/WorkflowEditor';

const canvas = vi.hoisted(() => ({ props: undefined as any }));
const rawEditor = vi.hoisted(() => ({ props: undefined as any }));
const rpc = vi.hoisted(() => ({ update: vi.fn(), publish: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      update: { mutate: rpc.update },
      publish: { mutate: rpc.publish },
    },
  },
}));
vi.mock(
  '../packages/ui/node_modules/@xyflow/react',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    ReactFlow: (props: any) => {
      canvas.props = props;
      const { children, nodes, onNodesChange } = props;
      return h(
        'div',
        {},
        children,
        ...nodes.map((n: any) =>
          h(
            'div',
            { key: n.id, 'data-node': n.id },
            h('span', {}, n.data.node.label),
            h(
              'button',
              {
                onClick: () =>
                  onNodesChange([
                    {
                      id: n.id,
                      type: 'position',
                      position: { x: 200, y: 250 },
                    },
                  ]),
              },
              `Move ${n.id}`,
            ),
          ),
        ),
      );
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  }),
);
vi.mock('../packages/ui/src/features/workflows/FlowNode', () => ({
  FlowNode: () => null,
}));
vi.mock('../packages/ui/src/features/workflows/SettingsDialog', () => ({
  SettingsDialog: ({ onApply, definition, name, description }: any) =>
    h(
      'button',
      {
        onClick: () =>
          onApply({
            name,
            description,
            definition: { ...definition, maxSteps: 60 },
          }),
      },
      'Apply local edit',
    ),
}));
vi.mock('../packages/ui/src/components/Button/Button', () => ({
  Button: ({ variant, ...props }: any) => h('button', props),
}));
vi.mock('../packages/ui/src/components/CodeEditor/CodeEditor', () => ({
  CodeEditor: (props: any) => {
    rawEditor.props = props;
    return h('pre', { 'data-raw': true }, props.value);
  },
}));
let root: Root;
let container: HTMLDivElement;
let workflow: Workflow;
const saved = vi.fn();
const onDirty = vi.fn();
const errors: unknown[] = [];
const runAction = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    errors.push(error);
  }
};
const render = async () => {
  await act(async () =>
    root.render(
      h(WorkflowEditor, {
        workflow,
        workflows: [workflow],
        onBack: vi.fn(),
        onRun: vi.fn(),
        onSaved: saved,
        onDirty,
        act: runAction,
      }),
    ),
  );
};
const button = (name: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === name,
  )!;
const click = async (name: string) => {
  await act(async () => button(name).click());
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  errors.length = 0;
  workflow = {
    id: 'test',
    name: 'Original',
    description: '',
    draft: blankDefinition(),
    draftRevision: 1,
    latestVersion: 1,
    archived: false,
    createdAt: '',
    updatedAt: '',
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  rpc.update.mockImplementation(async (input) => {
    if (input.draftRevision !== workflow.draftRevision)
      throw new Error('Draft changed elsewhere');
    return { ...workflow, ...input, draftRevision: workflow.draftRevision + 1 };
  });
  rpc.publish.mockImplementation(async () => ({
    ...workflow,
    latestVersion: workflow.latestVersion + 1,
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('refreshes a clean open editor after an external edit and publishes without a stale save', async () => {
  await render();
  await click('Raw');
  workflow = {
    ...workflow,
    name: 'Updated externally',
    draftRevision: 2,
    draft: { ...workflow.draft, maxSteps: 75 },
  };
  await render();
  expect(container.textContent).toContain('Updated externally');
  expect(container.querySelector('[data-raw]')?.textContent).toContain('75');
  await click('Publish version');
  expect(errors).toEqual([]);
  expect(rpc.update).not.toHaveBeenCalled();
  expect(rpc.publish).toHaveBeenCalledTimes(1);
});

it('blocks duplicate publish requests while the first is pending', async () => {
  let finish!: (value: Workflow) => void;
  rpc.publish.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () => {
    button('Publish version').click();
    button('Publish version').click();
  });
  expect(rpc.publish).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...workflow, latestVersion: 2 }));
});

it('preserves dirty edits after an external update and offers explicit recovery', async () => {
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  await click('Raw');
  workflow = {
    ...workflow,
    draftRevision: 2,
    draft: { ...workflow.draft, maxSteps: 75 },
  };
  await render();
  expect(container.querySelector('[data-raw]')?.textContent).toContain('60');
  expect(container.textContent).toContain('changed elsewhere');
  expect(button('Save draft').disabled).toBe(true);
  expect(button('Publish version').disabled).toBe(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('Load latest draft');
  expect(container.querySelector('[data-raw]')?.textContent).toContain('60');
  confirm.mockReturnValue(true);
  await click('Load latest draft');
  expect(container.querySelector('[data-raw]')?.textContent).toContain('75');
  expect(button('Publish version').disabled).toBe(false);
  confirm.mockRestore();
});

it('saves local changes before publishing and restores actions after a failure', async () => {
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  rpc.update.mockRejectedValueOnce(new Error('Offline'));
  await click('Publish version');
  expect(rpc.publish).not.toHaveBeenCalled();
  expect(button('Publish version').disabled).toBe(false);
  await click('Publish version');
  expect(rpc.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      draftRevision: 1,
      draft: expect.objectContaining({ maxSteps: 60 }),
    }),
  );
  expect(rpc.publish).toHaveBeenCalledTimes(1);
});

it('keeps nested List item nodes on the main canvas and preserves positions independently', async () => {
  workflow.draft = nestedLists(2);
  await render();
  expect(canvas.props.nodes.map((n: any) => n.id)).toEqual([
    'entry',
    'list',
    'list1',
    'work',
    'exit',
  ]);
  expect(container.textContent).not.toContain('Open inline');
  expect(container.textContent).not.toContain('Back to parent');
  await click('Move list');
  await click('Save draft');
  const draft = rpc.update.mock.calls[0][0].draft;
  expect(draft.nodes.find((n: any) => n.id === 'list').position).toEqual({
    x: 200,
    y: 250,
  });
  expect(draft.nodes.find((n: any) => n.id === 'work').position).toEqual(
    workflow.draft.nodes.find((n) => n.id === 'work')!.position,
  );
  expect(draft.edges).toEqual(workflow.draft.edges);
});

it('stores source and target handles through connect, move, edge updates, and raw round-trip', async () => {
  workflow.draft = listDefinition();
  workflow.draft.edges = workflow.draft.edges.filter((e) => e.id !== 'end');
  await render();
  expect(container.textContent).toContain('Before publishing:');
  await act(async () =>
    canvas.props.onConnect({
      source: 'work',
      sourceHandle: 'default',
      target: 'list',
      targetHandle: 'end',
    }),
  );
  expect(container.textContent).not.toContain('Before publishing:');
  expect(
    canvas.props.edges.find((e: any) => e.targetHandle === 'end'),
  ).toMatchObject({ sourceHandle: 'default', targetHandle: 'end' });
  await act(async () =>
    canvas.props.onEdgesChange([
      { type: 'select', id: 'item', selected: true },
    ]),
  );
  await click('Move work');
  await click('Raw');
  const draft = JSON.parse(container.querySelector('[data-raw]')!.textContent!);
  expect(draft.edges.find((e: any) => e.targetHandle === 'end')).toMatchObject({
    port: 'default',
    targetHandle: 'end',
  });
  await click('Visual');
  await click('Save draft');
  expect(rpc.update.mock.calls[0][0].draft).toEqual(draft);
});

it('reports invalid List scope routes in Visual and Raw and blocks publication', async () => {
  workflow.draft = listDefinition();
  await render();
  expect(
    canvas.props.isValidConnection({
      source: 'work',
      target: 'exit',
      targetHandle: 'result',
    }),
  ).toBe(false);
  await act(async () =>
    canvas.props.onConnect({
      source: 'work',
      sourceHandle: 'default',
      target: 'exit',
      targetHandle: 'default',
    }),
  );
  expect(container.textContent).toContain('cannot cross List groups');
  expect(button('Publish version').disabled).toBe(true);
  await click('Raw');
  expect(container.textContent).toContain('Draft can be saved');
  expect(button('Publish version').disabled).toBe(true);
  const invalid = JSON.parse(rawEditor.props.value);
  invalid.edges[0].targetHandle = 'typo';
  await act(async () => rawEditor.props.onChange(JSON.stringify(invalid)));
  expect(button('Visual').disabled).toBe(true);
  expect(button('Save draft').disabled).toBe(true);
});

it('selects and deletes an End connection without persisting selection state', async () => {
  workflow.draft = listDefinition();
  await render();
  await act(async () =>
    canvas.props.onEdgesChange([{ type: 'select', id: 'end', selected: true }]),
  );
  expect(canvas.props.edges.find((e: any) => e.id === 'end').selected).toBe(
    true,
  );
  expect(button('Save draft').disabled).toBe(true);
  await act(async () =>
    canvas.props.onEdgesChange([{ type: 'remove', id: 'end' }]),
  );
  expect(button('Publish version').disabled).toBe(true);
  await click('Save draft');
  expect(
    rpc.update.mock.calls[0][0].draft.edges.some((e: any) => e.id === 'end'),
  ).toBe(false);
});
