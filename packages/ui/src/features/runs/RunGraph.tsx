import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, useStoreApi } from '@xyflow/react';
import type { WorkflowDefinition } from '@interlock/core';
import { FlowNode } from '../workflows/FlowNode';
import { LoopEdge } from '../workflows/LoopEdge';
import { OrthoEdge } from '../workflows/OrthoEdge';
import { canvasGraph } from '../workflows/canvasGraph';
import { canvasNavigation, CanvasZoomBox } from '../workflows/CanvasNavigation';
import { useBoxZoom } from '../workflows/useBoxZoom';
import styles from '../workflows/CanvasNavigation.module.css';
import type { NodeProgress } from './runProgress';
const nodeTypes = { workflow: FlowNode };
const edgeTypes = { loop: LoopEdge, ortho: OrthoEdge };

function RestoreHandleBounds() {
  const store = useStoreApi();
  useEffect(() => {
    let frame: number | undefined;
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.nodes === previous.nodes || frame !== undefined) return;
      // Replacing the controlled nodes can clear their cached port positions
      // even when the cards haven't resized. Measure after the DOM updates.
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const { domNode, nodeLookup, updateNodeInternals } = store.getState();
        const updates = new Map<
          string,
          { id: string; nodeElement: HTMLDivElement; force: boolean }
        >();
        for (const nodeElement of domNode?.querySelectorAll<HTMLDivElement>(
          'div.react-flow__node[data-id]',
        ) ?? []) {
          const id = nodeElement.dataset.id;
          if (id === undefined) continue;
          const node = nodeLookup.get(id);
          if (node && !node.hidden && !node.internals.handleBounds) {
            updates.set(id, { id, nodeElement, force: true });
          }
        }
        if (updates.size) updateNodeInternals(updates);
      });
    });
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [store]);
  return null;
}

export function RunGraph({
  definition,
  progress,
  selected,
  onSelect,
}: {
  definition: WorkflowDefinition;
  progress: Record<string, NodeProgress>;
  selected?: string;
  onSelect: (nodeId: string) => void;
}) {
  const [hovered, setHovered] = useState<string>();
  const boxZoom = useBoxZoom(true);
  const graph = useMemo(() => {
    const graph = canvasGraph(definition, { selected, hovered });
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        ariaRole: 'button' as const,
        ariaLabel: node.data.node.label,
        domAttributes: { 'aria-pressed': selected === node.id },
        data: { ...node.data, progress: progress[node.id] },
      })),
    };
  }, [definition, progress, selected, hovered]);
  return (
    <div
      ref={boxZoom.containerRef}
      {...boxZoom.handlers}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          !target.matches('.react-flow__node[data-id]')
        )
          return;
        const id = target.dataset.id;
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(id);
      }}
      className={`${styles.viewport} ${styles.runViewport} ${boxZoom.active ? styles.boxZoomReady : ''}`}
    >
      <ReactFlow
        {...canvasNavigation(boxZoom.active)}
        onInit={boxZoom.onInit}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeMouseEnter={(_, node) => setHovered(node.id)}
        onNodeMouseLeave={(_, node) =>
          setHovered((current) => (current === node.id ? undefined : current))
        }
        colorMode="dark"
      >
        <RestoreHandleBounds />
        <Background color="var(--canvas-dot)" gap={22} />
        <Controls showInteractive={false} className={styles.controls} />
      </ReactFlow>
      <CanvasZoomBox box={boxZoom.box} />
    </div>
  );
}
