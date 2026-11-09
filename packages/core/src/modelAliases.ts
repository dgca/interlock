import { z } from 'zod';
import {
  executorModelSchema,
  executorEffortSchema,
  executorReferenceSchema,
} from './executors.js';
import type { WorkflowDefinition } from './index.js';

export const modelAliasCandidateSchema = z
  .object({
    model: executorModelSchema.describe('Model ID or name for this candidate.'),
    effort: executorEffortSchema
      .nullable()
      .optional()
      .describe(
        'Thinking effort override for this candidate; omit to inherit, null for native default.',
      ),
    profileId: executorReferenceSchema
      .optional()
      .describe('Optional executor profile override for this candidate.'),
  })
  .strict();
export type ModelAliasCandidate = z.infer<typeof modelAliasCandidateSchema>;

export const modelAliasNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Use an alias name starting with an alphanumeric character, up to 120 characters.',
  );

export interface SavedModelAlias {
  id: string;
  name: string;
  description: string;
  candidates: ModelAliasCandidate[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelAliasCapture {
  reference?: string;
  aliasId: string;
  name: string;
  revision: number;
  candidates: ModelAliasCandidate[];
}

export const modelAliasSelectionSchema = z
  .object({
    aliasId: z.string().min(1),
    name: modelAliasNameSchema,
    revision: z.number().int().positive(),
    candidateModel: executorModelSchema,
    candidateIndex: z.number().int().min(0).max(31),
    candidateProfileId: executorReferenceSchema.optional(),
    candidateEffort: executorEffortSchema.nullable().optional(),
  })
  .strict();
export type ModelAliasSelection = z.infer<typeof modelAliasSelectionSchema>;
export type ExpandedModelCandidate = ModelAliasCandidate & {
  modelAliasSelection?: ModelAliasSelection;
};

export interface ModelAliasRequirement {
  name: string;
  description?: string;
  reference?: string;
}

export const modelAliasRequirementSchema = z
  .object({
    name: modelAliasNameSchema,
    description: z.string().max(2000).optional(),
    reference: executorModelSchema
      .optional()
      .describe(
        'Authored alias identity when it differs from the portable name. Binds to a local alias by name.',
      ),
  })
  .strict();

export const modelAliasReadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      search: z.string().max(120).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(25),
    })
    .strict(),
  z
    .object({
      action: z.literal('inspect'),
      id: z.string().min(1).max(120),
    })
    .strict(),
]);

export const modelAliasMutationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: modelAliasNameSchema,
      description: z.string().max(2000).default(''),
      candidates: z.array(modelAliasCandidateSchema).min(1).max(32),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      id: z.string().min(1).max(120),
      expectedRevision: z.number().int().positive(),
      name: modelAliasNameSchema.optional(),
      description: z.string().max(2000).optional(),
      candidates: z.array(modelAliasCandidateSchema).min(1).max(32).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      id: z.string().min(1).max(120),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);

export type ModelAliasRead = z.input<typeof modelAliasReadSchema>;
export type ModelAliasMutation = z.input<typeof modelAliasMutationSchema>;

export function modelReferences(definition: WorkflowDefinition): string[] {
  const refs = new Set<string>();
  if (definition.agentModel) refs.add(definition.agentModel);
  for (const node of definition.nodes) {
    if (node.kind === 'agent') {
      if (node.model) refs.add(node.model);
    }
  }
  return [...refs];
}
