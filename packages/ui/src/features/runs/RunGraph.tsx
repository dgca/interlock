import { useMemo, useState } from 'react';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import type { WorkflowDefinition } from '@interlock/core';
import { FlowNode } from '../workflows/FlowNode';
import { RestoreHandleBounds } from '../workflows/RestoreHandleBounds';
import { LoopEdge } from '../workflows/LoopEdge';
import { OrthoEdge } from '../workflows/OrthoEdge';
import { canvasGraph } from '../workflows/canvasGraph';
import { canvasNavigation, CanvasZoomBox } from '../workflows/CanvasNavigation';
import { useBoxZoom } from '../workflows/useBoxZoom';
import styles from '../workflows/CanvasNavigation.module.css';
import type { NodeProgress } from './runProgress';
const nodeTypes = { workflow: FlowNode };
const edgeTypes = { loop: LoopEdge, ortho: OrthoEdge };

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
