import { z } from 'zod';
import {
  executorModelSchema,
  executorEffortSchema,
  executorReferenceSchema,
  executorPermissionModeSchema,
  type ExecutorPermissionMode,
  type ExecutorProfile,
} from './executors.js';
import type { WorkflowDefinition, WorkflowNode } from './index.js';

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
    /^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/,
    'Use a preset name starting with an alphanumeric character, up to 120 characters.',
  );

export interface SavedModelAlias {
  id: string;
  name: string;
  description: string;
  candidates: ModelAliasCandidate[];
  permissions?: ExecutorPermissionMode;
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
  permissions?: ExecutorPermissionMode;
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
      permissions: executorPermissionModeSchema
        .optional()
        .describe(
          'Omit to use the selected harness default or workflow override.',
        ),
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
      permissions: executorPermissionModeSchema
        .nullable()
        .optional()
        .describe(
          'Omit to leave unchanged; null restores permission inheritance.',
        ),
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
  if (definition.agentModel && definition.agentModelMode !== 'literal')
    refs.add(definition.agentModel);
  for (const node of definition.nodes) {
    if (node.kind === 'agent') {
      if (node.model && node.executorMode !== 'harness') refs.add(node.model);
    }
  }
  return [...refs];
}

type AgentNode = Extract<WorkflowNode, { kind: 'agent' }>;

export function usesDirectHarness(
  node: AgentNode,
  workflow?: WorkflowDefinition,
) {
  return (
    node.executorMode === 'harness' ||
    (!!node.executor && !node.model && workflow?.agentModelMode === 'preset')
  );
}

export function agentAliasReference(
  node: AgentNode,
  workflow: WorkflowDefinition,
) {
  if (node.executor === null || usesDirectHarness(node, workflow)) return;
  return (
    node.model ??
    (workflow.agentModelMode === 'literal' ? undefined : workflow.agentModel)
  );
}

export function selectsPreset(node: AgentNode, workflow: WorkflowDefinition) {
  return (
    node.executorMode === 'preset' ||
    (workflow.agentModelMode === 'preset' &&
      node.executor === undefined &&
      !node.model)
  );
}

const permissionRank = { 'read-only': 0, standard: 1, 'full-access': 2 };

export function presetPermissions(
  preset?: ExecutorPermissionMode,
  workflow?: ExecutorPermissionMode,
): ExecutorPermissionMode | undefined {
  if (!preset || !workflow) return preset ?? workflow;
  return permissionRank[preset] < permissionRank[workflow] ? preset : workflow;
}

/** Custom integrations receive permission requests but do not enforce them. */
export function supportsPresetPermissions(
  profile: Pick<ExecutorProfile, 'harness'>,
  permissions?: ExecutorPermissionMode,
) {
  return (
    profile.harness !== 'custom' ||
    !permissions ||
    permissions === 'full-access'
  );
}

export function* eligiblePresetChoices<
  T extends ModelAliasCandidate,
  P extends Pick<ExecutorProfile, 'harness'>,
>(
  candidates: readonly T[],
  workflowExecutor: string | undefined,
  profileFor: (id: string) => P | undefined,
  permissions?: ExecutorPermissionMode,
) {
  for (const candidate of candidates) {
    const executor = candidate.profileId ?? workflowExecutor;
    const profile = executor ? profileFor(executor) : undefined;
    if (executor && profile && supportsPresetPermissions(profile, permissions))
      yield { candidate, executor, profile };
  }
}

export function firstEligiblePresetChoice<
  T extends ModelAliasCandidate,
  P extends Pick<ExecutorProfile, 'harness'>,
>(...args: Parameters<typeof eligiblePresetChoices<T, P>>) {
  return eligiblePresetChoices(...args).next().value;
}

export function inheritsWorkflowHarnessSettings(
  executor: string,
  workflowExecutor: string | undefined,
  workflowHasPreset: boolean,
) {
  return (
    !workflowHasPreset && (!workflowExecutor || executor === workflowExecutor)
  );
}
