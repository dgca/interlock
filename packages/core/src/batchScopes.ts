import { InterlockError, type WorkflowDefinition } from './index.js';

/** Membership is explicit. Positions and React Flow grouping never determine execution. */
export function validateBatchScopes(
  definition: WorkflowDefinition,
): Map<string, string> {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const owners = new Map<string, string>();
  for (const node of definition.nodes) {
    if (node.batchId) {
      if (nodes.get(node.batchId)?.kind !== 'batch')
        throw new InterlockError(`${node.label}: Batch group does not exist`);
      if (node.kind === 'entry' || node.kind === 'exit')
        throw new InterlockError(
          'Entry and Exit cannot belong to a Batch group',
        );
      owners.set(node.id, node.batchId);
    }
  }
  for (const node of definition.nodes) {
    let parent = node.batchId,
      depth = node.kind === 'batch' ? 1 : 0;
    const seen = new Set([node.id]);
    while (parent) {
      if (seen.has(parent))
        throw new InterlockError('Batch group membership cannot be circular');
      seen.add(parent);
      if (++depth > 10)
        throw new InterlockError('Nested workflow depth exceeded 10');
      parent = nodes.get(parent)?.batchId;
    }
  }
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source),
      target = nodes.get(edge.target);
    if (!source || !target)
      throw new InterlockError('Edge references a missing node');
    const ports =
      source.kind === 'exit'
        ? []
        : source.kind === 'batch'
          ? ['item', 'complete']
          : source.kind === 'condition'
            ? ['true', 'false']
            : ['default'];
    if (!ports.includes(edge.port))
      throw new InterlockError(
        `${source.label}: invalid source handle ${edge.port}`,
      );
    if (target.kind === 'entry')
      throw new InterlockError('Edges cannot target the entry');
    const scope = edge.port === 'item' ? source.id : source.batchId;
    if (edge.port === 'item' && edge.targetHandle === 'end')
      throw new InterlockError('Start must connect to an item step');
    if (
      edge.targetHandle === 'end' &&
      (target.kind !== 'batch' || scope !== target.id)
    )
      throw new InterlockError('End must belong to the current Batch group');
    if (edge.targetHandle !== 'end' && scope !== target.batchId)
      throw new InterlockError(
        'Edges cannot cross Batch groups; use Output to continue outside a group',
      );
  }
  const visited = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id))
      throw new InterlockError('Item path cycles cannot guarantee an output');
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const edge of definition.edges)
      if (
        edge.source === id &&
        edge.port !== 'item' &&
        edge.targetHandle !== 'end'
      )
        visit(edge.target);
    active.delete(id);
  };
  for (const node of definition.nodes) if (node.batchId) visit(node.id);
  return owners;
}
