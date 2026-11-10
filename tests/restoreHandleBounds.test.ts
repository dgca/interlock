// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ReactFlowProvider,
  useStoreApi,
} from '../packages/ui/node_modules/@xyflow/react';
import { RestoreHandleBounds } from '../packages/ui/src/features/workflows/RestoreHandleBounds';

type Store = ReturnType<typeof useStoreApi>;
let store: Store;
let root: Root;
let container: HTMLDivElement;
let canvas: HTMLDivElement;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
const measure = vi.fn();

function StoreProbe({ children }: { children: ReactNode }) {
  store = useStoreApi();
  return children;
}
async function render(active = true) {
  await act(async () =>
    root.render(
      h(ReactFlowProvider, {
        children: h(StoreProbe, {
          children: h(RestoreHandleBounds, { active }),
        }),
      }),
    ),
  );
}
async function flushFrame() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of pending) callback(0);
  });
}
function addNode(
  id: string,
  options: { hidden?: boolean; healthy?: boolean; width?: number } = {},
) {
  const element = document.createElement('div');
  element.className = 'react-flow__node';
  element.dataset.id = id;
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: options.width ?? 220 },
    offsetHeight: { configurable: true, value: 116 },
  });
  canvas.append(element);
  const node = {
    id,
    hidden: options.hidden,
    position: { x: 0, y: 0 },
    data: {},
    measured: options.healthy ? { width: 220, height: 116 } : {},
    internals: {
      positionAbsolute: { x: 0, y: 0 },
      z: 0,
      userNode: { id, data: {}, position: { x: 0, y: 0 } },
      handleBounds: options.healthy ? { source: [], target: [] } : undefined,
    },
  };
  store.getState().nodeLookup.set(id, node);
  return element;
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  measure.mockClear();
  container = document.createElement('div');
  canvas = document.createElement('div');
  document.body.append(container, canvas);
  root = createRoot(container);
  await render(false);
  store.setState({ domNode: canvas, updateNodeInternals: measure });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  canvas.remove();
  vi.unstubAllGlobals();
});

it('repairs missing measurements when a kept-mounted canvas becomes active, without replacing nodes or edges', async () => {
  const element = addNode('branch');
  const nodes = [{ id: 'branch', data: {}, position: { x: 0, y: 0 } }];
  const edges = [
    { id: 'route', source: 'branch', target: 'exit', sourceHandle: 'named' },
  ];
  store.setState({ nodes, edges });
  expect(frames.size).toBe(0);
  await render(true);
  expect(measure).not.toHaveBeenCalled();
  await flushFrame();
  expect(measure).toHaveBeenCalledOnce();
  expect([...measure.mock.calls[0][0]]).toEqual([
    ['branch', { id: 'branch', nodeElement: element, force: true }],
  ]);
  expect(store.getState().nodes).toBe(nodes);
  expect(store.getState().edges).toBe(edges);
});

it('coalesces controlled-node replacements and leaves healthy and collapsed nodes untouched', async () => {
  addNode('missing');
  addNode('healthy', { healthy: true });
  addNode('collapsed-child', { hidden: true });
  await render(true);
  await flushFrame();
  measure.mockClear();
  store.setState({ nodes: [] });
  store.setState({ nodes: [] });
  expect(frames.size).toBe(1);
  await flushFrame();
  expect(measure).toHaveBeenCalledOnce();
  expect([...measure.mock.calls[0][0].keys()]).toEqual(['missing']);
  expect(frames.size).toBe(0);
});

it('does not measure display-none geometry or spin frames while the canvas is hidden', async () => {
  const element = addNode('hidden-tab', { width: 0 });
  await render(true);
  await flushFrame();
  expect(measure).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  await render(false);
  Object.defineProperty(element, 'offsetWidth', { value: 220 });
  await render(true);
  await flushFrame();
  expect(measure).toHaveBeenCalledOnce();
});

it('cancels pending measurement and unsubscribes when a canvas becomes inactive', async () => {
  addNode('pending');
  await render(true);
  expect(frames.size).toBe(1);
  await render(false);
  expect(frames.size).toBe(0);
  store.setState({ nodes: [] });
  expect(frames.size).toBe(0);
  await flushFrame();
  expect(measure).not.toHaveBeenCalled();
});
