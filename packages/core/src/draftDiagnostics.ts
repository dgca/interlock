import {
  definitionSchema,
  outgoingPorts,
  validateContractSchema,
  validateDefinition,
  validateBatchScopes,
  type WorkflowDefinition,
  type WorkflowNode,
} from './index.js';
import { structuralEqual } from './jsonEquality.js';
export interface DraftDiagnostic {
  severity: 'error' | 'warning';
  category: 'save' | 'publication' | 'contract';
  code: string;
  path: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  operationIndex?: number;
}
export function unknownDefinitionFields(
  input: unknown,
  parsed: unknown,
  path = '',
): string[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !parsed ||
    typeof parsed !== 'object'
  )
    return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const field = path ? `${path}.${key}` : key;
    return Object.hasOwn(parsed, key)
      ? unknownDefinitionFields(
          value,
          (parsed as Record<string, unknown>)[key],
          field,
        )
      : [field];
  });
}
export function diagnoseDraft(input: unknown): {
  definition?: WorkflowDefinition;
  diagnostics: DraftDiagnostic[];
} {
  const diagnostics: DraftDiagnostic[] = [];
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success)
    return {
      diagnostics: parsed.error.issues.map((issue) => ({
        severity: 'error',
        category: 'save',
        code: 'invalid_definition',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  const d = parsed.data;
  for (const path of unknownDefinitionFields(input, d))
    diagnostics.push({
      severity: 'error',
      category: 'save',
      code: 'unknown_field',
      path,
      message: 'Unknown definition field.',
    });
  if (diagnostics.length) return { diagnostics };
  const add = (
    code: string,
    path: string,
    message: string,
    ids: { nodeId?: string; edgeId?: string } = {},
  ) =>
    diagnostics.push({
      severity: 'error',
      category: 'publication',
      code,
      path,
      message,
      ...ids,
    });
  for (const [kind, items] of [
    ['nodes', d.nodes],
    ['edges', d.edges],
  ] as const) {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id))
        add(
          'duplicate_id',
          `${kind}.${i}.id`,
          `${kind} IDs must be unique.`,
          kind === 'nodes' ? { nodeId: item.id } : { edgeId: item.id },
        );
      seen.add(item.id);
    });
  }
  if (d.nodes.filter((n) => n.kind === 'entry').length !== 1)
    add('entry_count', 'nodes', 'A workflow needs exactly one entry.');
  if (!d.nodes.some((n) => n.kind === 'exit'))
    add('missing_exit', 'nodes', 'A workflow needs an exit.');
  const contracts: [string, Record<string, unknown>, string?][] = [
    ['inputSchema', d.inputSchema],
    ['outputSchema', d.outputSchema],
  ];
  d.nodes.forEach((n, i) =>
    contracts.push(
      [`nodes.${i}.inputSchema`, n.inputSchema, n.id],
      [`nodes.${i}.outputSchema`, n.outputSchema, n.id],
    ),
  );
  for (const [path, schema, nodeId] of contracts)
    try {
      validateContractSchema(schema);
    } catch (error) {
      add('invalid_contract', path, (error as Error).message, { nodeId });
    }
  d.edges.forEach((e, i) => {
    const source = d.nodes.find((n) => n.id === e.source),
      target = d.nodes.find((n) => n.id === e.target);
    if (!source || !target)
      add(
        'missing_edge_node',
        `edges.${i}`,
        'Edge references a missing node.',
        { edgeId: e.id },
      );
    else {
      if (!outgoingPorts(source).includes(e.port))
        add(
          'invalid_port',
          `edges.${i}.port`,
          `${source.label}: invalid source port ${e.port}.`,
          { nodeId: source.id, edgeId: e.id },
        );
      if (target.kind === 'entry')
        add('entry_target', `edges.${i}.target`, 'Edges cannot target Entry.', {
          edgeId: e.id,
        });
    }
  });
  d.nodes.forEach((n, i) => {
    const ports = outgoingPorts(n),
      edges = d.edges.filter((e) => e.source === n.id);
    if (
      edges.length !== ports.length ||
      ports.some((p) => edges.filter((e) => e.port === p).length !== 1)
    )
      add(
        'incomplete_routes',
        `nodes.${i}`,
        `Expected outgoing routes: ${ports.join(', ') || 'none'}.`,
        { nodeId: n.id },
      );
    for (const [field, binding] of Object.entries(n.inputBindings ?? {})) {
      const path = `nodes.${i}.inputBindings.${field}`;
      if (n.kind === 'entry' || n.kind === 'exit')
        add(
          'invalid_binding_target',
          path,
          'Entry and Exit cannot use input bindings.',
          { nodeId: n.id },
        );
      if (binding.source === 'itemInput' && !n.batchId)
        add(
          'invalid_item_binding',
          path,
          'itemInput requires Batch membership.',
          { nodeId: n.id },
        );
      if (binding.source === 'node') {
        const source = d.nodes.find((x) => x.id === binding.nodeId);
        if (!source || source.kind === 'entry' || source.kind === 'exit')
          add(
            'invalid_binding_source',
            path,
            'Node binding requires an existing non-Entry/Exit node.',
            { nodeId: n.id },
          );
        else if (source.batchId !== n.batchId)
          add(
            'binding_scope',
            path,
            'Node binding must remain in the same execution scope.',
            { nodeId: n.id },
          );
      }
    }
    if (n.kind === 'workflow' && n.version === null)
      add(
        'unresolved_version',
        `nodes.${i}.version`,
        'Select a published workflow version.',
        { nodeId: n.id },
      );
  });
  try {
    validateBatchScopes(d);
  } catch (error) {
    const message = (error as Error).message;
    const i = d.nodes.findIndex((n) => message.startsWith(`${n.label}:`));
    add(
      'batch_scope',
      i >= 0 ? `nodes.${i}.batchId` : 'nodes',
      message,
      i >= 0 ? { nodeId: d.nodes[i].id } : {},
    );
  }
  // Keep the existing publication validator authoritative for rules outside the collector.
  try {
    validateDefinition(d);
  } catch (error) {
    const message = (error as Error).message;
    if (!diagnostics.some((x) => x.message === message)) {
      const i = d.nodes.findIndex((n) => message.startsWith(`${n.label}:`));
      add(
        'publication_invalid',
        i >= 0 ? `nodes.${i}` : 'definition',
        message,
        i >= 0 ? { nodeId: d.nodes[i].id } : {},
      );
    }
  }
  diagnostics.push(...contractDiagnostics(d));
  return { definition: d, diagnostics };
}

