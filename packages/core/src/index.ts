export * from './stalls.js';
import {
  stallFields,
  idleRecoverySchema,
  activeClockMsSchema,
} from './stalls.js';
export {
  scriptOperationSchema,
  type ScriptOperation,
  type BackgroundScript,
} from './backgroundScripts.js';
export type { RunAttention, RunAttentionReason } from './runAttention.js';
export * from './workResources.js';
export * from './executors.js';
import {
  executorPermissionModeSchema,
  executorModelSchema,
  executorEffortSchema,
  executorReferenceSchema,
  continueOnMissingResultSchema,
  transientRetrySchema,
} from './executors.js';
import { resourceNamesSchema } from './workResources.js';
export { matchRouting } from './resultRouting.js';
export * from './simulation.js';
export * from './runChains.js';
export * from './runStarts.js';
import {
  startRequestIdSchema,
  externalTaskIdentitySchema,
} from './runStarts.js';
import { continueAsNewSchema } from './runChains.js';
import { z } from 'zod';
export * from './usage.js';
import { modelUsageSchema, type ModelUsage } from './usage.js';
export interface ExecutionProvenance {
  profileId: string | null;
  harness: string | null;
  sessionId: string | null;
  requestedModel: string | null;
  actualModel: string | null;
  provider: string | null;
  effort: string | null;
  attempt: number;
  visitCount: number;
  startedAt: string | null;
  endedAt: string | null;
  usage: ModelUsage[] | null;
}
export const executionProvenanceSchema = z.object({
  profileId: z.string().nullable(),
  harness: z.string().nullable(),
  sessionId: z.string().nullable(),
  requestedModel: z.string().nullable(),
  actualModel: z.string().nullable(),
  provider: z.string().nullable(),
  effort: z.string().nullable(),
  attempt: z.number().int().positive(),
  visitCount: z.number().int().positive(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  usage: z.array(modelUsageSchema).nullable(),
});
export const EXECUTION_PROVENANCE_CONTRACT = {
  type: 'object',
  properties: {
    profileId: { type: ['string', 'null'] },
    harness: { type: ['string', 'null'] },
    sessionId: { type: ['string', 'null'] },
    requestedModel: { type: ['string', 'null'] },
    actualModel: { type: ['string', 'null'] },
    provider: { type: ['string', 'null'] },
    effort: { type: ['string', 'null'] },
    attempt: { type: 'integer' },
    visitCount: { type: 'integer' },
    startedAt: { type: ['string', 'null'] },
    endedAt: { type: ['string', 'null'] },
    usage: { type: ['array', 'null'] },
  },
  required: ['attempt', 'visitCount'],
};
export * from './budgets.js';
export * from './resultValidation.js';
export * from './resultRules.js';
export * from './workHolds.js';
export * from './externalInput.js';
import { resultRulesSchema, resultRuleProblems } from './resultRules.js';
export * from './assignmentSize.js';
export * from './contextContinuity.js';
export * from './modelTiers.js';
export * from './providerDiversity.js';
export * from './trialEnvironments.js';
export * from './authoringLayout.js';
import { modelTierSchema } from './modelTiers.js';
import { continuityGroupSchema } from './contextContinuity.js';
import Ajv, { type ValidateFunction } from 'ajv';
import { bindingLeaves } from './valueBindings.js';
import {
  variableReferenceSchema,
  scriptEnvironmentSchema,
  validateVariableReferences,
  checkVariableDelivery,
} from './variables.js';
export * from './variables.js';
export {
  bindingLeaves,
  resolveBindingFields,
  resolveValueBinding,
  type PathBinding,
} from './valueBindings.js';
import { validateFetch, type FetchRequest } from './fetch.js';
export {
  resolveFetch,
  validateFetch,
  type FetchNode,
  type FetchBinding,
  type FetchField,
  type FetchRequest,
} from './fetch.js';
import { validateBatchScopes } from './batchScopes.js';
import { isStartedRunSchema } from './workflowMode.js';
export { STARTED_RUN_SCHEMA, isStartedRunSchema } from './workflowMode.js';
export {
  FAILURE_ROUTE_SCHEMA,
  WORKFLOW_FAILURE_ROUTE_SCHEMA,
  failureRouteContract,
  type FailureCategory,
} from './failureRoute.js';
export { validateBatchScopes } from './batchScopes.js';

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
  tier: modelTierSchema.optional(),
  continuityGroup: continuityGroupSchema.optional(),
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
const fetchHeaderSchema = z.object({
  name: z.string(),
  value: z.discriminatedUnion('kind', [
    ...fetchBindingSchema.options,
    variableReferenceSchema,
  ]),
});
const fetchRequestFields = {
  url: z.string(),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    .default('GET'),
  query: z.array(fetchFieldSchema).default([]),
  headers: z.array(fetchHeaderSchema).default([]),
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
};
export type ValueBinding =
  | {
      source: 'input' | 'runInput' | 'rootInput' | 'itemInput';
      path: string;
      default?: Json;
    }
  | {
      source: 'node';
      nodeId: string;
      path: string;
      default?: Json;
      sourceDefault?: Json;
    }
  | {
      source: 'execution';
      nodeId: string;
      path: string;
      default?: Json;
      sourceDefault?: Json;
    }
  | { source: 'literal'; value: Json }
  | { source: 'object'; fields: Record<string, ValueBinding> };
export type ValueBindingInput =
  | {
      source: 'input' | 'runInput' | 'rootInput' | 'itemInput';
      path?: string;
      default?: Json;
    }
  | {
      source: 'node';
      nodeId: string;
      path?: string;
      default?: Json;
      sourceDefault?: Json;
    }
  | {
      source: 'execution';
      nodeId: string;
      path?: string;
      default?: Json;
      sourceDefault?: Json;
    }
  | { source: 'literal'; value: Json }
  | { source: 'object'; fields: Record<string, ValueBindingInput> };
export const valueBindingSchema: z.ZodType<
  ValueBinding,
  z.ZodTypeDef,
  ValueBindingInput
> = z.lazy(() =>
  z.discriminatedUnion('source', [
    z.object({
      source: z.enum(['input', 'runInput', 'rootInput', 'itemInput']),
      path: z.string().default(''),
      default: jsonSchema.optional(),
    }),
    z.object({
      source: z.literal('node'),
      nodeId: z.string().min(1),
      path: z.string().default(''),
      default: jsonSchema.optional(),
      sourceDefault: jsonSchema.optional(),
    }),
    z.object({
      source: z.literal('execution'),
      nodeId: z.string().min(1),
      path: z.string().default(''),
      default: jsonSchema.optional(),
      sourceDefault: jsonSchema.optional(),
    }),
    z.object({ source: z.literal('literal'), value: jsonSchema }),
    z.object({
      source: z.literal('object'),
      fields: z.record(valueBindingSchema),
    }),
  ]),
);
export const valueBindingsSchema = z
  .record(valueBindingSchema)
  .superRefine((fields, context) => {
    try {
      bindingLeaves(fields);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid bindings',
      });
    }
  });
