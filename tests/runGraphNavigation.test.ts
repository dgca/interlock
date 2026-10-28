// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { RunGraph } from '../packages/ui/src/features/runs/RunGraph';

const flow = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock('../packages/ui/node_modules/@xyflow/react', async (original) => ({
  ...(await original<
    typeof import('../packages/ui/node_modules/@xyflow/react')
  >()),
  ReactFlow: (props: Record<string, any>) => {
    flow.props = props;
    return h('div', { className: 'react-flow__pane' });
  },
}));

let root: Root;
let container: HTMLDivElement;
const definition = blankDefinition();
const onSelect = vi.fn();
const render = async (progress = {}) => {
  await act(async () =>
    root.render(h(RunGraph, { definition, progress, onSelect })),
  );
};
const key = async (
  key: string,
  type = 'keydown',
  target: EventTarget = window,
) => {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true })),
  );
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSelect.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('uses editor viewport gestures while keeping run nodes read-only', async () => {
  await render();
  expect(flow.props).toMatchObject({
    panOnScroll: true,
    zoomOnScroll: true,
    zoomOnPinch: true,
    zoomActivationKeyCode: ['Meta', 'Control'],
    panActivationKeyCode: 'Space',
    panOnDrag: [1],
    zoomOnDoubleClick: false,
    minZoom: 0.25,
    maxZoom: 1.5,
    fitViewOptions: { padding: 0.22 },
    nodesDraggable: false,
    nodesConnectable: false,
    elementsSelectable: false,
    deleteKeyCode: null,
  });
});

it('arms area zoom and suspends other viewport gestures until cancelled', async () => {
  await render();
  await key('z');
  expect(flow.props).toMatchObject({
    panOnScroll: false,
    zoomOnScroll: false,
    zoomOnPinch: false,
    panOnDrag: false,
    panActivationKeyCode: null,
  });
  await key('Escape');
  expect(flow.props.panOnScroll).toBe(true);
  await key('z', 'keyup');
});

it('ignores area zoom in text inputs and open dialogs', async () => {
  await render();
  const input = document.createElement('textarea');
  container.append(input);
  await key('z', 'keydown', input);
  expect(flow.props.panOnScroll).toBe(true);
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  container.append(dialog);
  await key('z');
  expect(flow.props.panOnScroll).toBe(true);
});

it('retains inspection and graph geometry across progress updates', async () => {
  await render();
  const node = flow.props.nodes[0];
  await act(async () => flow.props.onNodeClick({}, node));
  expect(onSelect).toHaveBeenCalledWith(node.id);
  const positions = flow.props.nodes.map((n: any) => n.position);
  await render({ [node.id]: { status: 'completed' } });
  expect(flow.props.nodes.map((n: any) => n.position)).toEqual(positions);
  expect(flow.props.nodes[0].data.progress).toEqual({ status: 'completed' });
  await act(async () => flow.props.onNodeMouseEnter({}, node));
  await act(async () => flow.props.onNodeMouseLeave({}, node));
  expect(flow.props.nodesDraggable).toBe(false);
});
