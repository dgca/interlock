import { useMemo } from 'react';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import type { WorkflowDefinition } from '@interlock/core';
import { FlowNode } from '../workflows/FlowNode';
import { canvasGraph } from '../workflows/canvasGraph';
import type { NodeProgress } from './runProgress';
const nodeTypes = { workflow: FlowNode };
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
  const graph = useMemo(() => {
    const graph = canvasGraph(definition, { selected });
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: { ...node.data, progress: progress[node.id] },
      })),
    };
  }, [definition, progress, selected]);
  return (
    <ReactFlow
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      minZoom={0.1}
      colorMode="dark"
    >
      <Background color="var(--canvas-dot)" gap={22} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
