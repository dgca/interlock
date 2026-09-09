// @vitest-environment jsdom
import { act, createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoxZoom } from '../packages/ui/src/features/workflows/useBoxZoom';

let root: Root, container: HTMLDivElement;
let zoom: ReturnType<typeof useBoxZoom>;
const fitBounds = vi.fn().mockResolvedValue(true);
const viewport = {
  fitBounds,
  screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({
    x: (x - 100) / 2,
    y: (y - 50) / 2,
  }),
};
function Harness({ enabled }: { enabled: boolean }) {
  zoom = useBoxZoom(enabled);
  useEffect(() => zoom.onInit(viewport), []);
  return h(
    'div',
    { ref: zoom.containerRef, ...zoom.handlers },
    h('div', { className: 'react-flow__pane' }),
    h('div', { className: 'react-flow__node' }),
    h('textarea'),
  );
}
const render = async (enabled = true) => {
  await act(async () => root.render(h(Harness, { enabled })));
};
const key = async (
  key: string,
  type = 'keydown',
  options: KeyboardEventInit = {},
  target: EventTarget = document.body,
) => {
  const event = new KeyboardEvent(type, {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
};
const pointer = async (
  type: string,
  x: number,
  y: number,
  target: Element = container.querySelector('.react-flow__pane')!,
) => {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => target.dispatchEvent(event));
  return event;
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fitBounds.mockClear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 600,
    bottom: 450,
    width: 500,
    height: 400,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  Element.prototype.releasePointerCapture = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('fits a reverse drag using canvas coordinates and consumes the selection gesture', async () => {
  await render();
  await key('z');
  expect(zoom.active).toBe(true);
  expect((await pointer('pointerdown', 250, 170)).defaultPrevented).toBe(true);
  await pointer('pointermove', 150, 90);
  expect(zoom.box).toEqual({ x: 50, y: 40, width: 100, height: 80 });
  await pointer('pointerup', 150, 90);
  expect(fitBounds).toHaveBeenCalledWith(
    { x: 25, y: 20, width: 50, height: 40 },
    { padding: 0.12, duration: 180 },
  );
  expect(zoom.box).toBeNull();
  expect(zoom.containerRef.current!.releasePointerCapture).toHaveBeenCalledWith(
    1,
  );
  await key('z', 'keyup');
  expect(zoom.active).toBe(false);
});

it('ignores clicks, tiny drags, node starts, and drags without Z', async () => {
  await render();
  expect((await pointer('pointerdown', 200, 100)).defaultPrevented).toBe(false);
  await key('z');
  const node = container.querySelector('.react-flow__node')!;
  expect((await pointer('pointerdown', 200, 100, node)).defaultPrevented).toBe(
    false,
  );
  await pointer('pointerup', 400, 300, node);
  await pointer('pointerdown', 200, 100);
  await pointer('pointerup', 200, 100);
  await pointer('pointerdown', 200, 100);
  await pointer('pointerup', 205, 105);
  expect(fitBounds).not.toHaveBeenCalled();
});

it.each(['escape', 'release', 'blur', 'disabled', 'pointercancel'])(
  'cancels on %s and allows another gesture',
  async (reason) => {
    await render();
    await key('z');
    await pointer('pointerdown', 200, 100);
    await pointer('pointermove', 400, 300);
    if (reason === 'escape') await key('Escape');
    if (reason === 'release') await key('z', 'keyup');
    if (reason === 'blur')
      await act(async () => window.dispatchEvent(new Event('blur')));
    if (reason === 'disabled') await render(false);
    if (reason === 'pointercancel') await pointer('pointercancel', 400, 300);
    expect(zoom.box).toBeNull();
    await pointer('pointerup', 400, 300);
    expect(fitBounds).not.toHaveBeenCalled();
    await render();
    await key('z', 'keyup');
    await key('z');
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 400, 300);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  },
);

it('leaves text editing, Undo modifiers, and disabled contexts alone', async () => {
  await render();
  expect(
    (await key('z', 'keydown', {}, container.querySelector('textarea')!))
      .defaultPrevented,
  ).toBe(false);
  expect(zoom.active).toBe(false);
  await key('z', 'keydown', { metaKey: true });
  await key('z', 'keydown', { ctrlKey: true });
  expect(zoom.active).toBe(false);
  await key('z');
  await key('Control', 'keydown', { ctrlKey: true });
  expect(zoom.active).toBe(false);
  await render(false);
  await key('z');
  expect(zoom.active).toBe(false);
});

it('clamps drags released outside the canvas', async () => {
  await render();
  await key('z');
  await pointer('pointerdown', 200, 100);
  await pointer('pointerup', 800, 900);
  expect(fitBounds).toHaveBeenCalledWith(
    { x: 50, y: 25, width: 200, height: 175 },
    expect.anything(),
  );
});