export const cwdBindingSchema = z.union([
  z.string().min(1),
  valueBindingSchema,
]);
export type CwdBinding = z.infer<typeof cwdBindingSchema>;
/** A probe a polling Wait runs on the server with a short request or process timeout. */
const pollCheckShapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('script'),
    // Omitted language runs as Bash, like Script nodes saved before JavaScript existed.
    language: z.enum(['javascript', 'bash']).optional(),
    command: z.string().min(1),
    environment: scriptEnvironmentSchema.optional(),
    cwd: cwdBindingSchema
      .optional()
      .describe(
        'Working directory or dynamic binding for this polling check. Overrides workflow cwd.',
      ),
    timeoutMs: z.number().int().min(100).max(120000).default(30000),
  }),
  z.object({ kind: z.literal('fetch'), ...fetchRequestFields }),
]);
export type PollCheck = z.infer<typeof pollCheckSchema>;
export const pollCheckSchema = z.preprocess(
  checkVariableDelivery,
  pollCheckShapeSchema,
);
export const routingSchema = z.object({
  path: z.string(),
  cases: z.array(z.object({ port: z.string(), equals: jsonSchema })),
  default: z.string().optional(),
});
export const resourceBindingsSchema = z.array(valueBindingSchema).max(8);
const nodeBase = {
  runStallMs: stallFields.runStallMs,
  id: z.string().min(1),
  label: z.string().min(1),
  stage: z.string().trim().min(1).max(200).optional(),
  batchId: z.string().min(1).optional(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  inputSchema: contractSchema.default({}),
  outputSchema: contractSchema.default({}),
  inputBindings: valueBindingsSchema
    .optional()
    .describe(
      'Replace input fields from input, runInput, rootInput, itemInput, node (same-scope completed output), literal {value}, or object {fields}. Blank paths select the source. default covers missing paths; node sourceDefault covers absent completed output. Keys stay literal; use object for nesting (max 10 levels). Original inputs remain immutable.',
    ),
  outputBindings: valueBindingsSchema
    .optional()
    .describe(
      'Optional forwarded output fields after result validation and routing. Same bindings; input selects the raw operation result. Raw result remains inspectable; omission forwards it unchanged.',
    ),
  routing: routingSchema
    .optional()
    .describe(
      'Optional success-result branches for Agent, Script, Fetch or waited Workflow. Match raw validated result before outputBindings; same Switch first-match/fallback semantics. Missing path or unmatched without default fails. Failure/timeout routes remain separate.',
    ),
};
export const MAX_SCRIPT_TIMEOUT_MS = 3_600_000;
export const DEFAULT_BATCH_MAX_ITEMS = 200;
export const MAX_BATCH_ITEMS = 10_000;
const onFailureSchema = z
  .enum(['fail', 'route'])
  .optional()
  .describe(
    'Omit or use fail to stop the run. route requires a failed edge and all configured success routes (default without result routing). Failed receives {input, error: {nodeId, executionId, kind: script|fetch, category: execution|http|output, message}, output}. input is the resolved operation input; output is returned JSON or null if unavailable. The success outputSchema does not apply to Failed; its destination validates the envelope. Only operation errors, rejected HTTP statuses and output-contract failures route. Input/request validation, cancellation, step limits, result-routing/output-mapping errors and uncertain interruptions remain terminal. Background Scripts recover authenticated outcomes after restart; foreground interruptions remain terminal. No automatic retry.',
  );

const nodeShapeSchema = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase, kind: z.literal('entry') }),
  z.object({
    ...nodeBase,
    kind: z.literal('exit'),
    continueAsNew: continueAsNewSchema
      .optional()
      .describe(
        'Standalone rollover using Exit input; same version and captured prompts. Chain budgets persist. No final output.',
      ),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('agent'),
    unclaimedStallMs: stallFields.unclaimedStallMs,
    claimedIdleStallMs: stallFields.claimedIdleStallMs,
    idleRecovery: idleRecoverySchema.nullable().optional(),
    maxExecutionMs: activeClockMsSchema
      .optional()
      .describe(
        'Maximum total active wall-clock duration per claim attempt, independent of renewals. Pauses and declared holds are excluded.',
      ),
    cwd: cwdBindingSchema
      .optional()
      .describe(
        'Working directory or dynamic binding for this Agent node. Overrides workflow cwd.',
      ),
    executor: executorReferenceSchema
      .nullable()
      .optional()
      .describe(
        'Local executor profile override. Omit to inherit the workflow default; null keeps connected-agent execution.',
      ),
    model: executorModelSchema
      .optional()
      .describe(
        'Managed model override; omission inherits workflow/harness defaults. Connected agents ignore it.',
      ),
    effort: executorEffortSchema
      .nullable()
      .optional()
      .describe(
        'Managed effort override; omit to inherit, null for native default. Use levels reported for the effective model.',
      ),
    resources: resourceBindingsSchema
      .optional()
      .describe(
        'Exclusive library-wide resource names, resolved from existing value bindings at assignment creation. Each must resolve to a distinct nonblank string of at most 120 characters. Cooperating Agent and deterministic steps only; no OS isolation.',
      ),
    resultRules: resultRulesSchema.optional(),
    prompt: z.string(),
    promptIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Ordered saved prompt IDs. Latest content is captured at ordinary workflow startup; Batch items inherit, invoked workflows capture independently. Comparisons use selected side captures.',
      ),
    context: contextPolicySchema.default({}),
    maxAttempts: z.number().int().min(1).max(10).default(2),
    maxLeaseExpiries: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(
        'Separate lease-expiry budget. When set, maxAttempts limits explicit failures and this budget limits expiries. Reaching either limit fails the run. Omission uses maxAttempts for both failures and expiries.',
      ),
    leaseSeconds: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .optional()
      .describe(
        'Claim duration in seconds. An explicit claim override wins; omission uses this published node setting, then 300 seconds. Workers must renew before expiry. Expiry consumes the separate maxLeaseExpiries budget when configured, otherwise the combined maxAttempts budget.',
      ),
    unclaimedTimeoutMs: z.number().int().min(1).max(31_536_000_000).optional(),
    distinctProviderFrom: z.array(z.string().min(1)).optional(),
    candidateModels: z.array(z.string().min(1)).optional(),
    continueOnMissingResult: continueOnMissingResultSchema.optional(),
    transientRetry: transientRetrySchema.optional(),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('script'),
    resources: resourceBindingsSchema.optional(),
    cwd: cwdBindingSchema
      .optional()
      .describe(
        'Working directory or dynamic binding for this Script node. Overrides workflow cwd.',
      ),
    onFailure: onFailureSchema,
    executionMode: z
      .enum(['foreground', 'background'])
      .optional()
      .describe(
        'Background opts into local supervision across server restarts. Uncertain outcomes require explicit stopped reconciliation before retry. Polling checks remain foreground.',
      ),
    environment: scriptEnvironmentSchema.optional(),
    // Older saved nodes omit language and must continue to run as Bash.
    language: z.enum(['javascript', 'bash']).optional(),
    command: z.string().min(1),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(MAX_SCRIPT_TIMEOUT_MS)
      .default(60_000),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('fetch'),
    resources: resourceBindingsSchema.optional(),
    onFailure: onFailureSchema,
    outputSchema: contractSchema.default({
      type: 'object',
      required: ['status', 'headers', 'body'],
      properties: {
        status: { type: 'integer' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: {},
      },
    }),
    ...fetchRequestFields,
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('input'),
    humanWaitStallMs: stallFields.humanWaitStallMs,
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('wait'),
    resources: resourceBindingsSchema.optional(),
    timing: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('duration'),
          ms: z.number().int().min(0).max(31_536_000_000),
        }),
        z.object({ kind: z.literal('until'), path: z.string() }),
        z.object({
          kind: z.literal('poll'),
          everyMs: z
            .number()
            .int()
            .min(1000)
            .max(31_536_000_000)
            .default(60_000),
          timeoutMs: z.number().int().min(1).max(31_536_000_000).optional(),
          check: pollCheckSchema,
          path: z.string(),
          equals: jsonSchema,
        }),
      ])
      .default({ kind: 'duration', ms: 60_000 }),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('condition'),
    path: z.string(),
    equals: jsonSchema,
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('switch'),
    path: z.string(),
    cases: z.array(z.object({ port: z.string(), equals: jsonSchema })),
    default: z.string().optional(),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('workflow'),
    onFailure: onFailureSchema.describe(
      'Waited calls only: route requires a failed edge and all configured success edges (default without result routing). Failed receives {input,error:{nodeId,executionId,kind:workflow,category:child|output,message,child:{runId,workflowId,version,executionId}},output}. Child failure or rejected successful output routes; caller input/dispatch errors, cancellation and persistence errors stay terminal. No automatic retry.',
    ),
    mode: z.enum(['wait', 'detached']).optional(),
    workflowId: z.string().min(1),
    version: z.number().int().positive().nullable(),
  }),
  z.object({
    ...nodeBase,
    kind: z.literal('batch'),
    itemsPath: z.string().default(''),
    concurrency: z.number().int().min(1).max(50).default(5),
    // Omission preserves existing definitions without rewriting published versions.
    maxItems: z.number().int().min(1).max(MAX_BATCH_ITEMS).optional(),
    failurePolicy: z.enum(['all', 'collect']).default('all'),
  }),
]);
export const nodeSchema = z.preprocess(checkVariableDelivery, nodeShapeSchema);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export const definitionSchema = z.object({
  ...stallFields,
  idleRecovery: idleRecoverySchema.nullable().optional(),
  cwd: cwdBindingSchema
    .optional()
    .describe(
      'Default working directory or dynamic binding for nodes in this workflow. Node cwd overrides it.',
    ),
  agentModel: executorModelSchema
    .optional()
    .describe(
      'Default model ID for managed Agents in this workflow. Node model overrides it; omission inherits each harness default. Connected agents keep their own model; explicit model refusals require a replacement selection; no automatic substitution.',
    ),
  agentEffort: executorEffortSchema
    .nullable()
    .optional()
    .describe(
      'Managed effort default; Agent effort overrides it. Omit to inherit the harness; null uses native defaults.',
    ),
  agentPermissions: executorPermissionModeSchema
    .optional()
    .describe(
      'Permission override for managed Agent execution. Omit to use each selected harness default. Connected agents retain their own permissions.',
    ),
  executor: executorReferenceSchema
    .optional()
    .describe(
      'Default local executor profile for Agent nodes. Omission preserves connected-agent execution. Configuration and credentials stay local.',
    ),
  continueOnMissingResult: continueOnMissingResultSchema.optional(),
  transientRetry: transientRetrySchema.optional(),
  inputSchema: contractSchema.default({}),
  outputSchema: contractSchema.default({}),
  nodes: z.array(nodeSchema).min(2),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      port: z.string().min(1).default('default'),
      targetHandle: z.enum(['default', 'end']).optional(),
    }),
  ),
  maxActiveRuns: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .describe(
      'Admitted workflow run cap. Batch items and excluded stages do not count. Omit for no cap.',
    ),
  excludeStages: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .optional()
    .describe(
      'Projected stages excluded from start capacity. Admitted runs continue across stages.',
    ),
  maxSteps: z.number().int().min(2).max(1000).default(100),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type WorkflowEdge = WorkflowDefinition['edges'][number];
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
export interface Workflow {
  id: string;
  ownerWorkflowId?: string | null;
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
  'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export const runQuerySchema = z.object({
  requestId: startRequestIdSchema.optional(),
  externalTask: externalTaskIdentitySchema.optional(),
  chainRootRunId: z.string().min(1).optional(),
  workflowId: z.string().optional(),
  status: z
    .enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'])
    .optional(),
  rootOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(50),
  inputMatch: z.object({ path: z.string(), equals: jsonSchema }).optional(),
});
export type RunQuery = z.infer<typeof runQuerySchema>;
export const runSummaryQuerySchema = runQuerySchema
  .pick({ workflowId: true, status: true })
  .extend({
    tab: z.enum(['active', 'attention', 'history']).optional(),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  });
