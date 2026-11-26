import { z } from 'zod';
import {
  stallFields,
  idleRecoverySchema,
  activeClockMsSchema,
} from './stalls.js';
import {
  executorPermissionModeSchema,
  executorModelSchema,
  executorEffortSchema,
  executorReferenceSchema,
  continueOnMissingResultSchema,
  transientRetrySchema,
} from './executors.js';
import { continueAsNewSchema } from './runChains.js';
import { humanInputSchema } from './humanInput.js';
import { resultRulesSchema } from './resultRules.js';
import { workspaceFields } from './workspaces.js';
import { modelTierSchema } from './modelTiers.js';
import { continuityGroupSchema } from './contextContinuity.js';
import { bindingLeaves } from './valueBindings.js';
import {
  variableReferenceSchema,
  scriptEnvironmentFields,
  checkVariableDelivery,
} from './variables.js';
import { parallelFields } from './parallelJoin.js';
import { toolEdgeFields } from './toolEdges.js';
import { jsonSchema, type Json } from './json.js';
import { contractSchema } from './contracts.js';
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
    ...scriptEnvironmentFields,
    cwd: cwdBindingSchema
      .optional()
      .describe('Working directory or binding; overrides workflow cwd.'),
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
const nodeData = {
  runStallMs: stallFields.runStallMs,
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  inputBindings: valueBindingsSchema
    .optional()
    .describe(
      'Bind literal keys from input, runInput, rootInput, itemInput, same-scope node/execution, literal or object. Blank paths select the source. default covers missing paths; sourceDefault covers absent executions.',
    ),
  outputBindings: valueBindingsSchema
    .optional()
    .describe(
      'Map forwarded fields after routing. input is the accepted raw result. Omit to forward unchanged.',
    ),
  routing: routingSchema
    .optional()
    .describe(
      'Route the accepted result before outputBindings. First match wins. Missing path or unmatched result without default fails.',
    ),
};
// Inline simple fields in discovered node variants. Repeated long JSON
// pointers are larger than these field schemas.
const nodeBase = () => ({
  ...nodeData,
  id: z.string().min(1),
  label: z.string().min(1),
  stage: z.string().trim().min(1).max(200).optional(),
  stageId: z.string().min(1).max(80).optional(),
  boardColumnId: z.string().min(1).max(80).optional(),
  batchId: z.string().min(1).optional(),
  parallelId: z.string().min(1).optional(),
  parallelBranchId: z.string().min(1).optional(),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
});
export const MAX_SCRIPT_TIMEOUT_MS = 3_600_000;
export const DEFAULT_BATCH_MAX_ITEMS = 200;
export const MAX_BATCH_ITEMS = 10_000;
const onFailureSchema = z
  .enum(['fail', 'route'])
  .optional()
  .describe(
    'Stop by default. route needs failed and success edges; Script, HTTP and output-contract failures send {input,error,output} (null output if absent). Validation, cancellation, limits, mapping and uncertain interruptions stay terminal. Only a Script with transientRetry retries automatically.',
  );

