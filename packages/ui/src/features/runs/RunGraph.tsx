import { useMemo, useState } from 'react';
import { Background, Controls, ReactFlow } from '@xyflow/react';
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
        data: { ...node.data, progress: progress[node.id] },
      })),
    };
  }, [definition, progress, selected, hovered]);
  return (
    <div
      ref={boxZoom.containerRef}
      {...boxZoom.handlers}
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
        <Background color="var(--canvas-dot)" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <CanvasZoomBox box={boxZoom.box} />
    </div>
  );
}
