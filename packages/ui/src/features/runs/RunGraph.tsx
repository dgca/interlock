import { useEffect, useMemo } from 'react';
import { Background, Controls, ReactFlow, useNodesState } from '@xyflow/react';
import type { NodeExecution, WorkflowDefinition } from '@interlock/core';
import { FlowNode, type CanvasNode } from '../workflows/FlowNode';
const nodeTypes = { workflow: FlowNode };
export function RunGraph({
  definition,
  executions,
  onSelect,
}: {
  definition: WorkflowDefinition;
  executions: NodeExecution[];
  onSelect: (id: string | undefined) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  useEffect(
    () =>
      setNodes((current) =>
        definition.nodes.map((node) => ({
          ...current.find((n) => n.id === node.id),
          id: node.id,
          type: 'workflow',
          position: node.position,
          data: {
            node,
            status: executions.filter((e) => e.nodeId === node.id).at(-1)
              ?.status,
          },
        })),
      ),
    [definition, executions, setNodes],
  );
  const edges = useMemo(
    () =>
      definition.edges.map((edge) => ({ ...edge, sourceHandle: edge.port })),
    [definition.edges],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) =>
        onSelect(executions.filter((e) => e.nodeId === node.id).at(-1)?.id)
      }
      fitView
      minZoom={0.2}
      colorMode="dark"
    >
      <Background color="var(--canvas-dot)" gap={22} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
