import { z } from 'zod';
import Ajv from 'ajv';
import { validateFetch, type FetchRequest } from './fetch.js';
export {
  resolveFetch,
  validateFetch,
  type FetchNode,
  type FetchBinding,
  type FetchField,
  type FetchRequest,
} from './fetch.js';
import { validateListScopes } from './listScopes.js';
export { validateListScopes } from './listScopes.js';

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);
export const contractSchema = z.record(z.unknown());
export const contextPolicySchema = z.object({
  mode: z.enum(['current', 'fresh']).default('current'),
  instructions: z.string().default(''),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
const fetchBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), value: jsonSchema }),
  z.object({ kind: z.literal('input'), path: z.string() }),
]);
const fetchFieldSchema = z.object({
  name: z.string(),
  value: fetchBindingSchema,
});
const nodeBase = {
  id: z.string().min(1),
  label: z.string().min(1),
  listId: z.string().min(1).optional(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  inputSchema: contractSchema.default({}),
  outputSchema: contractSchema.default({}),
};
export const nodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase, kind: z.literal('entry') }),
  z.object({ ...nodeBase, kind: z.literal('exit') }),
  z.object({
    ...nodeBase,
    kind: z.literal('agent'),
    prompt: z.string(),
    context: contextPolicySchema.default({}),
    maxAttempts: z.number().int().min(1).max(10).default(2),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('script'),
    // Older saved nodes omit language and must continue to run as Bash.
    language: z.enum(['javascript', 'bash']).optional(),
    command: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(120000).default(30000),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('fetch'),
    outputSchema: contractSchema.default({
      type: 'object',
      required: ['status', 'headers', 'body'],
      properties: {
        status: { type: 'integer' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: {},
      },
    }),
    url: z.string(),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
      .default('GET'),
    query: z.array(fetchFieldSchema).default([]),
    headers: z.array(fetchFieldSchema).default([]),
    body: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({ kind: z.literal('input') }),
        z.object({ kind: z.literal('fixed'), value: jsonSchema }),
        z.object({
          kind: z.literal('fields'),
          fields: z.array(fetchFieldSchema),
        }),
      ])
      .default({ kind: 'none' }),
    timeoutMs: z.number().int().min(100).max(120000).default(30000),
    failOnHttpError: z.boolean().default(true),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('condition'),
    path: z.string(),
    equals: jsonSchema,
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('workflow'),
    workflowId: z.string().min(1),
    version: z.number().int().positive(),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('map'),
    workflowId: z.string().min(1),
    version: z.number().int().positive(),
    itemsPath: z.string().default(''),
    concurrency: z.number().int().min(1).max(50).default(5),
    failurePolicy: z.enum(['all', 'collect']).default('all'),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('list'),
    itemsPath: z.string().default(''),
    concurrency: z.number().int().min(1).max(50).default(5),
    failurePolicy: z.enum(['all', 'collect']).default('all'),
  }),
]);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export const definitionSchema = z.object({
  inputSchema: contractSchema.default({}),
  outputSchema: contractSchema.default({}),
  nodes: z.array(nodeSchema).min(2),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      port: z
        .enum(['default', 'true', 'false', 'item', 'complete'])
        .default('default'),
      targetHandle: z.enum(['default', 'end']).optional(),
    }),
  ),
  maxSteps: z.number().int().min(2).max(1000).default(100),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type WorkflowEdge = WorkflowDefinition['edges'][number];
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
export interface Workflow {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  draft: WorkflowDefinition;
  draftRevision: number;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowVersion {
  workflowId: string;
  version: number;
  definition: WorkflowDefinition;
  createdAt: string;
}
export type RunStatus =
  'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export interface NodeExecution {
  id: string;
  nodeId: string;
  kind: WorkflowNode['kind'];
  label: string;
  input: Json;
  output?: Json;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  childRunIds: string[];
  nextItem: number;
  retryChildRunIds?: string[];
  request?: FetchRequest;
}
export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  parentRunId?: string;
  // Item runs execute members of this List in the same published graph.
  listNodeId?: string;
  status: RunStatus;
  input: Json;
  output?: Json;
  error?: string;
  cursor: string;
  value: Json;
  executions: NodeExecution[];
  createdAt: string;
  updatedAt: string;
}
export interface WorkRequest {
  id: string;
  runId: string;
  executionId: string;
  nodeId: string;
  label: string;
  prompt: string;
  input: Json;
  context: ContextPolicy;
  outputSchema: Record<string, unknown>;
  status: 'available' | 'claimed' | 'completed' | 'failed' | 'cancelled';
  attempt: number;
  maxAttempts: number;
  workerId?: string;
  token?: string;
  leaseUntil?: string;
  output?: Json;
  error?: string;
  createdAt: string;
}
export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  at: string;
}
export class InterlockError extends Error {}
const ajv = new Ajv({ allErrors: true, strict: false });
export function validateContractSchema(schema: Record<string, unknown>) {
  contractSchema.parse(schema);
  ajv.compile(schema);
}
export function assertContract(
  schema: Record<string, unknown>,
  value: Json,
  label: string,
) {
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const errors = (validate.errors ?? []).slice(0, 3).map((error) => {
      const segments = error.instancePath
        .split('/')
        .slice(1)
        .map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
      const path = segments.length ? segments.join('.') : 'value';
      let actual: unknown = value;
      for (const part of segments)
        actual =
          actual !== null && typeof actual === 'object'
            ? (actual as Record<string, unknown>)[part]
            : undefined;
      const received =
        actual === null
          ? 'null'
          : Array.isArray(actual)
            ? 'a list'
            : typeof actual === 'string'
              ? 'text'
              : typeof actual === 'object'
                ? 'an object'
                : typeof actual;
      const excerpt = JSON.stringify(actual)?.slice(0, 100) ?? 'missing';
      if (error.keyword === 'required')
        return `Missing required field "${[...segments, error.params.missingProperty].join('.')}".`;
      if (error.keyword === 'type') {
        const types: Record<string, string> = {
          array: 'a list',
          object: 'an object',
          string: 'text',
          boolean: 'yes/no',
          integer: 'a whole number',
          number: 'a number',
          null: 'null',
        };
        return `"${path}" expects ${types[error.params.type] ?? error.params.type}; received ${received}: ${excerpt}.`;
      }
      if (error.keyword === 'enum')
        return `"${path}" must be one of ${JSON.stringify(error.params.allowedValues)}; received ${excerpt}.`;
      if (error.keyword === 'additionalProperties')
        return `Unexpected field "${[...segments, error.params.additionalProperty].join('.')}". Remove it or add it to the contract.`;
      return `"${path}" ${error.message}; received ${excerpt}.`;
    });
    throw new InterlockError(`${label}: ${errors.join(' ')}`);
  }
}
export function readPath(value: Json, path: string): Json {
  if (!path || path === '$') return value;
  let result: Json | undefined = value;
  for (const key of path.replace(/^\$\./, '').split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new InterlockError('Invalid data path');
    result =
      result !== null &&
      typeof result === 'object' &&
      Object.hasOwn(result, key)
        ? (result as Record<string, Json>)[key]
        : undefined;
  }
  if (result === undefined)
    throw new InterlockError(`Input has no path "${path}"`);
  return result;
}
export function validateDefinition(input: unknown): WorkflowDefinition {
  const d = definitionSchema.parse(input);
  const ids = new Set(d.nodes.map((n) => n.id));
  if (ids.size !== d.nodes.length)
    throw new InterlockError('Node IDs must be unique');
  if (new Set(d.edges.map((e) => e.id)).size !== d.edges.length)
    throw new InterlockError('Edge IDs must be unique');
  const entries = d.nodes.filter((n) => n.kind === 'entry');
  if (entries.length !== 1)
    throw new InterlockError('A workflow needs exactly one entry');
  if (!d.nodes.some((n) => n.kind === 'exit'))
    throw new InterlockError('A workflow needs an exit');
  for (const schema of [
    d.inputSchema,
    d.outputSchema,
    ...d.nodes.flatMap((n) => [n.inputSchema, n.outputSchema]),
  ])
    ajv.compile(schema);
  for (const edge of d.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new InterlockError('Edge references a missing node');
    if (edge.target === entries[0].id)
      throw new InterlockError('Edges cannot target the entry');
  }
  for (const node of d.nodes) {
    if (node.kind === 'fetch') validateFetch(node);
    if (
      node.kind === 'list' &&
      !node.itemsPath &&
      node.inputSchema.type &&
      !(Array.isArray(node.inputSchema.type)
        ? node.inputSchema.type.includes('array')
        : node.inputSchema.type === 'array')
    )
      throw new InterlockError(
        `${node.label}: blank Items path requires an array input contract`,
      );
    const outgoing = d.edges.filter((e) => e.source === node.id);
    const expected =
      node.kind === 'exit'
        ? []
        : node.kind === 'condition'
          ? ['true', 'false']
          : node.kind === 'list'
            ? ['item', 'complete']
            : ['default'];
    if (
      outgoing.length !== expected.length ||
      expected.some((p) => outgoing.filter((e) => e.port === p).length !== 1)
    )
      throw new InterlockError(
        `${node.label}: expected outgoing routes ${expected.join(', ') || 'none'}`,
      );
  }
  validateListScopes(d);
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    d.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
  };
  visit(entries[0].id);
  if (reachable.size !== ids.size)
    throw new InterlockError('Every node must be reachable from entry');
  return d;
}
export function blankDefinition(): WorkflowDefinition {
  return definitionSchema.parse({
    nodes: [
      {
        id: 'entry',
        kind: 'entry',
        label: 'Workflow input',
        position: { x: 60, y: 160 },
      },
      {
        id: 'agent',
        kind: 'agent',
        label: 'Agent assignment',
        prompt: 'Process the input and return your result as JSON.',
        position: { x: 370, y: 160 },
      },
      {
        id: 'exit',
        kind: 'exit',
        label: 'Return result',
        position: { x: 680, y: 160 },
      },
    ],
    edges: [
      { id: 'e1', source: 'entry', target: 'agent' },
      { id: 'e2', source: 'agent', target: 'exit' },
    ],
  });
}

export {
  fieldTypes,
  fieldType,
  newContract,
  propertiesOf,
  requiredOf,
  visualIssues,
  renameField,
  inferContract,
  contractExample,
  type Contract,
  type FieldType,
} from './contracts.js';

export function nodeKindLabel(kind: WorkflowNode['kind']): string {
  return kind === 'map' ? 'Map (legacy)' : kind === 'list' ? 'List' : kind;
}
