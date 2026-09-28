import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@interlock/core';

export type ChangeKind = 'added' | 'removed' | 'changed';
export type ValueChange = {
  path: string;
  before?: unknown;
  after?: unknown;
};
export type DiffItem = {
  id: string;
  title: string;
  kind: ChangeKind;
  details: ValueChange[];
};
export type WorkflowDiff = {
  firstPublication: boolean;
  nodes: DiffItem[];
  routes: DiffItem[];
  layout: DiffItem[];
  workflow: DiffItem[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Objects in contracts and settings are unordered. Array order can affect
// behavior, including the first matching Switch case.
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
      )
    );
  }
  return false;
}

function changedValues(
  before: unknown,
  after: unknown,
  path: string,
): ValueChange[] {
  if (sameValue(before, after)) return [];
  if (isObject(before) && isObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    return keys.flatMap((key) =>
      changedValues(before[key], after[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ path, before, after }];
}

function nodeContent(node: WorkflowNode): Record<string, unknown> {
  const { id: _id, position: _position, ...content } = node;
  return content;
}

function routeKey(edge: WorkflowEdge): string {
  return `${edge.source}\0${edge.port}`;
}

function routeValue(edge: WorkflowEdge) {
  return {
    target: edge.target,
    targetHandle: edge.targetHandle ?? 'default',
  };
}

export function compareWorkflow(
  draft: WorkflowDefinition,
  published?: WorkflowDefinition,
): WorkflowDiff {
  const nodes: DiffItem[] = [];
  const routes: DiffItem[] = [];
  const layout: DiffItem[] = [];
  const workflow: DiffItem[] = [];
  const oldNodes = new Map(published?.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(draft.nodes.map((node) => [node.id, node]));

  for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()])) {
    const before = oldNodes.get(id);
    const after = newNodes.get(id);
    const title = after?.label ?? before!.label;
    if (!before || !after) {
      nodes.push({
        id,
        title,
        kind: after ? 'added' : 'removed',
        details: [{ path: 'Node', before, after }],
      });
      continue;
    }
    const details = changedValues(nodeContent(before), nodeContent(after), '');
    if (details.length) nodes.push({ id, title, kind: 'changed', details });
    const positions = changedValues(
      before.position,
      after.position,
      'Position',
    );
    if (positions.length)
      layout.push({ id, title, kind: 'changed', details: positions });
  }

  const oldRoutes = new Map(
    published?.edges.map((edge) => [routeKey(edge), edge]),
  );
  const newRoutes = new Map(draft.edges.map((edge) => [routeKey(edge), edge]));
  for (const key of new Set([...oldRoutes.keys(), ...newRoutes.keys()])) {
    const before = oldRoutes.get(key);
    const after = newRoutes.get(key);
    if (before && after && sameValue(routeValue(before), routeValue(after)))
      continue;
    const edge = after ?? before!;
    const source = newNodes.get(edge.source) ?? oldNodes.get(edge.source);
    routes.push({
      id: key,
      title: `${source?.label ?? edge.source} · ${edge.port}`,
      kind: !before ? 'added' : !after ? 'removed' : 'changed',
      details: [
        {
          path: 'Route',
          before: before && routeValue(before),
          after: after && routeValue(after),
        },
      ],
    });
  }

  for (const [key, title] of [
    ['inputSchema', 'Input contract'],
    ['outputSchema', 'Output contract'],
    ['maxSteps', 'Maximum steps'],
  ] as const) {
    const before = published?.[key];
    const after = draft[key];
    if (!published || !sameValue(before, after))
      workflow.push({
        id: key,
        title,
        kind: published ? 'changed' : 'added',
        details: [{ path: title, before, after }],
      });
  }

  return { firstPublication: !published, nodes, routes, layout, workflow };
}
