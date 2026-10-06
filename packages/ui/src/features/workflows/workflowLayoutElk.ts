import {
  outgoingPorts,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type {
  ELK,
  ElkExtendedEdge,
  ElkNode,
  ElkPort,
} from 'elkjs/lib/elk.bundled.js';
import {
  BATCH_INSET,
  BATCH_SIZE,
  CANVAS_GAP,
  bindingsHeight,
  canvasGeometry,
} from './canvasGeometry';

const layered = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': `${CANVAS_GAP}`,
  'elk.spacing.componentComponent': `${CANVAS_GAP}`,
  'elk.layered.spacing.nodeNodeBetweenLayers': `${CANVAS_GAP}`,
};

// ELK shares one identifier namespace across nodes, ports, and edges.
const nodeId = (id: string) => JSON.stringify(['node', id]);
const portId = (id: string, direction: 'source' | 'target', name: string) =>
  JSON.stringify(['port', id, direction, name]);
const rootScope = Symbol('root');

/** Describe the whole workflow as one ELK graph. Handles become fixed-order ports
 * so fan-outs keep their rendered order; Batches become compound nodes whose
 * padding is the rendered inset and whose internal Start/End handles are ports
 * of the compound. Cross-scope and dangling edges are left out, as in Dagre.
 */
export function elkGraph(definition: WorkflowDefinition): ElkNode {
  const { index, parents, size } = canvasGeometry(definition);
  const outputs = (node: WorkflowNode) =>
    [...new Set(outgoingPorts(node))].filter((name) => name.trim());
  const source = (node: WorkflowNode, port: string) =>
    (node.kind === 'batch' ? ['complete', 'item'] : outputs(node)).includes(
      port,
    )
      ? portId(node.id, 'source', port)
      : nodeId(node.id);
  const edges = new Map<string | typeof rootScope, ElkExtendedEdge[]>();
  for (const edge of definition.edges) {
    const from = index.get(edge.source),
      to = index.get(edge.target);
    if (!from || !to || from === to) continue;
    const container =
      to.kind === 'batch' && parents.get(from.id) === to.id
        ? edge.targetHandle === 'end'
          ? to.id
          : undefined
        : from.kind === 'batch' && parents.get(to.id) === from.id
          ? edge.port === 'item'
            ? from.id
            : undefined
          : parents.get(from.id) === parents.get(to.id)
            ? (parents.get(from.id) ?? rootScope)
            : undefined;
    if (container === undefined) continue;
    const list = edges.get(container) ?? [];
    list.push({
      id: JSON.stringify(['edge', edge.id]),
      sources: [source(from, edge.port)],
      targets: [
        portId(to.id, 'target', edge.targetHandle === 'end' ? 'end' : 'in'),
      ],
    });
    edges.set(container, list);
  }
  // ELK counts FIXED_ORDER port indices clockwise, so WEST ports run bottom-up.
  const ports = (node: WorkflowNode): ElkPort[] => {
    const west =
      node.kind === 'batch'
        ? ['in', 'item']
        : node.kind === 'entry'
          ? []
          : ['in'];
    const east = node.kind === 'batch' ? ['complete', 'end'] : outputs(node);
    const port = (name: string, side: string, index: number): ElkPort => ({
      id: portId(
        node.id,
        (
          node.kind === 'batch'
            ? name === 'item' || name === 'complete'
            : side === 'EAST'
        )
          ? 'source'
          : 'target',
        name,
      ),
      layoutOptions: { 'elk.port.side': side, 'elk.port.index': `${index}` },
    });
    return [
      ...west.map((name, i) => port(name, 'WEST', west.length - 1 - i)),
      ...east.map((name, i) => port(name, 'EAST', i)),
    ];
  };
  const children = (parentId?: string): ElkNode[] =>
    definition.nodes
      .filter((node) => parents.get(node.id) === parentId)
      .map((node) => {
        const result: ElkNode = {
          id: nodeId(node.id),
          ports: ports(node),
          layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
        };
        if (node.kind !== 'batch') return { ...result, ...size(node) };
        const bindings = bindingsHeight(node);
        return {
          ...result,
          layoutOptions: {
            ...result.layoutOptions,
            ...layered,
            'elk.padding': `[top=${BATCH_INSET.top},left=${BATCH_INSET.left},bottom=${BATCH_INSET.bottom + bindings},right=${BATCH_INSET.right}]`,
            'elk.nodeSize.constraints': 'MINIMUM_SIZE',
            'elk.nodeSize.minimum': `(${BATCH_SIZE.width},${BATCH_SIZE.height + bindings})`,
          },
          children: children(node.id),
          edges: edges.get(node.id) ?? [],
        };
      });
  return {
    id: JSON.stringify(['root']),
    layoutOptions: {
      ...layered,
      'elk.padding': '[top=160,left=60,bottom=0,right=0]',
    },
    children: children(),
    edges: edges.get(rootScope) ?? [],
  };
}

let engine: Promise<ELK> | undefined;
const elk = () =>
  (engine ??= import('elkjs/lib/elk.bundled.js').then(
    (module) => new module.default(),
    (error) => {
      engine = undefined;
      throw error;
    },
  ));

/** Lay out the workflow with ELK's layered algorithm. Like tidyWorkflow, only
 * node positions change. ELK is loaded on first use so it stays out of the
 * initial bundle.
 */
export async function tidyWorkflowElk(
  definition: WorkflowDefinition,
): Promise<WorkflowDefinition> {
  const result = structuredClone(definition);
  const index = new Map(result.nodes.map((node) => [nodeId(node.id), node]));
  const laid = await (await elk()).layout(elkGraph(result));
  // Child coordinates are relative to their compound, matching batch members.
  const place = (parent: ElkNode) => {
    for (const child of parent.children ?? []) {
      index.get(child.id)!.position = {
        x: Math.round(child.x ?? 0),
        y: Math.round(child.y ?? 0),
      };
      place(child);
    }
  };
  place(laid);
  return result;
}
