// @vitest-environment jsdom
import { act, createElement as h, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import {
  blankDefinition,
  definitionSchema,
  applyWorkflowPositions,
  workflowPositions,
  type WorkflowPositions,
  type Workflow,
} from '@interlock/core';
import { batchDefinition, nestedBatches } from './fixtures/batch';
import parallelEdges from './fixtures/parallelEdges.json';
import { WorkflowEditor } from '../packages/ui/src/features/workflows/WorkflowEditor';
import { WorkflowLayoutNotice } from '../packages/ui/src/features/workflows/WorkflowLayoutNotice';

const canvas = vi.hoisted(() => ({ props: undefined as any }));
const rawEditor = vi.hoisted(() => ({ props: undefined as any }));
const rpc = vi.hoisted(() => ({
  update: vi.fn(),
  saveLayout: vi.fn(),
  get: vi.fn(),
  publish: vi.fn(),
  versions: vi.fn(),
  remove: vi.fn(),
  createChild: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  errorMessage: (error: Error) => error.message,
  api: {
    workflows: {
      update: { mutate: rpc.update },
      saveLayout: { mutate: rpc.saveLayout },
      get: { query: rpc.get },
      createChild: { mutate: rpc.createChild },
      publish: { mutate: rpc.publish },
      versions: { query: rpc.versions },
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
const elk = vi.hoisted(() => ({ tidy: vi.fn() }));
vi.mock('../packages/ui/src/features/workflows/workflowLayoutElk', () => ({
  tidyWorkflowElk: elk.tidy,
}));
vi.mock('../packages/ui/src/features/workflows/FlowNode', () => ({
  FlowNode: () => null,
}));
vi.mock('../packages/ui/src/features/workflows/RestoreHandleBounds', () => ({
  RestoreHandleBounds: () => null,
}));
vi.mock('../packages/ui/src/features/workflows/SettingsDialog', () => ({
  SettingsDialog: ({
    onApply,
    onCreateChild,
    definition,
    name,
    description,
  }: any) =>
    h(
      'div',
      {},
      onCreateChild &&
        h(
          'button',
          {
            onClick: async () => {
              try {
                await onCreateChild(
                  'Child',
                  {
                    name,
                    description,
                    definition: {
                      ...definition,
                      nodes: [
                        ...definition.nodes,
                        {
                          ...definition.nodes[1],
                          id: 'child-node',
                          kind: 'workflow',
                          workflowId: 'new-child',
                          version: null,
                        },
                      ],
                    },
                  },
                  'child-node',
                );
              } catch (e) {
                errors.push(e);
              }
            },
          },
          'Create test child',
        ),
      h(
        'button',
        {
          onClick: () =>
            onApply({
              name,
              description,
              definition: { ...definition, agentModel: 'saved-alias-id' },
            }),
        },
        'Apply model alias',
      ),
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
    ),
}));
vi.mock('../packages/ui/src/design-system/Button', () => ({
  Button: ({ variant, leftSection, rightSection, ...props }: any) =>
    h('button', props),
}));
vi.mock('../packages/ui/src/design-system/CodeEditor/CodeEditor', () => ({
  CodeEditor: (props: any) => {
    rawEditor.props = props;
    return h('pre', { 'data-raw': true }, props.value);
  },
}));
let root: Root;
let container: HTMLDivElement;
let workflow: Workflow & { layoutRevision?: number };
let layoutRevision: number;
let layoutPositions: WorkflowPositions;
const saved = vi.fn();
const opened = vi.fn();
const reportOpened = vi.fn();
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
let strict = false;
const render = async (visible = true) => {
  const app = h(
    DesignSystemProvider,
    { env: 'test' },
    visible
      ? h(WorkflowEditor, {
          workflow,
          section,
          onDeleted: deleted,
          runsView: h('p', {}, 'Workflow runs'),
          workflows: [workflow],
          onBack: vi.fn(),
          onOpenWorkflow: opened,
          onReport: reportOpened,
          onRun: vi.fn(),
          onSaved: saved,
          onDirty,
          act: runAction,
        })
      : null,
    h(WorkflowLayoutNotice, {
      currentWorkflowId: visible ? workflow.id : undefined,
      onOpen: opened,
    }),
  );
  await act(async () => root.render(strict ? h(StrictMode, {}, app) : app));
};

const button = (name: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
  )!;
const viewControl = (name: 'Visual' | 'Raw') =>
  document.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${name.toLowerCase()}"]`,
  )!;
const click = async (name: string) => {
  if (name === 'Visual' || name === 'Raw') {
    expect(viewControl(name), name).toBeTruthy();
    await act(async () => viewControl(name).click());
    return;
  }
  if (name === 'Workflow settings' || name === 'Delete workflow')
    await act(async () => button('Workflow actions').click());
  expect(button(name), name).toBeTruthy();
  await act(async () => button(name).click());
};
const chooseTidyMode = async (mode: 'Dagre' | 'ELK') => {
  await click('Tidy mode');
  await click(mode);
};
const tidy = async (mode: 'Dagre' | 'ELK') => {
  await chooseTidyMode(mode);
  await click('Tidy');
};
const reviewPublish = async () => {
  await click('Review & publish');
  await click('Publish version');
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  section = 'editor';
  strict = false;
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
  layoutRevision = 0;
  layoutPositions = workflowPositions(workflow.draft);
  rpc.saveLayout.mockImplementation(
    async (input: {
      id: string;
      expectedRevision: number;
      positions: WorkflowPositions;
    }) => {
      if (input.expectedRevision !== layoutRevision)
        throw new Error('Layout changed elsewhere');
      layoutPositions = Object.fromEntries([
        ...Object.entries(layoutPositions),
        ...Object.entries(input.positions),
      ]);
      return {
        id: workflow.id,
        revision: ++layoutRevision,
        positions: layoutPositions,
      };
    },
  );
  rpc.get.mockImplementation(async () => ({
    ...workflow,
    draft: applyWorkflowPositions(workflow.draft, layoutPositions),
    layoutRevision,
  }));
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
  rpc.versions.mockImplementation(async () =>
    workflow.latestVersion
      ? [
          {
            workflowId: workflow.id,
            version: workflow.latestVersion,
            definition: workflow.draft,
            createdAt: '',
          },
        ]
      : [],
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('moves history into the menu at narrow editor widths and preserves undo, redo, and raw-edit guards', async () => {
  let reportWidth: (width: number) => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: HTMLElement) {
        if (!element.querySelector('header')) return;
        reportWidth = (width) =>
          this.callback(
            [{ contentRect: { width, height: 850 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const resize = async (width: number) => {
    await act(async () => {
      reportWidth(width);
      await new Promise(requestAnimationFrame);
    });
  };
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  await resize(525);
  expect(button('Undo')).toBeUndefined();
  expect(button('Save draft').textContent).toBe('Save');
  await click('Workflow actions');
  expect(button('Undo').getAttribute('role')).toBe('menuitem');
  await click('Undo');
  expect(button('Save draft').disabled).toBe(true);
  await click('Workflow actions');
  await click('Redo');
  expect(button('Save draft').disabled).toBe(false);
  await click('Raw');
  await act(async () => rawEditor.props.onChange('{'));
  await click('Workflow actions');
  expect(button('Undo').disabled).toBe(true);
  expect(button('Redo').disabled).toBe(true);
  await click('Workflow actions');
  await resize(1100);
  expect(button('Undo').getAttribute('role')).not.toBe('menuitem');
  expect(button('Undo').disabled).toBe(true);
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
  expect(button('Save draft').disabled).toBe(true);
  expect(rpc.update).not.toHaveBeenCalled();
  expect(rpc.saveLayout).toHaveBeenCalledWith({
    id: workflow.id,
    expectedRevision: 0,
    positions: { [ids[0]]: { x: 200, y: 250 } },
  });
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
  await reviewPublish();
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
  await click('Review & publish');
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
  expect(button('Review & publish').disabled).toBe(true);
  await click('Load latest draft');
  await click('Keep editing');
  expect(container.querySelector('[data-raw]')?.textContent).toContain('60');
  await click('Load latest draft');
  await click('Discard and load draft');
  expect(container.querySelector('[data-raw]')?.textContent).toContain('75');
  expect(button('Review & publish').disabled).toBe(false);
});

it('saves local changes before publishing and restores actions after a failure', async () => {
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  rpc.update.mockRejectedValueOnce(new Error('Offline'));
  await reviewPublish();
  expect(rpc.publish).not.toHaveBeenCalled();
  expect(button('Review & publish').disabled).toBe(false);
  await click('Publish version');
  expect(rpc.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      draftRevision: 1,
      draft: expect.objectContaining({ maxSteps: 60 }),
    }),
  );
  expect(rpc.publish).toHaveBeenCalledTimes(1);
});

it('reviews a first publication without saving until confirmation', async () => {
  workflow.latestVersion = 0;
  await render();
  await click('Review & publish');
  expect(document.body.textContent).toContain('First publication');
  expect(document.body.textContent).toContain('3 node changes');
  expect(rpc.update).not.toHaveBeenCalled();
  expect(rpc.publish).not.toHaveBeenCalled();
  await click('Cancel');
  expect(rpc.publish).not.toHaveBeenCalled();
  await reviewPublish();
  expect(rpc.publish).toHaveBeenCalledTimes(1);
});

it('reviews valid unsaved Raw edits and shows prompt details before publishing', async () => {
  const published = structuredClone(workflow.draft);
  rpc.versions.mockResolvedValue([
    {
      workflowId: workflow.id,
      version: 1,
      definition: published,
      createdAt: '',
    },
  ]);
  await render();
  await click('Raw');
  const draft = structuredClone(workflow.draft);
  const agent = draft.nodes.find((node) => node.kind === 'agent')!;
  agent.prompt = 'A new prompt with details';
  await act(async () => rawEditor.props.onChange(JSON.stringify(draft)));
  await click('Review & publish');
  expect(document.body.textContent).toContain('1 node change');
  expect(rpc.update).not.toHaveBeenCalled();
  const row = Array.from(document.querySelectorAll('details')).find((item) =>
    item.textContent?.includes('Agent assignment'),
  )!;
  await act(async () => row.querySelector('summary')!.click());
  expect(row.textContent).toContain('A new prompt with details');
  expect(row.textContent).toContain('Process the input');
  await click('Publish version');
  expect(rpc.update).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({ nodes: draft.nodes }),
    }),
  );
  expect(rpc.publish).toHaveBeenCalledTimes(1);
});

it('shows both values when node contract fields are added or removed', async () => {
  const published = structuredClone(workflow.draft);
  const publishedAgent = published.nodes.find((node) => node.kind === 'agent')!;
  publishedAgent.outputSchema = {
    type: 'object',
    properties: { removed: { type: 'string' } },
  };
  const draft = structuredClone(published);
  const draftAgent = draft.nodes.find((node) => node.kind === 'agent')!;
  draftAgent.outputSchema = {
    type: 'object',
    properties: { added: { type: 'number' } },
  };
  workflow.draft = draft;
  rpc.versions.mockResolvedValue([
    {
      workflowId: workflow.id,
      version: 1,
      definition: published,
      createdAt: '',
    },
  ]);

  await render();
  await click('Review & publish');
  const row = Array.from(document.querySelectorAll('details')).find((item) =>
    item.textContent?.includes('Agent assignment'),
  )!;
  await act(async () => row.querySelector('summary')!.click());
  const values = Array.from(row.querySelectorAll('pre')).map(
    (value) => value.textContent,
  );
  expect(values).toHaveLength(4);
  expect(values[0]).toBe('Not set');
  expect(values[1]).toContain('"number"');
  expect(values[2]).toContain('"string"');
  expect(values[3]).toBe('Not set');
});

it('keeps the review open after a publication error', async () => {
  rpc.publish.mockRejectedValueOnce(new Error('Publish failed'));
  await render();
  await reviewPublish();
  expect(errors).toHaveLength(1);
  expect(button('Publish version')).toBeTruthy();
  await click('Publish version');
  expect(rpc.publish).toHaveBeenCalledTimes(2);
});

it('can retry publication after saving local edits', async () => {
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  rpc.publish.mockRejectedValueOnce(new Error('Publish failed'));
  await reviewPublish();
  workflow = await rpc.update.mock.results[0].value;
  await render();
  expect(button('Publish version').disabled).toBe(false);
  await click('Publish version');
  expect(rpc.update).toHaveBeenCalledTimes(1);
  expect(rpc.publish).toHaveBeenCalledTimes(2);
});

it('blocks confirming a review after a newer version appears', async () => {
  await render();
  await click('Review & publish');
  workflow = { ...workflow, latestVersion: 2 };
  await render();
  expect(document.body.textContent).toContain(
    'changed since the review opened',
  );
  expect(button('Publish version').disabled).toBe(true);
  expect(rpc.publish).not.toHaveBeenCalled();
});

it('blocks publication when versions fail to load and offers a retry', async () => {
  rpc.versions.mockRejectedValueOnce(new Error('Offline'));
  await render();
  await click('Review & publish');
  expect(document.body.textContent).toContain(
    'Could not load published versions: Offline',
  );
  expect(button('Publish version').disabled).toBe(true);
  await click('Retry');
  expect(document.body.textContent).toContain('No definition changes');
  expect(button('Publish version').disabled).toBe(false);
});

it('publishes a Raw repair of an invalid visual draft', async () => {
  const complete = structuredClone(workflow.draft);
  workflow.draft.edges = [];
  await render();
  expect(button('Review & publish').disabled).toBe(true);
  await click('Raw');
  await act(async () => rawEditor.props.onChange(JSON.stringify(complete)));
  expect(button('Review & publish').disabled).toBe(false);
  await reviewPublish();
  expect(rpc.update).toHaveBeenCalledWith(
    expect.objectContaining({ draft: complete }),
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
  expect(button('Save draft').disabled).toBe(true);
  expect(rpc.update).not.toHaveBeenCalled();
  const draft = {
    ...workflow.draft,
    nodes: canvas.props.nodes.map((n: any) => n.data.node),
  };
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
  expect(button('Review & publish').disabled).toBe(true);
  await click('Raw');
  expect(container.textContent).toContain('Draft can be saved');
  expect(button('Review & publish').disabled).toBe(true);
  const invalid = JSON.parse(rawEditor.props.value);
  invalid.edges[0].targetHandle = 'typo';
  await act(async () => rawEditor.props.onChange(JSON.stringify(invalid)));
  expect(viewControl('Visual').disabled).toBe(true);
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
  expect(button('Review & publish').disabled).toBe(true);
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
  expect(button('Save draft').disabled).toBe(true);
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(rpc.update).not.toHaveBeenCalled();
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
  await click('Workflow settings');
  await click('Apply local edit');
  const original = positions();
  await click(`Move ${original[0].id}`);
  await reviewPublish();
  workflow = { ...(await rpc.update.mock.results[0].value), latestVersion: 2 };
  await render();
  expect(button('Save draft').disabled).toBe(true);
  await click('Undo');
  expect(positions()).toEqual(original);
  expect(button('Save draft').disabled).toBe(true);
  await click('Undo');
  expect(button('Save draft').disabled).toBe(false);
  expect(button('Run v2')).toBeDefined();
  expect(rpc.publish).toHaveBeenCalledTimes(1);
  await click('Save draft');
  expect(rpc.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ draftRevision: 2 }),
  );
  await click('Redo');
  await click('Redo');
  expect(positions()).not.toEqual(original);
});

it('marks an alias selection saved after API key normalization without losing undo history', async () => {
  rpc.update.mockImplementation(async (input) => ({
    ...workflow,
    ...input,
    draft: definitionSchema.parse(input.draft),
    draftRevision: workflow.draftRevision + 1,
  }));
  await render();
  await click('Workflow settings');
  await click('Apply model alias');
  await click('Save draft');
  expect(rpc.update).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({ agentModel: 'saved-alias-id' }),
    }),
  );
  expect(button('Save draft').disabled).toBe(true);
  expect(onDirty).toHaveBeenLastCalledWith(false);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await click('Undo');
  expect(button('Save draft').disabled).toBe(false);
  await click('Redo');
  expect(button('Save draft').disabled).toBe(true);
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
  expect(viewControl('Visual').disabled).toBe(true);
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
  expect(viewControl('Visual').disabled).toBe(true);
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
  expect(container.textContent).not.toContain('changed elsewhere');
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
  expect((await shortcut(viewControl('Visual'))).defaultPrevented).toBe(true);
  expect(positions()).toEqual(original);
  await shortcut(viewControl('Visual'), true, true);
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

it.each(['nested Batches', 'parallel routes'])(
  'tidies %s as one undoable action without rewriting graph semantics',
  async (fixture) => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    try {
      workflow.draft =
        fixture === 'nested Batches'
          ? nestedBatches(2)
          : definitionSchema.parse(parallelEdges);
      await render();
      const original = positions();
      await tidy('Dagre');
      const arranged = positions();
      expect(arranged).not.toEqual(original);
      expect(button('Save draft').disabled).toBe(true);
      await tidy('Dagre');
      await click('Undo');
      expect(positions()).toEqual(original);
      expect(button('Undo').disabled).toBe(true);
      await click('Redo');
      expect(positions()).toEqual(arranged);
      expect(rpc.update).not.toHaveBeenCalled();
      const savedDraft = {
        ...workflow.draft,
        nodes: canvas.props.nodes.map((n: any) => n.data.node),
      };
      expect(layoutPositions).toEqual(
        expect.objectContaining(
          Object.fromEntries(arranged.map((n: any) => [n.id, n.position])),
        ),
      );
      expect(savedDraft.edges).toEqual(workflow.draft.edges);
      expect(
        Object.fromEntries(
          savedDraft.nodes.map(({ position, ...node }: any) => [node.id, node]),
        ),
      ).toEqual(
        Object.fromEntries(
          workflow.draft.nodes.map(({ position, ...node }) => [node.id, node]),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it('applies the ELK layout as one undoable action and reports failures', async () => {
  workflow.draft = nestedBatches(2);
  await render();
  const original = positions();
  let settle!: (definition: typeof workflow.draft) => void;
  let fail!: (error: Error) => void;
  elk.tidy.mockImplementation(
    (definition) =>
      new Promise((resolve, reject) => {
        settle = () =>
          resolve({
            ...definition,
            nodes: definition.nodes.map((node: any) => ({
              ...node,
              position: { x: node.position.x + 40, y: node.position.y },
            })),
          });
        fail = reject;
      }),
  );
  await tidy('ELK');
  expect(elk.tidy).toHaveBeenCalledWith(workflow.draft);
  expect(button('Tidy').disabled).toBe(true);
  expect(positions()).toEqual(original);
  await act(async () => settle(workflow.draft));
  expect(button('Tidy').disabled).toBe(false);
  const arranged = positions();
  expect(arranged).toEqual(
    original.map((p: any) => ({
      ...p,
      position: { ...p.position, x: p.position.x + 40 },
    })),
  );
  expect(button('Save draft').disabled).toBe(true);
  await click('Undo');
  expect(positions()).toEqual(original);
  expect(button('Undo').disabled).toBe(true);
  await tidy('ELK');
  await act(async () => fail(new Error('ELK failed to load')));
  expect(errors.map((e) => (e as Error).message)).toEqual([
    'ELK failed to load',
  ]);
  expect(button('Tidy').disabled).toBe(false);
  expect(positions()).toEqual(original);
});

it('discards invalid raw edits while retaining the automatically saved visual layout', async () => {
  await render();
  const id = canvas.props.nodes[0].id;
  await click(`Move ${id}`);
  await click('Raw');
  const baseline = rawEditor.props.value;
  await act(async () => rawEditor.props.onChange('{'));
  expect(viewControl('Visual').disabled).toBe(true);
  expect(button('Save').disabled).toBe(true);
  await click('Discard');
  expect(rawEditor.props.value).toBe(baseline);
  expect(rpc.update).not.toHaveBeenCalled();
  await click('Visual');
  expect(button('Save draft').disabled).toBe(true);
  expect(onDirty).toHaveBeenLastCalledWith(false);
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

it('saves local parent edits with child creation before navigating', async () => {
  rpc.createChild.mockImplementation(async (input) => ({
    parent: { ...workflow, draft: input.parent.definition, draftRevision: 2 },
    child: {
      ...workflow,
      id: 'child',
      ownerWorkflowId: workflow.id,
      latestVersion: 0,
    },
  }));
  await render();
  await click('Move entry');
  await click('Add node');
  await click('Create test child');
  expect(rpc.createChild.mock.calls[0][0]).toMatchObject({
    parentDraftRevision: 1,
    ownerWorkflowId: 'test',
    nodeId: 'child-node',
  });
  expect(
    rpc.createChild.mock.calls[0][0].parent.definition.nodes[0].position,
  ).toEqual({ x: 200, y: 250 });
  expect(saved).toHaveBeenCalledTimes(2);
  expect(opened).toHaveBeenCalledWith('child');
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(rpc.update).not.toHaveBeenCalled();
});
it('keeps parent edits and stays in the editor if child creation fails', async () => {
  rpc.createChild.mockRejectedValue(new Error('Draft changed elsewhere'));
  await render();
  await click('Move entry');
  await click('Add node');
  await click('Create test child');
  expect(errors).toHaveLength(1);
  expect(opened).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(canvas.props.nodes[0].position).toEqual({ x: 200, y: 250 });
});

it('focuses a binding source without editing the workflow or opening settings', async () => {
  workflow.draft.nodes[1].inputBindings = {
    previous: { source: 'node', nodeId: 'agent', path: '' },
  };
  await render();
  const fitView = vi.fn();
  canvas.props.onInit({ fitView });
  await act(async () =>
    canvas.props.nodes
      .find((n: any) => n.id === 'agent')
      .data.bindingSources[0].onFocus(),
  );
  expect(canvas.props.nodes.find((n: any) => n.id === 'agent').selected).toBe(
    true,
  );
  expect(fitView).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: [{ id: 'agent' }] }),
  );
  expect(button('Apply local edit')).toBeUndefined();
  expect(rpc.update).not.toHaveBeenCalled();
});

it('keeps Raw and Visual positions consistent when ELK finishes in Raw', async () => {
  await render();
  let settle!: () => void;
  elk.tidy.mockImplementation(
    (definition) =>
      new Promise((resolve) => {
        settle = () =>
          resolve({
            ...definition,
            nodes: definition.nodes.map((node: any) => ({
              ...node,
              position: { x: node.position.x + 40, y: node.position.y },
            })),
          });
      }),
  );
  await tidy('ELK');
  await click('Raw');
  await act(async () => settle());
  const rawPositions = JSON.parse(rawEditor.props.value).nodes.map(
    (node: any) => ({ id: node.id, position: node.position }),
  );
  await click('Visual');
  expect(positions()).toEqual(rawPositions);
});

it('chooses a remembered Tidy mode without arranging until the wand is clicked', async () => {
  workflow.draft = nestedBatches(2);
  await render();
  const original = positions();
  expect(button('Tidy').title).toContain('Tidy using Dagre');
  await click('Tidy');
  const arranged = positions();
  expect(arranged).not.toEqual(original);
  expect(elk.tidy).not.toHaveBeenCalled();
  elk.tidy.mockImplementation(async (definition) => definition);
  await chooseTidyMode('ELK');
  expect(elk.tidy).not.toHaveBeenCalled();
  expect(positions()).toEqual(arranged);
  expect(button('Tidy').title).toContain('Tidy using ELK');
  await click('Tidy');
  expect(elk.tidy).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(button('Tidy').title).toContain('Tidy using ELK');
  await click('Tidy');
  expect(elk.tidy).toHaveBeenCalledTimes(2);
  const beforeModeChange = positions();
  await chooseTidyMode('Dagre');
  expect(button('Tidy').title).toContain('Tidy using Dagre');
  expect(positions()).toEqual(beforeModeChange);
  await click('Tidy');
  expect(elk.tidy).toHaveBeenCalledTimes(2);
});

it('ignores a cancelled ELK request after returning to Visual without clearing a newer request', async () => {
  await render();
  const original = positions();
  const requests: Array<(definition: typeof workflow.draft) => void> = [];
  elk.tidy.mockImplementation(
    () => new Promise((resolve) => requests.push(resolve)),
  );
  await tidy('ELK');
  await click('Raw');
  await click('Visual');
  expect(button('Tidy').disabled).toBe(false);
  await click('Tidy');
  const arranged = {
    ...workflow.draft,
    nodes: workflow.draft.nodes.map((node) => ({
      ...node,
      position: { ...node.position, x: node.position.x + 40 },
    })),
  };
  await act(async () => requests[0](arranged));
  expect(positions()).toEqual(original);
  expect(button('Tidy').disabled).toBe(true);
  await act(async () => requests[1](arranged));
  expect(positions()).not.toEqual(original);
  expect(button('Tidy').disabled).toBe(false);
});

it('keeps browser unload protection for unsaved workflow edits through the shared hook', async () => {
  await render();
  function unload() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  expect(unload()).toBe(false);
  await click('Raw');
  await act(async () => rawEditor.props.onChange('{'));
  expect(unload()).toBe(true);
  await click('Discard');
  expect(unload()).toBe(false);
});

it('opens the workflow report through its optional route callback', async () => {
  await render();
  await click('Workflow actions');
  await click('Performance & cost report');
  expect(reportOpened).toHaveBeenCalledOnce();
});

it('serializes and coalesces layout writes without dirtying content or saving a draft', async () => {
  let finish!: () => void;
  rpc.saveLayout.mockImplementationOnce(
    (input) =>
      new Promise((resolve) => {
        finish = () => {
          layoutPositions = { ...layoutPositions, ...input.positions };
          layoutRevision++;
          resolve({
            id: workflow.id,
            revision: layoutRevision,
            positions: layoutPositions,
          });
        };
      }),
  );
  await render();
  const id = workflow.draft.nodes[0].id;
  await click(`Move ${id}`);
  for (const x of [300, 400])
    await act(async () =>
      canvas.props.onNodesChange([
        { type: 'position', id, position: { x, y: 250 } },
      ]),
    );
  expect(rpc.saveLayout).toHaveBeenCalledTimes(1);
  expect(button('Save draft').disabled).toBe(true);
  expect(onDirty).toHaveBeenLastCalledWith(false);
  const pendingUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(pendingUnload);
  expect(pendingUnload.defaultPrevented).toBe(true);
  await act(async () => finish());
  expect(rpc.saveLayout).toHaveBeenCalledTimes(2);
  expect(rpc.saveLayout).toHaveBeenLastCalledWith({
    id: workflow.id,
    expectedRevision: 1,
    positions: { [id]: { x: 400, y: 250 } },
  });
  expect(rpc.update).not.toHaveBeenCalled();
  expect(rpc.publish).not.toHaveBeenCalled();
  const savedUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(savedUnload);
  expect(savedUnload.defaultPrevented).toBe(false);
});

it('retains a failed layout patch and retries against the latest layout without overwriting other nodes', async () => {
  rpc.saveLayout.mockRejectedValueOnce(new Error('Offline'));
  await render();
  const [first, second] = workflow.draft.nodes;
  await click(`Move ${first.id}`);
  expect(container.textContent).toContain('Layout could not be saved. Offline');
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(button('Save draft').disabled).toBe(true);
  layoutRevision = 4;
  layoutPositions = { ...layoutPositions, [second.id]: { x: 900, y: 950 } };
  await click('Retry layout save');
  expect(rpc.get).toHaveBeenCalledWith({ id: workflow.id });
  expect(rpc.saveLayout).toHaveBeenLastCalledWith({
    id: workflow.id,
    expectedRevision: 4,
    positions: { [first.id]: { x: 200, y: 250 } },
  });
  expect(
    canvas.props.nodes.find((n: any) => n.id === second.id).position,
  ).toEqual({ x: 900, y: 950 });
  expect(container.textContent).not.toContain('Layout could not be saved');
  expect(rpc.update).not.toHaveBeenCalled();
});

it('keeps a pending layout through StrictMode leaving and reopening while discarded content stays unsaved', async () => {
  strict = true;
  let finish!: () => void;
  rpc.saveLayout.mockImplementationOnce(
    (input) =>
      new Promise((resolve) => {
        finish = () => {
          layoutPositions = { ...layoutPositions, ...input.positions };
          layoutRevision++;
          resolve({
            id: workflow.id,
            revision: layoutRevision,
            positions: layoutPositions,
          });
        };
      }),
  );
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  const id = workflow.draft.nodes[0].id;
  await click(`Move ${id}`);
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await render(false);
  await render();
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(canvas.props.nodes[0].position).toEqual({ x: 200, y: 250 });
  expect(rpc.saveLayout).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(layoutPositions[id]).toEqual({ x: 200, y: 250 });
  expect(rpc.update).not.toHaveBeenCalled();
  await click('Raw');
  expect(JSON.parse(rawEditor.props.value).maxSteps).toBe(
    workflow.draft.maxSteps,
  );
});

it('applies newer remote layout after an older acknowledgement without resetting content edits', async () => {
  let finish!: () => void;
  rpc.saveLayout.mockImplementationOnce(
    (input) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            id: workflow.id,
            revision: 1,
            positions: { ...layoutPositions, ...input.positions },
          });
      }),
  );
  await render();
  await click('Workflow settings');
  await click('Apply local edit');
  const id = workflow.draft.nodes[0].id;
  await click(`Move ${id}`);
  workflow = {
    ...workflow,
    layoutRevision: 2,
    draft: applyWorkflowPositions(workflow.draft, { [id]: { x: 700, y: 750 } }),
  };
  await render();
  await act(async () => finish());
  expect(canvas.props.nodes[0].position).toEqual({ x: 700, y: 750 });
  expect(container.textContent).not.toContain('changed elsewhere');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await click('Raw');
  expect(JSON.parse(rawEditor.props.value).maxSteps).toBe(60);
});

it('autosaves Raw position-only changes and keeps them undoable without a draft save', async () => {
  await render();
  await click('Raw');
  const draft = JSON.parse(rawEditor.props.value);
  const original = draft.nodes[0].position;
  draft.nodes[0].position = { x: 888, y: 999 };
  await act(async () => rawEditor.props.onChange(JSON.stringify(draft)));
  expect(button('Save').disabled).toBe(true);
  expect(viewControl('Visual').disabled).toBe(false);
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(layoutPositions[draft.nodes[0].id]).toEqual({ x: 888, y: 999 });
  await click('Visual');
  expect(canvas.props.nodes[0].position).toEqual({ x: 888, y: 999 });
  await click('Undo');
  expect(canvas.props.nodes[0].position).toEqual(original);
  expect(rpc.update).not.toHaveBeenCalled();
  expect(rpc.publish).not.toHaveBeenCalled();
});

it('saves only locally dragged nodes when another node moves remotely during the drag', async () => {
  await render();
  const [first, second] = workflow.draft.nodes;
  await act(async () => canvas.props.onNodeDragStart());
  await act(async () =>
    canvas.props.onNodesChange([
      {
        type: 'position',
        id: first.id,
        position: { x: 500, y: 550 },
        dragging: true,
      },
    ]),
  );
  layoutRevision = 1;
  layoutPositions = { ...layoutPositions, [second.id]: { x: 900, y: 950 } };
  workflow = {
    ...workflow,
    layoutRevision,
    draft: applyWorkflowPositions(workflow.draft, layoutPositions),
  };
  await render();
  expect(rpc.saveLayout).not.toHaveBeenCalled();
  await act(async () => canvas.props.onNodeDragStop());
  expect(rpc.saveLayout).toHaveBeenLastCalledWith({
    id: workflow.id,
    expectedRevision: 1,
    positions: { [first.id]: { x: 500, y: 550 } },
  });
  expect(
    canvas.props.nodes.find((n: any) => n.id === second.id).position,
  ).toEqual({ x: 900, y: 950 });
  await click('Undo');
  expect(
    canvas.props.nodes.find((n: any) => n.id === first.id).position,
  ).toEqual(first.position);
  expect(
    canvas.props.nodes.find((n: any) => n.id === second.id).position,
  ).toEqual({ x: 900, y: 950 });
  expect(rpc.saveLayout).toHaveBeenLastCalledWith({
    id: workflow.id,
    expectedRevision: 2,
    positions: { [first.id]: first.position },
  });
});

it('does not save stale Raw positions while editing content after a remote layout update', async () => {
  await render();
  await click('Raw');
  const draft = JSON.parse(rawEditor.props.value);
  const id = workflow.draft.nodes[0].id;
  layoutRevision = 1;
  layoutPositions = { ...layoutPositions, [id]: { x: 777, y: 888 } };
  workflow = {
    ...workflow,
    layoutRevision,
    draft: applyWorkflowPositions(workflow.draft, layoutPositions),
  };
  await render();
  draft.maxSteps = 61;
  await act(async () => rawEditor.props.onChange(JSON.stringify(draft)));
  expect(rpc.saveLayout).not.toHaveBeenCalled();
  await click('Save');
  expect(rpc.update).toHaveBeenCalledWith(
    expect.objectContaining({ layout: 'preserve' }),
  );
  expect(layoutPositions[id]).toEqual({ x: 777, y: 888 });
  await click('Visual');
  expect(canvas.props.nodes[0].position).toEqual({ x: 777, y: 888 });
  expect(rpc.saveLayout).not.toHaveBeenCalled();
});

it('drains an ELK-style microtask position update arriving as the previous layout write settles', async () => {
  const id = workflow.draft.nodes[0].id;
  rpc.saveLayout.mockImplementationOnce((input) => {
    layoutPositions = { ...layoutPositions, ...input.positions };
    layoutRevision++;
    const result = {
      id: workflow.id,
      revision: layoutRevision,
      positions: layoutPositions,
    };
    return Promise.resolve(result).then((acknowledged) => {
      queueMicrotask(() =>
        queueMicrotask(() =>
          canvas.props.onNodesChange([
            { type: 'position', id, position: { x: 600, y: 650 } },
          ]),
        ),
      );
      return acknowledged;
    });
  });
  await render();
  await click(`Move ${id}`);
  expect(rpc.saveLayout).toHaveBeenCalledTimes(2);
  expect(rpc.saveLayout).toHaveBeenLastCalledWith({
    id: workflow.id,
    expectedRevision: 1,
    positions: { [id]: { x: 600, y: 650 } },
  });
  expect(layoutPositions[id]).toEqual({ x: 600, y: 650 });
  expect(container.textContent).not.toContain('Saving layout');
  expect(button('Save draft').disabled).toBe(true);
});

it('shows pending and failed layout saves off-route and retains unload protection until retry succeeds', async () => {
  let fail!: (error: Error) => void;
  rpc.saveLayout.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await render();
  const id = workflow.draft.nodes[0].id;
  await click(`Move ${id}`);
  await render(false);
  expect(container.textContent).toContain('Saving layout for Original');
  const pendingUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(pendingUnload);
  expect(pendingUnload.defaultPrevented).toBe(true);
  await act(async () => fail(new Error('Offline')));
  expect(container.textContent).toContain(
    'Layout for Original could not be saved. Offline',
  );
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  const failedUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(failedUnload);
  expect(failedUnload.defaultPrevented).toBe(true);
  await click('Open workflow');
  expect(opened).toHaveBeenCalledWith(workflow.id);
  await click('Retry layout save');
  expect(container.textContent).not.toContain('could not be saved');
  expect(layoutPositions[id]).toEqual({ x: 200, y: 250 });
  const savedUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(savedUnload);
  expect(savedUnload.defaultPrevented).toBe(false);
  expect(rpc.update).not.toHaveBeenCalled();
});

it.each(['pending', 'failed'])(
  'forgets a %s layout save after explicit workflow deletion, including late rejection',
  async (state) => {
    let fail!: (error: Error) => void;
    if (state === 'pending')
      rpc.saveLayout.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
    else rpc.saveLayout.mockRejectedValueOnce(new Error('Offline'));
    await render();
    await click(`Move ${workflow.draft.nodes[0].id}`);
    await click('Delete workflow');
    await click('Delete');
    expect(deleted).toHaveBeenCalledOnce();
    await render(false);
    if (state === 'pending')
      await act(async () => fail(new Error('Workflow not found')));
    expect(container.textContent).not.toContain('layout');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  },
);