export type RunSummaryQuery = z.infer<typeof runSummaryQuerySchema>;
export interface NodeExecution {
  id: string;
  nodeId: string;
  kind: WorkflowNode['kind'];
  label: string;
  input: Json;
  originalInput?: Json;
  output?: Json;
  /** Raw validated operation result when outputBindings shape the forwarded output. */
  result?: Json;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  resources?: string[];
  resourceAttempt?: number;
  resourceActive?: boolean;
  resourceBlocked?: import('./workResources.js').ResourceBlock;
  operationStartedAt?: string;
  error?: string;
  childRunIds: string[];
  nextItem: number;
  /** Script or Wait attempt within a single visit. Omission means the first attempt. */
  attempt?: number;
  retryChildRunIds?: string[];
  request?: FetchRequest;
  background?: import('./backgroundScripts.js').BackgroundScript;
  externalInput?: import('./externalInput.js').ExternalInputMetadata;
  resumeAt?: string;
  /** Polling Wait: when the next check runs, the deadline, and the latest check. */
  nextCheckAt?: string;
  timeoutAt?: string;
  check?: PollCheckResult;
  port?: WorkflowEdge['port'];
  resolvedCwd?: string;
  provenance?: ExecutionProvenance;
}
export interface PollCheckResult {
  count: number;
  at: string;
  output?: Json;
  error?: string;
}
export interface Run {
  schedule?: {
    triggerId: string;
    scheduledAt: string;
    waitForPrevious: boolean;
    previousRunIds: string[];
  };
  admission?: import('./runStarts.js').RunAdmission;
  startRequestId?: string;
  externalTask?: import('./runStarts.js').ExternalTask;
  chain?: import('./runChains.js').RunChainLink;
  contextRevision?: number;
  externalInputHold?: import('./externalInput.js').ExternalInputHold;
  budgetRevision?: number;
  comparison?: import('./testbench.js').ComparisonRunContext;
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  parentRunId?: string;
  parentMode?: 'detached';
  parentExecutionId?: string;
  // Item runs execute members of this Batch in the same published graph.
  batchNodeId?: string;
  batchItemIndex?: number;
  /** Attempt reserved for a Script or Wait step by explicit retry. */
  nextScriptAttempt?: number;
  status: RunStatus;
  input: Json;
  output?: Json;
  error?: string;
  cursor: string;
  value: Json;
  executions: NodeExecution[];
  createdAt: string;
  updatedAt: string;
  promptSnapshots?: import('./prompts.js').PromptSnapshot[];
  variableCaptures?: import('./variables.js').VariableCapture[];
}
export type RunSummary = Pick<
  Run,
  | 'id'
  | 'workflowId'
  | 'workflowName'
  | 'version'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'parentRunId'
  | 'parentMode'
  | 'parentExecutionId'
  | 'comparison'
  | 'startRequestId'
  | 'externalTask'
