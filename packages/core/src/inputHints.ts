import type { WorkflowDefinition, WorkflowNode } from './index.js';
import type { Contract } from './contracts.js';
import { STARTED_RUN_SCHEMA } from './workflowMode.js';

export type InputHint = {
  schema: Contract;
  source: string;
  inferred: boolean;
};

const asContract = (value: unknown): Contract =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Contract)
    : {};
const known = (schema: Contract) => Object.keys(schema).length > 0;

/** Resolve only paths whose shape is declared by ordinary object or array schemas. */
export function contractAtPath(schema: Contract, path: string): Contract {
  if (!path) return schema;
  let current = schema;
  for (const part of path.split('.')) {
    if (current.type === 'object') {
      const properties = current.properties;
      if (
        !properties ||
        typeof properties !== 'object' ||
        Array.isArray(properties)
      )
        return {};
      current = asContract((properties as Record<string, unknown>)[part]);
    } else if (current.type === 'array' && /^\d+$/.test(part)) {
      const items = current.items;
      current =
        items && typeof items === 'object' && !Array.isArray(items)
          ? (items as Contract)
          : {};
    } else return {};
  }
  return current;
}

/** Suggestions are hints; callers must keep free-text paths available. */
export function contractPaths(schema: Contract, depth = 0): string[] {
  schema = asContract(schema);
  if (depth >= 4) return [];
  if (schema.type === 'array') {
    const item = contractAtPath(schema, '0');
    return ['0', ...contractPaths(item, depth + 1).map((path) => `0.${path}`)];
  }
  if (
    schema.type !== 'object' ||
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties)
  )
    return [];
  return Object.entries(schema.properties as Record<string, unknown>).flatMap(
    ([key, value]) => [
      key,
      ...contractPaths(asContract(value), depth + 1).map(
        (path) => `${key}.${path}`,
      ),
    ],
  );
}

/** Editor-only shape derived from contracts and the current draft graph. */
export function nodeInputHint(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): InputHint {
  if (known(node.inputSchema))
    return {
      schema: node.inputSchema,
      source: 'Expected format',
      inferred: false,
    };

  const nodes = new Map(
    definition.nodes.map((candidate) => [candidate.id, candidate]),
  );
  nodes.set(node.id, node);
  const visiting = new Set<string>();

  const incoming = (target: WorkflowNode): InputHint => {
    const edges = definition.edges.filter(
      (edge) => edge.target === target.id && edge.targetHandle !== 'end',
    );
    if (!edges.length) return { schema: {}, source: '', inferred: true };
    const candidates = edges.map((edge) => {
      const source = nodes.get(edge.source);
      return source
        ? {
            schema: output(source, edge.port),
            source:
              source.kind === 'entry'
                ? 'Workflow input'
                : `${source.label} output`,
          }
        : { schema: {}, source: '' };
    });
    const first = candidates[0];
    if (
      !known(first.schema) ||
      candidates.some(
        (candidate) =>
          JSON.stringify(candidate.schema) !== JSON.stringify(first.schema),
      )
    )
      return { schema: {}, source: '', inferred: true };
    return {
      schema: first.schema,
      source: candidates.length === 1 ? first.source : 'Incoming routes',
      inferred: true,
    };
  };

  const input = (target: WorkflowNode): InputHint => {
    if (known(target.inputSchema))
      return {
        schema: target.inputSchema,
        source: 'Expected format',
        inferred: false,
      };
    if (visiting.has(target.id))
      return { schema: {}, source: '', inferred: true };
    visiting.add(target.id);
    let result: InputHint;
    if (target.inputBindings) {
      const previous = incoming(target).schema;
      const properties = Object.fromEntries(
        Object.entries(target.inputBindings).map(([key, binding]) => {
          let source: Contract = {};
          if (binding.source === 'input') source = previous;
          if (binding.source === 'runInput') source = definition.inputSchema;
          if (binding.source === 'itemInput' && target.batchId) {
            const batch = nodes.get(target.batchId);
            if (batch?.kind === 'batch') source = output(batch, 'item');
          }
          if (binding.source === 'node') {
            const referenced = nodes.get(binding.nodeId);
            if (
              referenced &&
              referenced.batchId === target.batchId &&
              !(
                referenced.kind === 'agent' &&
                referenced.unclaimedTimeoutMs !== undefined
              )
            )
              source = output(referenced, 'default');
          }
          return [key, contractAtPath(source, binding.path)];
        }),
      );
      result = {
        schema: {
          type: 'object',
          properties,
          required: Object.keys(properties),
          additionalProperties: false,
        },
        source: 'Selected input fields',
        inferred: true,
      };
    } else result = incoming(target);
    visiting.delete(target.id);
    return result;
  };

  const output = (source: WorkflowNode, port: string): Contract => {
    if (source.kind === 'agent' && port === 'timeout')
      return input(source).schema;
    if (source.kind === 'batch' && port === 'item') {
      const items = contractAtPath(
        input(source).schema,
        source.itemsPath,
      ).items;
      return items && typeof items === 'object' && !Array.isArray(items)
        ? (items as Contract)
        : {};
    }
    if (source.kind === 'workflow' && source.mode === 'detached')
      return STARTED_RUN_SCHEMA;
    if (known(source.outputSchema)) return source.outputSchema;
    if (source.kind === 'entry') return definition.inputSchema;
    if (
      source.kind === 'condition' ||
      source.kind === 'switch' ||
      source.kind === 'wait'
    )
      return input(source).schema;
    if (source.kind === 'batch') return { type: 'array' };
    return {};
  };

  return input(node);
}
