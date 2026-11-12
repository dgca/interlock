import { z } from 'zod';
import {
  InterlockError,
  type WorkflowDefinition,
  type WorkflowNode,
} from './index.js';

export const variableKindSchema = z.enum(['config', 'secret']);
export type VariableKind = z.infer<typeof variableKindSchema>;
export function checkVariableDelivery(
  input: unknown,
  context: z.RefinementCtx,
) {
  if (input && typeof input === 'object') {
    const node = input as Record<string, unknown>;
    if ('environment' in node && node.kind !== 'script')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['environment'],
        message:
          'Variable environments are supported only on Script nodes and Script polling checks.',
      });
    if (
      node.kind !== 'fetch' &&
      Array.isArray(node.headers) &&
      node.headers.some((f) => f?.value?.kind === 'variable')
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headers'],
        message:
          'Variable header references are supported only on Fetch nodes and Fetch polling checks.',
      });
  }
  return input;
}
export const variableReferenceSchema = z.object({
  kind: z.literal('variable'),
  variableId: z
    .string()
    .max(120)
    .describe(
      'Stable variable ID from metadata discovery. Injected only for this Fetch header; empty drafts may be saved but cannot publish.',
    ),
  prefix: z.string().max(2048).optional(),
  suffix: z.string().max(2048).optional(),
});
export const scriptEnvironmentSchema = z
  .array(
    z.object({
      name: z.string().max(120),
      variableId: z
        .string()
        .max(120)
        .describe(
          'Stable library variable ID delivered only to this Script process. No plaintext in the definition.',
        ),
    }),
  )
  .max(64);
export type ScriptEnvironment = z.infer<typeof scriptEnvironmentSchema>;
export interface SavedVariable {
  id: string;
  name: string;
  description: string;
  kind: VariableKind;
  enabled: boolean;
  revision: number;
  valueRevision: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface VariableCapture {
  referenceId: string;
  variableId: string;
  name: string;
  kind: VariableKind;
  valueRevision: number;
}
export interface VariableRequirement {
  id: string;
  name: string;
  kind: VariableKind;
}
export interface VariableBinding {
  id: string;
  variableId: string;
  kind: VariableKind;
  revision: number;
}
const identity = z.string().min(1).max(120);
const variableName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/,
    'Use a unique name starting with a letter or underscore, up to 120 characters.',
  );
const description = z.string().max(2000);
const value = z
  .string()
  .refine(
    (v) => new TextEncoder().encode(v).byteLength <= 16 * 1024,
    'Value must be at most 16 KiB',
  );
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
export const variableReadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      search: z.string().max(120).optional(),
      ...page,
    })
    .strict(),
  z
    .object({
      action: z.literal('inspect'),
      id: identity,
      offset: page.offset,
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  z.object({ action: z.literal('config_value'), id: identity }).strict(),
]);
export const variableMutationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: variableName,
      description: description.default(''),
      kind: variableKindSchema,
      value: value.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      id: identity,
      expectedRevision: z.number().int().positive(),
      name: variableName.optional(),
      description: description.optional(),
      enabled: z.boolean().optional(),
      value: value.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      id: identity,
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('bind'),
      id: identity,
      variableId: identity,
      kind: variableKindSchema,
      expectedRevision: z.number().int().min(0),
    })
    .strict(),
]);
export type VariableRead = z.input<typeof variableReadSchema>;
export type VariableMutation = z.input<typeof variableMutationSchema>;
export const variableRequirementSchema = z
  .object({ id: identity, name: variableName, kind: variableKindSchema })
  .strict();
export const variableImportBindingsSchema = z.record(
  z.object({
    action: z.enum(['bind', 'provision']),
    variableId: identity.optional(),
    name: variableName.optional(),
  }),
);
export type VariableImportBindings = z.infer<
  typeof variableImportBindingsSchema
>;

export function nodeVariableReferences(node: WorkflowNode): string[] {
  const operation =
    node.kind === 'wait' && node.timing.kind === 'poll'
      ? node.timing.check
      : node;
  return operation.kind === 'fetch'
    ? operation.headers.flatMap((f) =>
        f.value.kind === 'variable' ? [f.value.variableId] : [],
      )
    : operation.kind === 'script'
      ? (operation.environment ?? []).map((e) => e.variableId)
      : [];
}
export function variableReferences(definition: WorkflowDefinition): string[] {
  return [...new Set(definition.nodes.flatMap(nodeVariableReferences))];
}
export function validateVariableReferences(definition: WorkflowDefinition) {
  const ids = variableReferences(definition);
  if (ids.length > 64)
    throw new InterlockError(
      'A workflow supports at most 64 distinct variable references',
    );
  if (ids.some((id) => !id))
    throw new InterlockError('Select a variable for each variable reference');
  for (const node of definition.nodes) {
    const op =
      node.kind === 'wait' && node.timing.kind === 'poll'
        ? node.timing.check
        : node;
    if (op.kind !== 'script') continue;
    const names = new Set<string>();
    for (const entry of op.environment ?? []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name))
        throw new InterlockError(
          `${node.label}: enter a valid environment variable name`,
        );
      if (names.has(entry.name))
        throw new InterlockError(
          `${node.label}: duplicate environment variable name`,
        );
      names.add(entry.name);
    }
  }
}
export const variableRevisionConflict =
  'Variable changed elsewhere. Reload before saving. Your edits have not been saved.';