const nodeShapeSchema = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase(), kind: z.literal('entry') }),
  z.object({
    ...nodeBase(),
    kind: z.literal('exit'),
    continueAsNew: continueAsNewSchema
      .optional()
      .describe(
        'Standalone rollover using Exit input; same version and captured prompts. Chain budgets persist. No final output.',
      ),
  }),
  z.object({
    ...nodeBase(),
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
      .describe('Profile ID. Omit to inherit; null selects a connected agent.'),
    executorMode: z.enum(['harness', 'preset']).optional(),
    model: executorModelSchema
      .optional()
      .describe('Model ID or preset reference. Omit to inherit.'),
    effort: executorEffortSchema
      .nullable()
      .optional()
      .describe(
        'Managed effort override; omit to inherit, null for native default. Use levels reported for the effective model.',
      ),
    sessionNameTemplate: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe('Session name template.'),
    resources: resourceBindingsSchema
      .optional()
      .describe(
        'Exclusive library resource names: distinct nonblank strings up to 120 characters. Cooperative; no OS isolation.',
      ),
    resultRules: resultRulesSchema.optional(),
    prompt: z.string(),
    promptIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Ordered saved prompt IDs. Startup captures revisions; Batch and Parallel inherit; invoked workflows capture separately.',
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
        'Limits lease expiries separately from maxAttempts, which then counts explicit failures. Omit to share maxAttempts.',
      ),
    leaseSeconds: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .optional()
      .describe(
        'Claim duration in seconds. Claim override wins. Default 300. Expiry counts against maxLeaseExpiries or maxAttempts.',
      ),
    unclaimedTimeoutMs: z.number().int().min(1).max(31_536_000_000).optional(),
    continueOnMissingResult: continueOnMissingResultSchema.optional(),
    transientRetry: transientRetrySchema.optional(),
  }),
  z.object({
    ...nodeBase(),
    kind: z.literal('script'),
    resources: resourceBindingsSchema.optional(),
    cwd: cwdBindingSchema
      .optional()
      .describe('Working directory or binding; overrides workflow cwd.'),
    onFailure: onFailureSchema,
    executionMode: z
      .enum(['foreground', 'background'])
      .optional()
      .describe(
        'Background survives server restarts; uncertain outcomes need stopped reconciliation before retry.',
      ),
    transientRetry: transientRetrySchema
      .optional()
      .describe(
        'Foreground only. Retry an observed non-zero exit after an explicit signal, a recognized transient error, or one unclassified probe. Omit or set maxRetries 0 for no automatic retry.',
      ),
    ...scriptEnvironmentFields,
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
    ...nodeBase(),
    kind: z.literal('fetch'),
    resources: resourceBindingsSchema.optional(),
    blockPrivateNetwork: z.boolean().optional(),
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
    ...nodeBase(),
    kind: z.literal('input'),
    humanWaitStallMs: stallFields.humanWaitStallMs,
    humanInput: humanInputSchema.optional(),
  }),
  z.object({
    ...nodeBase(),
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
    ...nodeBase(),
    kind: z.literal('condition'),
    path: z.string(),
    equals: jsonSchema,
  }),
  z.object({
    ...nodeBase(),
    kind: z.literal('switch'),
    path: z.string(),
    cases: z.array(z.object({ port: z.string(), equals: jsonSchema })),
    default: z.string().optional(),
  }),
  z.object({
    ...nodeBase(),
    kind: z.literal('workflow'),
    onFailure: onFailureSchema.describe(
      'Waited calls only. route requires failed and success edges. Child and output-contract failures send {input,error,output}; error includes child IDs. Input, dispatch, cancellation and persistence stay terminal. No automatic retry.',
    ),
    mode: z.enum(['wait', 'detached']).optional(),
    workflowId: z.string().min(1),
    version: z.number().int().positive().nullable(),
  }),
  z.object({
    ...nodeBase(),
    kind: z.literal('batch'),
    itemsPath: z.string().default(''),
    concurrency: z.number().int().min(1).max(50).default(5),
    // Omission preserves existing definitions without rewriting published versions.
    maxItems: z.number().int().min(1).max(MAX_BATCH_ITEMS).optional(),
    failurePolicy: z.enum(['all', 'collect']).default('all'),
  }),
  z.object({
    ...nodeBase(),
    kind: z.literal('parallel'),
    ...parallelFields,
  }),
]);
export const nodeSchema = z.preprocess((value, ctx) => {
  if (
    value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'agent'
  )
    for (const field of ['distinctProviderFrom', 'candidateModels'])
      if (Object.hasOwn(value, field))
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            'Provider-diversity settings are no longer supported. Select a model or model alias instead.',
        });
  return checkVariableDelivery(value, ctx);
}, nodeShapeSchema);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export const definitionSchema = z.object({
  ...stallFields,
  idleRecovery: idleRecoverySchema.nullable().optional(),
  cwd: cwdBindingSchema
    .optional()
    .describe(
      'Default working directory or dynamic binding for nodes in this workflow. Node cwd overrides it.',
    ),
  ...workspaceFields,
  agentModel: executorModelSchema
    .optional()
    .describe(
      'Managed model default. Node model overrides it. Omit to inherit the harness.',
    ),
  agentModelMode: z.enum(['literal', 'preset']).optional(),
  agentEffort: executorEffortSchema
    .nullable()
    .optional()
    .describe(
      'Managed effort default; Agent effort overrides it. Omit to inherit the harness; null uses native defaults.',
    ),
  agentPermissions: executorPermissionModeSchema
    .optional()
    .describe(
      'Managed Agent permission override. Omit to inherit the harness.',
    ),
  executor: executorReferenceSchema
    .optional()
    .describe('Default local profile ID for Agent nodes.'),
  continueOnMissingResult: continueOnMissingResultSchema.optional(),
  transientRetry: transientRetrySchema.optional(),
  sessionNameTemplate: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .describe('Default session name template.'),
  inputSchema: contractSchema.default({}),
  outputSchema: contractSchema.default({}),
  nodes: z.array(nodeSchema).min(2),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      port: z.string().min(1).default('default'),
      targetHandle: z.enum(['default', 'end', 'join']).optional(),
      ...toolEdgeFields,
    }),
  ),
  maxActiveRuns: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .describe(
      'Admitted workflow run cap. Batch items, Parallel branches and excluded stages do not count. Omit for no cap.',
    ),
  excludeStages: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .optional()
    .describe(
      'Projected stages excluded from start capacity. Admitted runs continue across stages.',
    ),
  pinPromptsAtPublish: z
    .boolean()
    .optional()
    .describe(
      'Pin saved prompt revisions at publication. Runs use those revisions.',
    ),
  maxSteps: z
    .number()
    .int()
    .min(2)
    .max(1000)
    .default(100)
    .describe(
      'Run step limit. Parallel shares it. Batch items and invoked workflows have separate limits.',
    ),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type WorkflowEdge = WorkflowDefinition['edges'][number];
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
