import { z } from 'zod';
import {
  definitionSchema,
  jsonSchema,
  nodeSchema,
  type WorkflowDefinition,
} from './index.js';
import { structuralEqual } from './jsonEquality.js';
import {
  diagnoseDraft,
  unknownDefinitionFields,
  type DraftDiagnostic,
} from './draftDiagnostics.js';
export interface DraftChanges {
  nodes: { added: string[]; updated: string[]; removed: string[] };
  edges: { added: string[]; updated: string[]; removed: string[] };
  settings: string[];
}
const fields = {
  set: z.record(z.lazy(() => jsonSchema)).default({}),
  unset: z.array(z.string().min(1)).default([]),
};
export const workflowEditSchema = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('add_node'), node: z.lazy(() => jsonSchema) })
    .strict(),
  z
    .object({ op: z.literal('update_node'), id: z.string().min(1), ...fields })
    .strict(),
  z.object({ op: z.literal('remove_node'), id: z.string().min(1) }).strict(),
  z
    .object({ op: z.literal('add_edge'), edge: z.lazy(() => jsonSchema) })
    .strict(),
  z
    .object({ op: z.literal('update_edge'), id: z.string().min(1), ...fields })
    .strict(),
  z.object({ op: z.literal('remove_edge'), id: z.string().min(1) }).strict(),
  z.object({ op: z.literal('update_settings'), ...fields }).strict(),
]);
export const workflowEditsSchema = z
  .array(z.lazy(() => jsonSchema))
  .max(100)
  .describe(
    'Ordered list, at most 100 edits. Each edit has op: add_node with node; update_node with id, set and optional unset; remove_node with id; add_edge with edge; update_edge with id, set and optional unset; remove_edge with id; or update_settings with set and optional unset. Updates replace named fields shallowly. IDs and node kinds cannot change. Settings are inputSchema, outputSchema, maxSteps. Unknown fields reject the indexed operation. Node/edge objects use the workflow definition format. Added scripts default to JavaScript; existing omitted language retains Bash.',
  );
