// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  blankBatchBody,
  nodeSchema,
  type Workflow,
} from '@interlock/core';
import { WorkflowEditor } from '../packages/ui/src/features/workflows/WorkflowEditor';

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
    ReactFlow: ({ children, nodes, onNodesChange }: any) =>
      h(
        'div',
        {},
        children,
        ...nodes.map((n: any) =>
          h(
            'div',
            { key: n.id, 'data-node': n.id },
            h('span', {}, n.data.node.label),
            n.data.onOpen &&
              h('button', { onClick: n.data.onOpen }, `Open ${n.id}`),
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
      ),
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
  CodeEditor: ({ value }: any) => h('pre', { 'data-raw': true }, value),
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

it('edits and moves nodes within a Batch scope and saves the complete root definition', async () => {
  workflow.draft.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'batch',
    label: 'Research handles',
    body: blankBatchBody(),
  });
  await render();
  await click('Open agent');
  expect(container.textContent).toContain('Each item');
  expect(container.textContent).toContain('Item result');
  expect(
    container.querySelector('[aria-label="Inline workflow scope"]')
      ?.textContent,
  ).toContain('Research handles');
  await click('Move agent');
  await click('Workflow settings');
  await click('Apply local edit');
  await click('Back to parent');
  expect(container.textContent).toContain('Research handles');
  await click('Move agent');
  await click('Save draft');
  const draft = rpc.update.mock.calls[0][0].draft;
  expect(draft.maxSteps).toBe(100);
  expect(draft.nodes[1].position).toEqual({ x: 200, y: 250 });
  expect(draft.nodes[1].body.maxSteps).toBe(60);
  expect(draft.nodes[1].body.nodes[1].position).toEqual({ x: 200, y: 250 });
  expect(draft.nodes[1].body.nodes[0].position).toEqual(
    blankBatchBody().nodes[0].position,
  );
});

it('opens nested Batches and keeps Raw view rooted at the complete workflow', async () => {
  const body = blankBatchBody();
  body.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'batch',
    label: 'Inner',
    body: blankBatchBody(),
  });
  workflow.draft.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'batch',
    label: 'Outer',
    body,
  });
  await render();
  await click('Open agent');
  await click('Open agent');
  expect(
    container.querySelector('[aria-label="Inline workflow scope"]')
      ?.textContent,
  ).toContain('Outer / Inner');
  await click('Raw');
  const raw = JSON.parse(container.querySelector('[data-raw]')!.textContent!);
  expect(raw).toEqual(workflow.draft);
  await click('Visual');
  expect(
    container.querySelector('[aria-label="Inline workflow scope"]'),
  ).toBeNull();
  expect(container.textContent).toContain('Outer');
});
