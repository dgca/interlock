import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
} from 'react';
import type { ReactFlowInstance, Rect } from '@xyflow/react';

type Point = { x: number; y: number };
type Gesture = {
  pointerId: number;
  start: Point;
  bounds: DOMRect;
};
type Viewport = Pick<ReactFlowInstance, 'screenToFlowPosition' | 'fitBounds'>;
const rectangle = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});
const isTextInput = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
const isPane = (target: EventTarget | null) =>
  target instanceof Element && target.classList.contains('react-flow__pane');

export function useBoxZoom(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const armed = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const [active, setActive] = useState(false);
  const [box, setBox] = useState<Rect | null>(null);
  const setArmed = (value: boolean) => {
    armed.current = value;
    setActive(value);
  };
  const clearGesture = () => {
    const previous = gesture.current;
    gesture.current = null;
    setBox(null);
    if (previous && containerRef.current?.hasPointerCapture(previous.pointerId))
      containerRef.current.releasePointerCapture(previous.pointerId);
  };
  const cancel = () => {
    setArmed(false);
    clearGesture();
  };
  useEffect(() => {
    if (!enabled) cancel();
    const down = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        if (armed.current) cancel();
        return;
      }
      if (
        !enabled ||
        event.repeat ||
        event.defaultPrevented ||
        event.key.toLowerCase() !== 'z' ||
        isTextInput(event.target)
      )
        return;
      event.preventDefault();
      setArmed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'z') cancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', cancel);
    };
  }, [enabled]);

  const point = (event: PointerEvent, bounds: DOMRect): Point => ({
    x: Math.max(bounds.left, Math.min(bounds.right, event.clientX)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, event.clientY)),
  });
  const stop = (event: PointerEvent | MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    containerRef,
    active: enabled && active,
    box: enabled ? box : null,
    onInit: (instance: Viewport) => {
      viewport.current = instance;
    },
    handlers: {
      onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
        swallowClick.current = false;
        if (
          !enabled ||
          !armed.current ||
          !isPane(event.target) ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
          return;
        stop(event);
        const bounds = (event.target as Element).getBoundingClientRect();
        gesture.current = {
          pointerId: event.pointerId,
          start: point(event, bounds),
          bounds,
        };
        swallowClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => {
        if (armed.current && isPane(event.target)) stop(event);
      },
      onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        stop(event);
        const next = rectangle(current.start, point(event, current.bounds));
        const origin = event.currentTarget.getBoundingClientRect();
        setBox({ ...next, x: next.x - origin.left, y: next.y - origin.top });
      },
      onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        stop(event);
        const area = rectangle(current.start, point(event, current.bounds));
        clearGesture();
        if (!viewport.current || area.width < 8 || area.height < 8) return;
        const start = viewport.current.screenToFlowPosition(
          { x: area.x, y: area.y },
          { snapToGrid: false },
        );
        const end = viewport.current.screenToFlowPosition(
          { x: area.x + area.width, y: area.y + area.height },
          { snapToGrid: false },
        );
        void viewport.current.fitBounds(rectangle(start, end), {
          padding: 0.12,
          duration: 180,
        });
      },
      onPointerCancelCapture: clearGesture,
      onLostPointerCapture: clearGesture,
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
        if (swallowClick.current || (armed.current && isPane(event.target))) {
          swallowClick.current = false;
          stop(event);
        }
      },
    },
  };
}