> & {
  executionCount: number;
  parentWorkflowName?: string;
  waitReason?:
    | 'held'
    | 'agent'
    | 'managed'
    | 'claimed'
    | 'external_input'
    | 'external_review'
    | 'timer'
    | 'child';
};
export interface RunAncestry {
  workflowId: string;
  parentRunId?: string;
  parentMode?: 'detached';
  rootRunId: string;
  rootWorkflowId: string;
}
export interface WorkRequest {
  maxExecutionMs?: number;
  claimedAt?: string;
  lastActivityAt?: string;
  availableSince?: string;
  idleRecoveryCount?: number;
  idleNudge?: { attempt: number; activityAt: string; at: string };
  executor?: string;
  executorPermissions?: import('./executors.js').ExecutorPermissionMode;
  executorModel?: string;
  executorModelSource?: 'node' | 'workflow';
  executorEffort?: string | null;
  executorEffortSource?: 'node' | 'workflow';
  managedExecution?: import('./executors.js').ManagedWorkSummary;
  resources?: string[];
  resourceBlocked?: import('./workResources.js').ResourceBlock;
  resourceReservations?: import('./workResources.js').ResourceOwner[]; // Derived inspection, not stored.
  resolvedCwd?: string;
  cwdBlocked?: { reason: string; path?: string };

