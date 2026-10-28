import type { Rect } from '@xyflow/react';
import styles from './CanvasNavigation.module.css';

const zoomKeys = ['Meta', 'Control'];
const panButtons = [1];

export function canvasNavigation(areaZoomActive: boolean) {
  return {
    panOnScroll: !areaZoomActive,
    zoomOnScroll: !areaZoomActive,
    zoomOnPinch: !areaZoomActive,
    zoomActivationKeyCode: zoomKeys,
    panActivationKeyCode: areaZoomActive ? null : 'Space',
    panOnDrag: areaZoomActive ? false : panButtons,
    zoomOnDoubleClick: false,
    fitView: true,
    fitViewOptions: { padding: 0.22 },
    minZoom: 0.25,
    maxZoom: 1.5,
  };
}

export function CanvasZoomBox({ box }: { box: Rect | null }) {
  return box ? (
    <div
      aria-hidden="true"
      className={styles.zoomBox}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  ) : null;
}