function parseStrict<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.output<S> {
  const parsed = schema.parse(input);
  const unknown = unknownDefinitionFields(input, parsed);
  if (unknown.length) throw new Error(`Unknown fields: ${unknown.join(', ')}`);
  return parsed;
}
function updateFields(
  value: object,
  set: Record<string, unknown>,
  unset: string[],
  forbidden: string[],
) {
  const result = { ...value } as Record<string, unknown>;
  for (const key of [...Object.keys(set), ...unset]) {
    if (
      forbidden.includes(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      throw new Error(`Cannot edit field ${key}`);
    if (Object.hasOwn(set, key) && unset.includes(key))
      throw new Error(`Field ${key} is both set and unset`);
    // Prevent silent removal of misspelled or kind-specific fields.
    if (unset.includes(key) && !Object.hasOwn(result, key))
      throw new Error(`Cannot unset missing field ${key}`);
  }
  for (const [key, item] of Object.entries(set)) result[key] = item;
  for (const key of unset) delete result[key];
  return result;
}
function changeIds<T extends { id: string }>(before: T[], after: T[]) {
  return {
    added: after
      .filter((x) => !before.some((y) => y.id === x.id))
      .map((x) => x.id),
    updated: after
      .filter((x) => {
        const old = before.find((y) => y.id === x.id);
        return old && !structuralEqual(old, x);
      })
      .map((x) => x.id),
    removed: before
      .filter((x) => !after.some((y) => y.id === x.id))
      .map((x) => x.id),
  };
}
export function draftChanges(
  before: WorkflowDefinition,
  after: WorkflowDefinition,
): DraftChanges {
  return {
    nodes: changeIds(before.nodes, after.nodes),
    edges: changeIds(before.edges, after.edges),
    settings: ['inputSchema', 'outputSchema', 'maxSteps'].filter(
      (key) =>
        !structuralEqual(
          before[key as keyof WorkflowDefinition],
          after[key as keyof WorkflowDefinition],
        ),
    ),
  };
}
export function applyWorkflowEdits(
  before: WorkflowDefinition,
  input: unknown,
):
  | { definition: WorkflowDefinition; diagnostics: DraftDiagnostic[] }
  | { definition?: never; diagnostics: DraftDiagnostic[] } {
  const definition = structuredClone(before);
  if (!Array.isArray(input) || input.length > 100)
    return {
      diagnostics: [
        {
          severity: 'error',
          category: 'save',
          code: 'invalid_edit_list',
          path: 'edits',
          message: 'Expected an array of at most 100 edits.',
        },
      ],
    };
  let lastNodeRemoval: number | undefined;
  for (
    let operationIndex = 0;
    operationIndex < input.length;
    operationIndex++
  ) {
    try {
      const edit = parseStrict(workflowEditSchema, input[operationIndex]);
      if (edit.op === 'add_node') {
        let raw = edit.node;
        if (
          raw &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          raw.kind === 'script' &&
          !Object.hasOwn(raw, 'language')
        )
          raw = { ...raw, language: 'javascript' };
        const node = parseStrict(nodeSchema, raw);
        if (definition.nodes.some((n) => n.id === node.id))
          throw new Error(`Node ID already exists: ${node.id}`);
        definition.nodes.push(node);
      } else if (edit.op === 'add_edge') {
        const edge = parseStrict(
          definitionSchema.shape.edges.element,
          edit.edge,
        );
        if (definition.edges.some((e) => e.id === edge.id))
          throw new Error(`Edge ID already exists: ${edge.id}`);
        definition.edges.push(edge);
      } else if (edit.op === 'update_node' || edit.op === 'remove_node') {
        if (definition.nodes.filter((n) => n.id === edit.id).length > 1)
          throw new Error(`Node ID is ambiguous: ${edit.id}`);
        const index = definition.nodes.findIndex((n) => n.id === edit.id);
        if (index < 0) throw new Error(`Node not found: ${edit.id}`);
        if (edit.op === 'update_node')
          definition.nodes[index] = parseStrict(
            nodeSchema,
            updateFields(definition.nodes[index], edit.set, edit.unset, [
              'id',
              'kind',
            ]),
          );
        else {
          lastNodeRemoval = operationIndex;
          const removed = new Set([edit.id]);
          let size = 0;
          while (size !== removed.size) {
            size = removed.size;
            for (const node of definition.nodes)
              if (node.batchId && removed.has(node.batchId))
                removed.add(node.id);
          }
          definition.nodes = definition.nodes.filter((n) => !removed.has(n.id));
          definition.edges = definition.edges.filter(
            (e) => !removed.has(e.source) && !removed.has(e.target),
          );
        }
      } else if (edit.op === 'update_edge' || edit.op === 'remove_edge') {
        if (definition.edges.filter((e) => e.id === edit.id).length > 1)
          throw new Error(`Edge ID is ambiguous: ${edit.id}`);
        const index = definition.edges.findIndex((e) => e.id === edit.id);
        if (index < 0) throw new Error(`Edge not found: ${edit.id}`);
        if (edit.op === 'update_edge')
          definition.edges[index] = parseStrict(
            definitionSchema.shape.edges.element,
            updateFields(definition.edges[index], edit.set, edit.unset, ['id']),
          );
        else definition.edges.splice(index, 1);
      } else {
        const current = {
          inputSchema: definition.inputSchema,
          outputSchema: definition.outputSchema,
          maxSteps: definition.maxSteps,
        };
        Object.assign(
          definition,
          parseStrict(
            definitionSchema.pick({
              inputSchema: true,
              outputSchema: true,
              maxSteps: true,
            }),
            updateFields(current, edit.set, edit.unset, []),
          ),
        );
      }
    } catch (error) {
      return {
        diagnostics: [
          {
            severity: 'error',
            category: 'save',
            code: 'invalid_edit',
            path: `edits.${operationIndex}`,
            operationIndex,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
  const result = diagnoseDraft(definition);
  if (!result.definition && input.length)
    for (const diagnostic of result.diagnostics)
      diagnostic.operationIndex =
        diagnostic.path === 'nodes' ? lastNodeRemoval : input.length - 1;
  return result.definition
    ? { definition: result.definition, diagnostics: result.diagnostics }
    : { diagnostics: result.diagnostics };
}