  trialEnvironment?: import('./trialEnvironments.js').TrialWorkContext;
  hold?: import('./workHolds.js').WorkHold;
  holdRevision?: number;
  endedAt?: string;
  heldClaimCount?: number;
  // Internal idempotency fingerprint, never exposed to executors.
  holdReceipt?: string;
  // Derived bounded inspection only, not stored with the assignment.
  holdHistory?: import('./workHolds.js').WorkHoldHistory;
  resultRules?: import('./resultRules.js').ResultRule[];
  modelSelection?: import('./modelTiers.js').ModelSelection;
  continuity?: import('./contextContinuity.js').ContextContinuity;
  distinctProviderFrom?: string[];
  candidateModels?: string[];
  providerDiversityBlocked?: import('./providerDiversity.js').ProviderDiversityBlock;
  pauseBlocked?: import('./pauseHolds.js').PauseBlock;
  budgetBlocked?: import('./budgets.js').BudgetBlock;
  id: string;
  runId: string;
  executionId: string;
  nodeId: string;
  label: string;
  prompt: string;
  savedPrompts?: import('./prompts.js').PromptSnapshot[];
  executionInstructions?: string;
  input: Json;
  context: ContextPolicy;
  outputSchema: Record<string, unknown>;
  status:
    | 'available'
    | 'held'
    | 'claimed'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';
  availableUntil?: string;
  attempt: number;
  maxAttempts: number;
  maxLeaseExpiries?: number;
  failureCount?: number;
  leaseExpiryCount?: number;
  // Internal diagnostic receipts, excluded from external work responses.
  expiredClaims?: { tokenHash: string; expiredAt: string; attempt: number }[];
  workerId?: string;
  token?: string;
  leaseUntil?: string;
  // Optional default captured from the published Agent node.
  leaseSeconds?: number;
  // Duration established by the current claim, reused by omitted renewals.
  claimLeaseSeconds?: number;
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
  stage?: string | null;
  waiting?: import('./runProjection.js').RunWaiting | null;
  actor?: import('./runProjection.js').RunProjection['actor'];
}
export class InterlockError extends Error {}
export class ExternalInputConflict extends InterlockError {}
export class ResultRejection extends InterlockError {
  constructor(
    readonly resultCheck: import('./resultValidation.js').ResultCheck,
    detail = '',
  ) {
    super(
      `Agent result rejected (${resultCheck.code}). No result accepted by this call. ${resultCheck.code === 'completed_conflict' ? 'A different result was already accepted. ' : resultCheck.code === 'invalid_claim' ? 'Claim token does not match. ' : ''}Claim ${resultCheck.claimUsable ? 'remains usable' : 'is not usable'}. Next: ${resultCheck.nextAction}. ${resultCheck.diagnostics.items.map((d) => `${d.path || '/'}: ${d.message}`).join(' ')} ${detail.slice(0, 2048)}`,
    );
  }
}
const ajv = new Ajv({ allErrors: true, strict: false });
const externalInputContracts = new Ajv({
  allErrors: true,
  strict: false,
  ownProperties: true,
});
const propertiesKeyword = externalInputContracts.getKeyword('properties');
if (
  !propertiesKeyword ||
  propertiesKeyword === true ||
  !('code' in propertiesKeyword)
)
  throw new Error('AJV properties validator is unavailable');
