import type { Connection, Edge } from '@xyflow/react';
import {
  parallelConnectionError,
  sameExecutionScope,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@interlock/core';

/** Canvas handles for tool edges: an Agent's Tools output and a step's Tool input. */
export const TOOL_SOURCE_HANDLE = 'tools';
export const TOOL_TARGET_HANDLE = 'tool';

const isToolConnection = (c: Connection) =>
  c.sourceHandle === TOOL_SOURCE_HANDLE ||
  c.targetHandle === TOOL_TARGET_HANDLE;

export function validConnection(
  index: Map<string, WorkflowNode>,
  c: Connection,
) {
  const source = index.get(c.source);
  const target = index.get(c.target);
  if (source && target && isToolConnection(c))
    return (
      source.kind === 'agent' &&
      (target.kind === 'script' || target.kind === 'fetch') &&
      c.sourceHandle === TOOL_SOURCE_HANDLE &&
      c.targetHandle === TOOL_TARGET_HANDLE &&
      sameExecutionScope(source, target)
    );
  return Boolean(
    source &&
    source.kind !== 'exit' &&
    target &&
    target.kind !== 'entry' &&
    !parallelConnectionError(
      source,
      target,
      c.sourceHandle ?? 'default',
      c.targetHandle as WorkflowEdge['targetHandle'],
    ) &&
    !(
      source.kind === 'batch' &&
      c.sourceHandle === 'item' &&
      c.targetHandle === 'end'
    ) &&
    (c.targetHandle !== 'end' || target.kind === 'batch') &&
    (source.kind === 'batch' && c.sourceHandle === 'item'
      ? source.id
      : source.batchId) ===
      (c.targetHandle === 'end' ? target.id : target.batchId),
  );
}

/** A new route replaces the route from the same port; a tool edge replaces the same tool. */
export function connectEdges(
  edges: WorkflowEdge[],
  c: Connection,
): WorkflowEdge[] {
  if (isToolConnection(c))
    return [
      ...edges.filter(
        (e) =>
          !(
            e.kind === 'tool' &&
            e.source === c.source &&
            e.target === c.target
          ),
      ),
      {
        id: crypto.randomUUID(),
        source: c.source,
        target: c.target,
        port: 'default',
        kind: 'tool',
      },
    ];
  return [
    ...edges.filter(
      (e) =>
        e.kind === 'tool' ||
        !(e.source === c.source && e.port === (c.sourceHandle ?? 'default')),
    ),
    {
      id: crypto.randomUUID(),
      source: c.source,
      target: c.target,
      port: c.sourceHandle ?? 'default',
      targetHandle: (c.targetHandle ??
        'default') as WorkflowEdge['targetHandle'],
    },
  ];
}

/** Definition edges after a canvas edge change. Tool edges keep their stored fields. */
export function edgesFromCanvas(
  definition: WorkflowDefinition,
  edges: Edge[],
): WorkflowEdge[] {
  const stored = new Map(definition.edges.map((e) => [e.id, e]));
  return edges.map((e) => {
    const original = stored.get(e.id);
    if (original?.kind === 'tool') return original;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      port: e.sourceHandle ?? 'default',
      targetHandle: e.targetHandle?.startsWith('parallel-end:')
        ? 'join'
        : ((e.targetHandle ?? 'default') as WorkflowEdge['targetHandle']),
    };
  });
}