type Shape = {
  schema: Record<string, unknown>;
  state: 'known' | 'unknown' | 'missing';
  uncertain?: boolean;
  propertyShapes?: Record<string, Shape>;
};
const unknownShape = (): Shape => ({ schema: {}, state: 'unknown' });
const asSchema = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const shape = (schema: Record<string, unknown>): Shape => ({
  schema,
  state: Object.keys(schema).length ? 'known' : 'unknown',
});
const supportedKeys = new Set([
  'type',
  'properties',
  'required',
  'items',
  'additionalProperties',
  'description',
  'title',
  'x-label',
  '$comment',
]);
function primitiveType(schema: Record<string, unknown>): string | undefined {
  return typeof schema.type === 'string' &&
    [
      'string',
      'boolean',
      'null',
      'number',
      'integer',
      'object',
      'array',
    ].includes(schema.type)
    ? schema.type
    : undefined;
}
function propertyShape(source: Shape, key: string): Shape {
  if (source.propertyShapes && Object.hasOwn(source.propertyShapes, key))
    return source.propertyShapes[key];
  if (source.state !== 'known') return unknownShape();
  const properties = asSchema(source.schema.properties);
  if (Object.hasOwn(properties, key)) return shape(asSchema(properties[key]));
  return source.schema.additionalProperties === false
    ? { schema: {}, state: 'missing' }
    : unknownShape();
}
function diagnosticProperty(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
function atPath(source: Shape, path: string): Shape {
  let current = source;
  const unsupported = (value: Shape) =>
    Object.keys(value.schema).some((key) => !supportedKeys.has(key));
  for (const part of path
    .replace(/^\$\./, '')
    .split('.')
    .filter(() => path !== '' && path !== '$')) {
    if (unsupported(current)) return unknownShape();
    if (current.schema.type === 'object')
      current = propertyShape(current, part);
    else if (current.state !== 'known') return current;
    else if (current.schema.type === 'array' && /^\d+$/.test(part))
      current = shape(asSchema(current.schema.items));
    else if (primitiveType(current.schema))
      return { schema: {}, state: 'missing' };
    else return unknownShape();
  }
  return unsupported(current) ? unknownShape() : current;
}
function contractDiagnostics(d: WorkflowDefinition): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>(),
    cache = new Map<string, Shape>();
  const warn = (
    code: string,
    node: WorkflowNode,
    path: string,
    message: string,
    edgeId?: string,
  ) =>
    diagnostics.push({
      severity: 'warning',
      category: 'contract',
      code,
      nodeId: node.id,
      path,
      message,
      ...(edgeId ? { edgeId } : {}),
    });
  const incoming = (node: WorkflowNode): Shape => {
    const edges = d.edges.filter(
      (e) => e.target === node.id && e.targetHandle !== 'end',
    );
    const candidates = edges.map((e) => {
      const source = nodes.get(e.source);
      return source ? output(source, e.port) : unknownShape();
    });
    const first = candidates[0];
    return first &&
      first.state === 'known' &&
      candidates.every((c) => c.state === 'known' && structuralEqual(c, first))
      ? first
      : unknownShape();
  };
  const bindingSource = (
    node: WorkflowNode,
    binding: NonNullable<WorkflowNode['inputBindings']>[string],
  ): Shape => {
    if (binding.source === 'input') return incoming(node);
    if (binding.source === 'runInput') return shape(d.inputSchema);
    // A workflow can also be invoked from another workflow. Root schema is not known here.
    if (binding.source === 'rootInput') return unknownShape();
    if (binding.source === 'itemInput') {
      const batch = node.batchId ? nodes.get(node.batchId) : undefined;
      return batch?.kind === 'batch' ? output(batch, 'item') : unknownShape();
    }
    if (binding.source === 'node') {
      const source = nodes.get(binding.nodeId);
      if (
        !source ||
        source.batchId !== node.batchId ||
        source.kind === 'entry' ||
        source.kind === 'exit'
      )
        return unknownShape();
      const candidates = outgoingPorts(source).map((port) =>
        output(source, port),
      );
      const first = candidates[0];
      return first &&
        candidates.every(
          (c) => c.state === 'known' && structuralEqual(c, first),
        )
        ? first
        : unknownShape();
    }
    return unknownShape();
  };
  const resolved = (node: WorkflowNode): Shape => {
    if (node.kind === 'entry') return shape(d.inputSchema);
    if (!node.inputBindings) return incoming(node);
    const propertyShapes: Record<string, Shape> = Object.fromEntries(
      Object.entries(node.inputBindings).map(([field, binding]) => [
        field,
        atPath(bindingSource(node, binding), binding.path),
      ]),
    );
    const properties = Object.fromEntries(
      Object.entries(propertyShapes).map(([field, value]) => [
        field,
        value.schema,
      ]),
    );
    return {
      schema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
      state: 'known',
      uncertain: Object.values(propertyShapes).some(
        (value) => value.state !== 'known' || value.uncertain,
      ),
      propertyShapes,
    };
  };
  const output = (node: WorkflowNode, port: string): Shape => {
    const key = JSON.stringify([node.id, port]);
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key) || visiting.size >= 100) return unknownShape();
    visiting.add(key);
    let result: Shape;
    if (node.kind === 'agent' && port === 'timeout') result = resolved(node);
    else if (node.kind === 'batch' && port === 'item') {
      const list = atPath(resolved(node), node.itemsPath);
      result =
        list.schema.type === 'array'
          ? shape(asSchema(list.schema.items))
          : unknownShape();
    } else if (node.kind === 'workflow' && node.mode === 'detached')
      result = shape({
        type: 'object',
        properties: {
          runId: { type: 'string' },
          workflowId: { type: 'string' },
          version: { type: 'integer' },
        },
        required: ['runId', 'workflowId', 'version'],
        additionalProperties: false,
      });
    else if (node.kind === 'entry') result = shape(d.inputSchema);
    else if (['condition', 'switch', 'wait'].includes(node.kind))
      result = resolved(node);
    else if (Object.keys(node.outputSchema).length)
      result = shape(node.outputSchema);
    else if (node.kind === 'batch') result = shape({ type: 'array' });
    else result = unknownShape();
    visiting.delete(key);
    cache.set(key, result);
    return result;
  };
  const compare = (
    source: Shape,
    expected: Record<string, unknown>,
    node: WorkflowNode,
    path: string,
    edgeId?: string,
    depth = 0,
  ) => {
    if (!Object.keys(expected).length) return;
    const actual = primitiveType(source.schema),
      target = primitiveType(expected);
    if (
      actual &&
      target &&
      actual !== target &&
      !(actual === 'integer' && target === 'number')
    ) {
      warn(
        'contract_type_conflict',
        node,
        path,
        `Upstream type ${actual} conflicts with expected ${target}.`,
        edgeId,
      );
      return;
    }
    if (
      source.state !== 'known' ||
      !actual ||
      !target ||
      depth >= 8 ||
      Object.keys(source.schema).some((k) => !supportedKeys.has(k)) ||
      Object.keys(expected).some((k) => !supportedKeys.has(k))
    ) {
      warn(
        'contract_unknown',
        node,
        path,
        'Compatibility is unknown for this source or schema.',
        edgeId,
      );
      return;
    }
    if (target === 'object') {
      const required = Array.isArray(expected.required)
        ? expected.required
        : [];
      const properties = asSchema(expected.properties);
      const keys = new Set([
        ...Object.keys(properties),
        ...required.filter((k): k is string => typeof k === 'string'),
      ]);
      for (const key of keys) {
        const selected = propertyShape(source, key);
        if (selected.state === 'missing') {
          if (required.includes(key))
            warn(
              'contract_missing_path',
              node,
              diagnosticProperty(path, key),
              `Upstream contract excludes required field ${key}.`,
              edgeId,
            );
        } else
          compare(
            selected,
            asSchema(properties[key]),
            node,
            diagnosticProperty(path, key),
            edgeId,
            depth + 1,
          );
      }
    }
    if (target === 'array' && Object.keys(asSchema(expected.items)).length)
      compare(
        shape(asSchema(source.schema.items)),
        asSchema(expected.items),
        node,
        `${path}.items`,
        edgeId,
        depth + 1,
      );
  };
  d.nodes.forEach((node, i) => {
    const base = `nodes.${i}`;
    if (node.inputBindings) {
      for (const [field, binding] of Object.entries(node.inputBindings)) {
        const value = atPath(bindingSource(node, binding), binding.path),
          path = `${base}.inputBindings.${field}.path`;
        if (value.state === 'missing')
          warn(
            'binding_missing_path',
            node,
            path,
            `Source contract excludes path "${binding.path}".`,
          );
        else if (value.state === 'unknown' || value.uncertain)
          warn(
            'binding_unknown',
            node,
            path,
            `Cannot determine source path "${binding.path}".`,
          );
      }
      compare(resolved(node), node.inputSchema, node, `${base}.inputSchema`);
    } else {
      const incomingEdges = d.edges.filter(
        (e) => e.target === node.id && e.targetHandle !== 'end',
      );
      if (incomingEdges.length > 1 && incoming(node).state === 'unknown')
        warn(
          'contract_unknown',
          node,
          `${base}.inputSchema`,
          'Incoming route contracts are ambiguous.',
        );
      for (const edge of incomingEdges) {
        const source = nodes.get(edge.source);
        compare(
          source ? output(source, edge.port) : unknownShape(),
          node.inputSchema,
          node,
          `${base}.inputSchema`,
          edge.id,
        );
      }
    }
    if (['condition', 'switch', 'wait'].includes(node.kind))
      compare(resolved(node), node.outputSchema, node, `${base}.outputSchema`);
    if (node.kind === 'exit')
      compare(resolved(node), d.outputSchema, node, 'outputSchema');
    if (node.kind === 'batch') {
      const list = atPath(resolved(node), node.itemsPath);
      if (list.state === 'missing')
        warn(
          'binding_missing_path',
          node,
          `${base}.itemsPath`,
          `Source contract excludes path "${node.itemsPath}".`,
        );
      else compare(list, { type: 'array' }, node, `${base}.itemsPath`);
    }
  });
  return diagnostics;
}