const generateProperties = propertiesKeyword.code;
// Fail closed when AJV would skip this name, including inside resolved refs.
externalInputContracts.removeKeyword('properties').addKeyword({
  ...propertiesKeyword,
  code(context, ruleType) {
    if (Object.hasOwn(context.schema, '__proto__'))
      throw new InterlockError(
        'Use patternProperties with "^__proto__$" to constrain the "__proto__" field in a submitted value',
      );
    generateProperties(context, ruleType);
  },
});

function compileExternalInputContract(schema: Record<string, unknown>) {
  if (schema.$async === true)
    throw new InterlockError(
      'Submitted-value contracts must validate synchronously',
    );
  return externalInputContracts.compile(schema);
}

export function validateContractSchema(schema: Record<string, unknown>) {
  contractSchema.parse(schema);
  ajv.compile(schema);
}
export function assertContract(
  schema: Record<string, unknown>,
  value: Json,
  label: string,
) {
  assertContractValue(ajv.compile(schema), value, label);
}
export function assertExternalInputContract(
  schema: Record<string, unknown>,
  value: Json,
  label: string,
) {
  assertContractValue(compileExternalInputContract(schema), value, label);
}
function assertContractValue(
  validate: ValidateFunction,
  value: Json,
  label: string,
) {
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
export { readPath } from './dataPath.js';
export function supportsResultRouting(node: WorkflowNode): boolean {
  return (
    ['agent', 'script', 'fetch'].includes(node.kind) ||
    (node.kind === 'workflow' && node.mode !== 'detached')
  );
}
export function outgoingPorts(node: WorkflowNode): WorkflowEdge['port'][] {
  if (node.kind === 'exit') return [];
  if (node.kind === 'condition') return ['true', 'false'];
  if (node.kind === 'batch') return ['item', 'complete'];
  const routes = node.kind === 'switch' ? node : node.routing;
  const ports = routes
    ? [
        ...routes.cases.map((c) => c.port),
        ...(routes.default === undefined ? [] : [routes.default]),
      ]
    : ['default'];
  return [
    ...ports,
    ...(hasFailureRoute(node) ? ['failed'] : []),
    ...(hasTimeoutRoute(node) ? ['timeout'] : []),
  ];
}
export function hasFailureRoute(node: WorkflowNode): boolean {
  return (
    (node.kind === 'script' ||
      node.kind === 'fetch' ||
      (node.kind === 'workflow' && node.mode !== 'detached')) &&
    node.onFailure === 'route'
  );
}
export type PollWaitNode = Extract<WorkflowNode, { kind: 'wait' }> & {
  timing: Extract<
    Extract<WorkflowNode, { kind: 'wait' }>['timing'],
    { kind: 'poll' }
  >;
};
/** A Wait that re-runs a check until its result matches, instead of waiting for a clock. */
export function isPollWait(node: WorkflowNode): node is PollWaitNode {
  return node.kind === 'wait' && node.timing.kind === 'poll';
}
/** Whether a node's `timeout` route carries its original input instead of a result. */
export function hasTimeoutRoute(node: WorkflowNode): boolean {
  return (
    (node.kind === 'agent' && node.unclaimedTimeoutMs !== undefined) ||
    (isPollWait(node) && node.timing.timeoutMs !== undefined)
  );
}

export function validateDefinition(input: unknown): WorkflowDefinition {
  const d = definitionSchema.parse(input);
  validateVariableReferences(d);
  for (const node of d.nodes)
    if (
      node.kind === 'agent' &&
      node.context.mode === 'fresh' &&
      node.context.continuityGroup
    )
      throw new InterlockError(
        `${node.label}: fresh context cannot use a continuity group`,
      );
  for (const node of d.nodes) {
    if (node.kind === 'agent' && node.distinctProviderFrom) {
      for (const upstreamId of node.distinctProviderFrom) {
        if (upstreamId === node.id) {
          throw new InterlockError(
            `${node.label}: distinctProviderFrom cannot reference itself`,
          );
        }
        if (!d.nodes.some((n) => n.id === upstreamId)) {
          throw new InterlockError(
            `${node.label}: distinctProviderFrom references unknown node "${upstreamId}"`,
          );
        }
      }
    }
  }
  for (const node of d.nodes)
    if (
      node.kind === 'agent' &&
      new Set(node.promptIds).size !== (node.promptIds?.length ?? 0)
    )
      throw new InterlockError(
        `${node.label}: saved prompt IDs must be unique`,
      );
  for (const node of d.nodes) {
    if (node.kind === 'exit' && node.continueAsNew && node.batchId)
      throw new InterlockError('Continue as new is unavailable inside a Batch');
    if (node.kind !== 'agent') continue;
    const problems = resultRuleProblems(
      node.resultRules,
      node.inputSchema,
      node.outputSchema,
    );
    if (problems.length)
      throw new InterlockError(`${node.label}: ${problems.join('; ')}`);
  }
  const ids = new Set(d.nodes.map((n) => n.id));
  const chainLimits = new Set(
    d.nodes.flatMap((n) =>
      n.kind === 'exit' && n.continueAsNew ? [n.continueAsNew.maxRuns] : [],
    ),
  );
  if (chainLimits.size > 1)
    throw new InterlockError('Continuing Exits must use the same maxRuns');
  if (ids.size !== d.nodes.length)
    throw new InterlockError('Node IDs must be unique');
  if (new Set(d.edges.map((e) => e.id)).size !== d.edges.length)
    throw new InterlockError('Edge IDs must be unique');
  const entries = d.nodes.filter((n) => n.kind === 'entry');
  if (entries.length !== 1)
    throw new InterlockError('A workflow needs exactly one entry');
  if (!d.nodes.some((n) => n.kind === 'exit'))
    throw new InterlockError('A workflow needs an exit');
  ajv.compile(d.inputSchema);
  ajv.compile(d.outputSchema);
  for (const node of d.nodes) {
    ajv.compile(node.inputSchema);
    if (node.kind === 'input') compileExternalInputContract(node.outputSchema);
    else ajv.compile(node.outputSchema);
  }
  for (const edge of d.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new InterlockError('Edge references a missing node');
    if (edge.target === entries[0].id)
      throw new InterlockError('Edges cannot target the entry');
  }
  for (const node of d.nodes) {
    const resourceBindings =
      'resources' in node
        ? Object.fromEntries(
            (node.resources ?? []).map((b, i) => [String(i), b]),
          )
        : {};
    if ('resources' in node && node.resources?.length) {
      if (node.kind === 'wait' && !isPollWait(node))
        throw new InterlockError(
          `${node.label}: only polling Waits support resources`,
        );
      if (node.resources.some((b) => b.source === 'object'))
        throw new InterlockError(
          `${node.label}: resource bindings must resolve to names, not objects`,
        );
      const literals = node.resources.filter((b) => b.source === 'literal');
      if (literals.length) {
        const checked = resourceNamesSchema.safeParse(
          literals.map((b) => b.value),
        );
        if (!checked.success)
          throw new InterlockError(
            `${node.label}: invalid resource names: ${checked.error.issues[0].message}`,
          );
      }
    }
    if (node.inputBindings && (node.kind === 'entry' || node.kind === 'exit'))
      throw new InterlockError(
        'Entry and Exit cannot replace their input with bindings',
      );
    if (
      !node.batchId &&
      [
        ...bindingLeaves(node.inputBindings ?? {}),
        ...bindingLeaves(node.outputBindings ?? {}),
        ...bindingLeaves(resourceBindings),
      ].some((binding) => binding.source === 'itemInput')
    )
      throw new InterlockError('itemInput bindings require Batch membership');
    for (const binding of [
      ...bindingLeaves(node.inputBindings ?? {}),
      ...bindingLeaves(node.outputBindings ?? {}),
      ...bindingLeaves(resourceBindings),
    ]) {
      if (binding.source !== 'node' && binding.source !== 'execution') continue;
      const target = d.nodes.find(
        (candidate) => candidate.id === binding.nodeId,
      );
      if (!target || target.kind === 'entry' || target.kind === 'exit')
        throw new InterlockError(
          `${node.label}: ${binding.source === 'execution' ? 'execution' : 'node'} binding must reference an existing non-Entry/Exit node`,
        );
      if (target.batchId !== node.batchId)
        throw new InterlockError(
          `${node.label}: ${binding.source === 'execution' ? 'execution' : 'node'} binding must reference a node in the same execution scope`,
        );
    }
    if (
      node.kind === 'workflow' &&
      node.mode === 'detached' &&
      node.onFailure === 'route'
    )
      throw new InterlockError(
        `${node.label}: detached Workflow calls cannot route child failures`,
      );
    if (node.kind === 'workflow' && node.version === null)
      throw new InterlockError(
        `${node.label}: publish the referenced workflow and select a version first`,
      );
    if (
      node.kind === 'workflow' &&
      node.mode === 'detached' &&
      !isStartedRunSchema(node.outputSchema)
    )
      throw new InterlockError(
        `${node.label}: Start and continue uses the fixed Started run output contract. Omit outputSchema or use the runId, workflowId, and version contract.`,
      );
    if (node.kind === 'fetch') validateFetch(node);
    if (isPollWait(node) && node.timing.check.kind === 'fetch')
      validateFetch(node.timing.check);
    if (
      node.kind === 'batch' &&
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
    const expected = outgoingPorts(node);
    if (node.routing && !supportsResultRouting(node))
      throw new InterlockError(
        `${node.label}: result routing requires an Agent, Script, Fetch or waited Workflow`,
      );
    if (node.outputBindings && !supportsResultRouting(node))
      throw new InterlockError(
        `${node.label}: output bindings require an Agent, Script, Fetch or waited Workflow`,
      );
    if (node.kind === 'switch' || node.routing) {
      if (expected.some((port) => !port.trim()))
        throw new InterlockError(
          `${node.label}: Switch port names must not be blank`,
        );
      if (new Set(expected).size !== expected.length)
        throw new InterlockError(
          `${node.label}: Switch case and default port names must be unique`,
        );
    }
    if (
      outgoing.length !== expected.length ||
      expected.some((p) => outgoing.filter((e) => e.port === p).length !== 1)
    )
      throw new InterlockError(
        `${node.label}: expected outgoing routes ${expected.join(', ') || 'none'}`,
      );
  }
  validateBatchScopes(d);
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
export {
  contractAtPath,
  contractPaths,
  nodeInputHint,
  nodeOutputContract,
  type InputHint,
} from './inputHints.js';

export function nodeKindLabel(kind: WorkflowNode['kind']): string {
  if (kind === 'input') return 'External input';
  return kind === 'switch' || kind === 'condition'
    ? 'Branch'
    : kind === 'batch'
      ? 'Batch'
      : kind;
}

/** Ownership restricts authoring references, independently of execution ancestry. */
export function validateWorkflowReferences(
  workflowId: string,
  definition: WorkflowDefinition,
  workflows: Workflow[],
) {
  for (const node of definition.nodes) {
    if (node.kind !== 'workflow') continue;
    const target = workflows.find((w) => w.id === node.workflowId);
    if (target?.ownerWorkflowId && target.ownerWorkflowId !== workflowId)
      throw new InterlockError(
        `${node.label}: only the owning workflow may reference "${target.name}"`,
      );
  }
}

export {
  workflowEditSchema,
  workflowEditsSchema,
  applyWorkflowEdits,
  draftChanges,
  type DraftChanges,
} from './workflowEdits.js';

export { diagnoseDraft, type DraftDiagnostic } from './draftDiagnostics.js';
export {
  versionReferenceSchema,
  versionSelectionSchema,
  versionDeletionSchema,
  deletedVersionSchema,
  type VersionReference,
  type DeletedWorkflowVersion,
} from './versionCleanup.js';
export {
  ownershipPreviewSchema,
  ownershipChangeSchema,
  type OwnershipPreviewInput,
  type OwnershipChangeInput,
} from './ownership.js';
export {
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
} from './continuation.js';
export {
  continuationLimitSchema,
  mutationDetailSchema,
  mutationSummarySchema,
  submissionSummarySchema,
} from './continuation.js';
export {
  promptContentSchema,
  savedPromptSchema,
  promptReadSchema,
  promptIds,
  snapshotPrompt,
  composePrompt,
  type SavedPrompt,
  type PromptSnapshot,
  type PromptContent,
  type PromptUsage,
} from './prompts.js';

export {
  testAssertionSchema,
  testCaseSchema,
  suiteContentSchema,
  createSuiteSchema,
  updateSuiteSchema,
  comparisonPreviewSchema,
  comparisonSideSchema,
  comparisonExecutorSchema,
  type ComparisonSideSelection,
  type ComparisonConfiguration,
  comparisonStartSchema,
  testbenchListSchema,
  comparisonReportSchema,
  comparisonCaseSchema,
  comparisonCancelSchema,
  qualityJudgmentSchema,
  testSuiteReadSchema,
  testSuiteSaveSchema,
  comparisonReadSchema,
  comparisonUpdateSchema,
  assertionProblems,
  evaluateAssertions,
  type TestAssertion,
  type SuiteContent,
  type CapturedCase,
  type TestSuite,
  type ComparisonRunContext,
  type CheckResult,
  type ComparisonSample,
  type ComparisonMeasurement,
  type ComparisonPin,
  type QualityJudgment,
  type WorkflowComparison,
} from './testbench.js';

export * from './authoring.js';
export * from './runHistory.js';
export {
  evaluationInputSchema,
  evaluationEvidenceSchema,
  evaluationReferenceSchema,
  evaluationGradeSchema,
  qualityRubricKey,
  type EvaluationReference,
  type EvaluationReceipt,
} from './evaluation.js';

export { nextCallSchema, withNextCall } from './continuation.js';
export * from './runProjection.js';

export * from './pauseHolds.js';

export * from './workflowTriggers.js';
