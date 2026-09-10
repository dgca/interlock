// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { blankDefinition, type Workflow } from '@interlock/core';
import { batchDefinition, nestedBatches } from './fixtures/batch';
import { WorkflowEditor } from '../packages/ui/src/features/workflows/WorkflowEditor';

const canvas = vi.hoisted(() => ({ props: undefined as any }));
const rawEditor = vi.hoisted(() => ({ props: undefined as any }));
const rpc = vi.hoisted(() => ({
  update: vi.fn(),
  publish: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  errorMessage: (error: Error) => error.message,
  api: {
    workflows: {
      update: { mutate: rpc.update },
      publish: { mutate: rpc.publish },
      delete: { mutate: rpc.remove },
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
    Controls: ({ children }: any) => children,
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
let section: 'editor' | 'runs';
const deleted = vi.fn();
const render = async () => {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        { env: 'test' },
        h(WorkflowEditor, {
          workflow,
          section,
          onDeleted: deleted,
          runsView: h('p', {}, 'Workflow runs'),
          workflows: [workflow],
          onBack: vi.fn(),
          onRun: vi.fn(),
          onSaved: saved,
          onDirty,
          act: runAction,
        }),
      ),
    ),
  );
};
const button = (name: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
  )!;
const click = async (name: string) => {
  if (name === 'Workflow settings' || name === 'Delete workflow')
    await act(async () => button('Workflow actions').click());
  expect(button(name), name).toBeTruthy();
  await act(async () => button(name).click());
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  section = 'editor';
  rawEditor.props = undefined;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
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

it('keeps multiple nodes selected through a move without saving selection as draft data', async () => {
  await render();
  const ids = canvas.props.nodes.map((node: any) => node.id);
  await act(async () => {
    canvas.props.onNodesChange(
      ids.map((id: string) => ({ id, type: 'select', selected: true })),
    );
  });
  expect(
    canvas.props.nodes
      .filter((node: any) => node.selected)
      .map((node: any) => node.id),
  ).toEqual(ids);
  expect(button('Save draft').disabled).toBe(true);
  await click(`Move ${ids[0]}`);
  expect(
    canvas.props.nodes
      .filter((node: any) => node.selected)
      .map((node: any) => node.id),
  ).toEqual(ids);
  await click('Save draft');
  expect(
    rpc.update.mock.calls[0][0].draft.nodes.every(
      (node: any) => !('selected' in node),
    ),
  ).toBe(true);
  await act(async () => canvas.props.onPaneClick());
  expect(canvas.props.nodes.some((node: any) => node.selected)).toBe(false);
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
  expect(button('Save').disabled).toBe(true);
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

it('keeps nested Batch item nodes on the main canvas and preserves positions independently', async () => {
  workflow.draft = nestedBatches(2);
  await render();
  expect(canvas.props.nodes.map((n: any) => n.id)).toEqual([
    'entry',
    'batch',
    'batch1',
    'work',
    'exit',
  ]);
  expect(container.textContent).not.toContain('Open inline');
  expect(container.textContent).not.toContain('Back to parent');
  await click('Move batch');
  await click('Save draft');
  const draft = rpc.update.mock.calls[0][0].draft;
  expect(draft.nodes.find((n: any) => n.id === 'batch').position).toEqual({
    x: 200,
    y: 250,
  });
  expect(draft.nodes.find((n: any) => n.id === 'work').position).toEqual(
    workflow.draft.nodes.find((n) => n.id === 'work')!.position,
  );
  expect(draft.edges).toEqual(workflow.draft.edges);
});

it('stores source and target handles through connect, move, edge updates, and raw round-trip', async () => {
  workflow.draft = batchDefinition();
  workflow.draft.edges = workflow.draft.edges.filter((e) => e.id !== 'end');
  await render();
  expect(container.textContent).toContain('Before publishing:');
  await act(async () =>
    canvas.props.onConnect({
      source: 'work',
      sourceHandle: 'default',
      target: 'batch',
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

it('reports invalid Batch scope routes in Visual and Raw and blocks publication', async () => {
  workflow.draft = batchDefinition();
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
  expect(container.textContent).toContain('cannot cross Batch groups');
  expect(button('Publish version').disabled).toBe(true);
  await click('Raw');
  expect(container.textContent).toContain('Draft can be saved');
  expect(button('Publish version').disabled).toBe(true);
  const invalid = JSON.parse(rawEditor.props.value);
  invalid.edges[0].targetHandle = 'typo';
  await act(async () => rawEditor.props.onChange(JSON.stringify(invalid)));
  expect(button('Visual').disabled).toBe(true);
  expect(button('Save').disabled).toBe(true);
});

it('selects and deletes an End connection without persisting selection state', async () => {
  workflow.draft = batchDefinition();
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

const positions = () =>
  canvas.props.nodes.map((n: any) => ({ id: n.id, position: n.position }));
const shortcut = async (
  target: HTMLElement,
  shiftKey = false,
  metaKey = false,
) => {
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: !metaKey,
    metaKey,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
};

it('undoes a complete group drag in one step and redoes it', async () => {
  await render();
  const original = positions();
  await act(async () => canvas.props.onSelectionDragStart());
  for (const offset of [10, 20, 30]) {
    await act(async () =>
      canvas.props.onNodesChange(
        original.map((n: any) => ({
          type: 'position',
          id: n.id,
          position: { x: n.position.x + offset, y: n.position.y + offset },
          dragging: true,
        })),
      ),
    );
  }
  expect(button('Undo').disabled).toBe(true);
  await act(async () => {
    canvas.props.onNodesChange(
      original.map((n: any) => ({
        type: 'position',
        id: n.id,
        dragging: false,
      })),
    );
    canvas.props.onSelectionDragStop();
  });
  const moved = positions();
  await click('Undo');
  expect(positions()).toEqual(original);
  expect(button('Undo').disabled).toBe(true);
  expect(button('Save draft').disabled).toBe(true);
  await click('Redo');
  expect(positions()).toEqual(moved);
  expect(button('Save draft').disabled).toBe(false);
});

it('restores a deleted Batch, descendants, and all connections as one action', async () => {
  workflow.draft = nestedBatches(2);
  await render();
  const original = canvas.props.nodes.map((n: any) => n.data.node);
  const originalEdges = canvas.props.edges;
  await act(async () => {
    expect(
      await canvas.props.onBeforeDelete({
        nodes: canvas.props.nodes.filter((n: any) => n.id === 'batch'),
        edges: canvas.props.edges.filter(
          (e: any) => e.source === 'batch' || e.target === 'batch',
        ),
      }),
    ).toBe(false);
  });
  expect(canvas.props.nodes.map((n: any) => n.id)).toEqual(['entry', 'exit']);
  await click('Undo');
  expect(canvas.props.nodes.map((n: any) => n.data.node)).toEqual(original);
  expect(canvas.props.edges).toEqual(originalEdges);
  expect(button('Undo').disabled).toBe(true);
  await click('Redo');
  expect(canvas.props.nodes.map((n: any) => n.id)).toEqual(['entry', 'exit']);
});

it('keeps history through saving and publishing without undoing the saved revision or publication', async () => {
  await render();
  const original = positions();
  await click(`Move ${original[0].id}`);
  await click('Publish version');
  workflow = { ...(await rpc.update.mock.results[0].value), latestVersion: 2 };
  await render();
  expect(button('Save draft').disabled).toBe(true);
  await click('Undo');
  expect(positions()).toEqual(original);
  expect(button('Save draft').disabled).toBe(false);
  expect(button('Run v2')).toBeDefined();
  expect(rpc.publish).toHaveBeenCalledTimes(1);
  await click('Save draft');
  expect(rpc.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ draftRevision: 2 }),
  );
  await click('Redo');
  expect(positions()).not.toEqual(original);
});

it('saves raw edits as one history action and requires an explicit save before Visual', async () => {
  await render();
  await click('Raw');
  const original = JSON.parse(rawEditor.props.value);
  await act(async () => rawEditor.props.onChange('{'));
  expect(button('Undo').disabled).toBe(true);
  await act(async () =>
    rawEditor.props.onChange(JSON.stringify({ ...original, maxSteps: 61 })),
  );
  await act(async () =>
    rawEditor.props.onChange(JSON.stringify({ ...original, maxSteps: 62 })),
  );
  expect(button('Undo').disabled).toBe(true);
  expect(button('Visual').disabled).toBe(true);
  await click('Save');
  await click('Visual');
  await click('Undo');
  expect(button('Save draft').disabled).toBe(false);
  await click('Raw');
  expect(JSON.parse(rawEditor.props.value)).toEqual(original);
  await click('Redo');
  expect(JSON.parse(rawEditor.props.value).maxSteps).toBe(62);
  await click('Save');
  expect(button('Undo').disabled).toBe(false);
  await click('Undo');
  expect(JSON.parse(rawEditor.props.value)).toEqual(original);
});

it('records saving raw changes once, even after a failed save and retry', async () => {
  await render();
  await click('Raw');
  const original = JSON.parse(rawEditor.props.value);
  await act(async () =>
    rawEditor.props.onChange(JSON.stringify({ ...original, maxSteps: 62 })),
  );
  rpc.update.mockRejectedValueOnce(new Error('Offline'));
  await click('Save');
  expect(button('Undo').disabled).toBe(true);
  expect(button('Visual').disabled).toBe(true);
  await click('Save');
  await click('Visual');
  await click('Undo');
  expect(button('Undo').disabled).toBe(true);
  await click('Raw');
  expect(JSON.parse(rawEditor.props.value)).toEqual(original);
});

it('clears redo after a new edit and skips selection, collapse, and no-op changes', async () => {
  workflow.draft = batchDefinition();
  await render();
  await act(async () => {
    canvas.props.onNodesChange([
      { type: 'select', id: 'work', selected: true },
    ]);
    canvas.props.nodes.find((n: any) => n.id === 'batch').data.onToggle();
    canvas.props.onNodeDragStart();
    canvas.props.onNodeDragStop();
  });
  expect(button('Undo').disabled).toBe(true);
  await click('Move batch');
  await click('Move batch');
  await click('Undo');
  expect(button('Undo').disabled).toBe(true);
  expect(button('Redo').disabled).toBe(false);
  await click('Workflow settings');
  expect(button('Undo').disabled).toBe(true);
  await click('Apply local edit');
  expect(button('Redo').disabled).toBe(true);
  await click('Undo');
  expect(button('Save draft').disabled).toBe(true);
});

it('caps history at 50 actions and clears it when loading another draft or reopening', async () => {
  await render();
  const id = canvas.props.nodes[0].id;
  for (let x = 1; x <= 55; x++) {
    await act(async () =>
      canvas.props.onNodesChange([
        { type: 'position', id, position: { x, y: 0 } },
      ]),
    );
  }
  for (let i = 0; i < 50; i++) await click('Undo');
  expect(canvas.props.nodes[0].position).toEqual({ x: 5, y: 0 });
  expect(button('Undo').disabled).toBe(true);
  workflow = { ...workflow, draftRevision: 2 };
  await render();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await click('Load latest draft');
  confirm.mockRestore();
  expect(button('Undo').disabled).toBe(true);
  expect(button('Redo').disabled).toBe(true);
  await click(`Move ${id}`);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(button('Undo').disabled).toBe(true);
  expect(button('Redo').disabled).toBe(true);
});

it('handles Ctrl/Command+Z and Shift+Z without capturing text editing or modal shortcuts', async () => {
  await render();
  const original = positions();
  await click(`Move ${original[0].id}`);
  const target = button('Save draft');
  expect((await shortcut(target)).defaultPrevented).toBe(true);
  expect(positions()).toEqual(original);
  await shortcut(target, true, true);
  expect(positions()).not.toEqual(original);
  const input = document.createElement('textarea');
  target.parentElement!.append(input);
  expect((await shortcut(input)).defaultPrevented).toBe(false);
  expect(positions()).not.toEqual(original);
  input.remove();
  await click('Workflow settings');
  expect((await shortcut(button('Apply local edit'))).defaultPrevented).toBe(
    false,
  );
});

it('tidies the whole workflow as one undoable action without rewriting graph semantics', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  try {
    workflow.draft = nestedBatches(2);
    await render();
    const original = positions();
    await click('Tidy');
    const arranged = positions();
    expect(arranged).not.toEqual(original);
    expect(button('Save draft').disabled).toBe(false);
    await click('Tidy');
    await click('Undo');
    expect(positions()).toEqual(original);
    expect(button('Undo').disabled).toBe(true);
    await click('Redo');
    expect(positions()).toEqual(arranged);
    await click('Save draft');
    const savedDraft = rpc.update.mock.calls[0][0].draft;
    expect(savedDraft.edges).toEqual(workflow.draft.edges);
    expect(savedDraft.nodes.map(({ position, ...node }: any) => node)).toEqual(
      workflow.draft.nodes.map(({ position, ...node }) => node),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it('discards invalid raw edits while retaining earlier unsaved visual changes', async () => {
  await render();
  const id = canvas.props.nodes[0].id;
  await click(`Move ${id}`);
  await click('Raw');
  const baseline = rawEditor.props.value;
  await act(async () => rawEditor.props.onChange('{'));
  expect(button('Visual').disabled).toBe(true);
  expect(button('Save').disabled).toBe(true);
  await click('Discard');
  expect(rawEditor.props.value).toBe(baseline);
  expect(rpc.update).not.toHaveBeenCalled();
  await click('Visual');
  expect(button('Save draft').disabled).toBe(false);
  expect(canvas.props.nodes[0].position).toEqual({ x: 200, y: 250 });
});

it('keeps raw text and dirty protection across Runs and disables hidden editor shortcuts', async () => {
  await render();
  await click(`Move ${canvas.props.nodes[0].id}`);
  await click('Raw');
  await act(async () => rawEditor.props.onChange('{'));
  section = 'runs';
  await render();
  expect(container.textContent).toContain('Workflow runs');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  expect((await shortcut(document.body)).defaultPrevented).toBe(false);
  section = 'editor';
  await render();
  expect(rawEditor.props.value).toBe('{');
  await click('Discard');
  await click('Visual');
  expect(button('Undo').disabled).toBe(false);
});

it('preserves text typed during a save and discards back to the successfully saved definition', async () => {
  await render();
  await click('Raw');
  const baseline = JSON.parse(rawEditor.props.value);
  let finish!: (workflow: Workflow) => void;
  rpc.update.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    rawEditor.props.onChange(JSON.stringify({ ...baseline, maxSteps: 61 })),
  );
  await click('Save');
  await act(async () =>
    rawEditor.props.onChange(JSON.stringify({ ...baseline, maxSteps: 62 })),
  );
  await act(async () =>
    finish({
      ...workflow,
      draft: { ...baseline, maxSteps: 61 },
      draftRevision: 2,
    }),
  );
  expect(JSON.parse(rawEditor.props.value).maxSteps).toBe(62);
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await click('Discard');
  expect(JSON.parse(rawEditor.props.value).maxSteps).toBe(61);
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

it('requires confirmation for workflow deletion from the editor menu', async () => {
  await render();
  await click('Delete workflow');
  expect(document.body.textContent).toContain('This cannot be undone.');
  expect(rpc.remove).not.toHaveBeenCalled();
  await click('Cancel');
  expect(deleted).not.toHaveBeenCalled();
  await click('Delete workflow');
  await click('Delete');
  expect(rpc.remove).toHaveBeenCalledWith({ id: workflow.id });
  expect(deleted).toHaveBeenCalledOnce();
});
