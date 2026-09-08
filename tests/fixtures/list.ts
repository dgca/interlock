import {
  definitionSchema,
  nodeSchema,
  type WorkflowNode,
} from '@interlock/core';

export const itemAgent = () =>
  nodeSchema.parse({
    id: 'work',
    label: 'Research item',
    kind: 'agent',
    prompt: 'Research this item.',
    maxAttempts: 1,
  });
export const itemScript = (command = 'return input * 2;') =>
  nodeSchema.parse({
    id: 'work',
    label: 'Double item',
    kind: 'script',
    language: 'javascript',
    command,
  });

export function listDefinition(
  item: WorkflowNode = itemAgent(),
  options: Record<string, unknown> = {},
) {
  return definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'list', kind: 'list', label: 'List', concurrency: 2, ...options },
      { ...item, listId: 'list' },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'list' },
      { id: 'item', source: 'list', port: 'item', target: item.id },

      { id: 'complete', source: 'list', port: 'complete', target: 'exit' },
      {
        id: 'end',
        source: item.id,
        port: 'default',
        target: 'list',
        targetHandle: 'end',
      },
    ],
  });
}

export function nestedLists(
  depth: number,
  item = itemAgent(),
  options: Record<string, unknown> = {},
) {
  const definition = listDefinition(item);
  for (let i = 1; i < depth; i++) {
    const parent = i === 1 ? 'list' : `list${i - 1}`;
    const id = `list${i}`;
    definition.nodes.push(
      nodeSchema.parse({
        id,
        kind: 'list',
        label: `List ${i + 1}`,
        concurrency: 2,
        listId: parent,
        ...options,
      }),
    );
    definition.edges.find(
      (e) => e.source === parent && e.port === 'item',
    )!.target = id;
    definition.nodes.find((n) => n.id === item.id)!.listId = id;
    definition.edges.find((e) => e.source === item.id)!.target = id;
    definition.edges.push({
      id: `end${i}`,
      source: id,
      port: 'complete',
      target: parent,
      targetHandle: 'end',
    });
    definition.edges.push({
      id: `item${i}`,
      source: id,
      port: 'item',
      target: item.id,
    });
  }
  return definition;
}
