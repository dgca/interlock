import { z } from 'zod';
import type { Json } from './index.js';
import {
  environmentModeSchema,
  environmentPassthroughSchema,
} from './environmentMode.js';

export const executorReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const executorPermissionModeSchema = z.enum([
  'read-only',
  'standard',
  'full-access',
]);
export type ExecutorPermissionMode = z.infer<
  typeof executorPermissionModeSchema
>;
export const executorModelSchema = z.string().trim().min(1).max(200);
export const executorEffortSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_-]*$/);
export const executorSettingSourceSchema = z.enum([
  'node',
  'workflow',
  'harness',
  'cli',
  'recovery',
]);
export const executorModelsQuerySchema = z
  .object({
    profileId: executorReferenceSchema,
    refresh: z.boolean().default(false),
    paths: z
      .object({
        command: z.string().trim().min(1).max(4096).optional(),
        cwd: z.string().trim().min(1).max(4096).optional(),
      })
      .strict()
      .optional()
      .describe('Optional unsaved executable/directory settings.'),
  })
  .strict();
export interface HarnessModel {
  id: string;
  name: string;
  description?: string;
  effortLevels?: string[];
  defaultEffort?: string;
}
export interface ExecutorModels {
  status: 'ready' | 'unavailable';
  models: HarnessModel[];
  truncated: boolean;
  message?: string;
}
export const executorConcurrencySchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .describe('Shared managed Agent assignment limit. null means Unlimited.');
export const allowedRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (val) => /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(val),
    'Path must be absolute',
  );
export const executorSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative().default(0),
    concurrency: executorConcurrencySchema.default(3),
    allowedRoots: z
      .array(allowedRootSchema)
      .optional()
      .describe(
        'Server-wide allowed root directories for dynamic cwd binding.',
      ),
    providerPrefixes: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional()
      .describe(
        'Model-name prefix overrides for provider attribution in execution provenance.',
      ),
  })
  .strict();
export const executorSettingsUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    concurrency: executorConcurrencySchema,
    allowedRoots: z
      .array(allowedRootSchema)
      .optional()
      .describe(
        'Server-wide allowed root directories for dynamic cwd binding.',
      ),
    providerPrefixes: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional()
      .describe(
        'Model-name prefix overrides for provider attribution in execution provenance.',
      ),
  })
  .strict();
export const harnessNameSchema = z.enum([
  'claude-code',
  'codex',
  'pi',
  'custom',
]);
export type HarnessName = z.infer<typeof harnessNameSchema>;

export const continueOnMissingResultSchema = z
  .object({
    maxTurns: z.number().int().min(0).max(10).default(0),
    message: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
export type ContinueOnMissingResult = z.infer<
  typeof continueOnMissingResultSchema
>;

export const transientRetrySchema = z
  .object({
    maxRetries: z.number().int().min(0).max(10).default(0),
    windowMs: z.number().int().min(0).max(86_400_000).default(300_000),
    initialBackoffMs: z.number().int().min(0).max(60_000).default(1000),
  })
  .strict();
export type TransientRetry = z.infer<typeof transientRetrySchema>;

export const errorClassSchema = z.enum([
  'transient',
  'permanent',
  'missing_result',
  'idle',
]);
export type ErrorClass = z.infer<typeof errorClassSchema>;

export const recoveryActionSchema = z.enum([
  'continue',
  'retry',
  'escalate',
  'fail',
  'nudge',
  'relaunch',
]);
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export const recoveryEventSchema = z
  .object({
    errorClass: errorClassSchema,
    messageExcerpt: z.string().max(500),
    action: recoveryActionSchema,
    at: z.string(),
  })
  .strict();
export type RecoveryEvent = z.infer<typeof recoveryEventSchema>;

export const executorProfileSchema = z
  .object({
    id: executorReferenceSchema,
    harness: harnessNameSchema,
    name: z.string().trim().min(1).max(120),
    concurrency: executorConcurrencySchema
      .optional()
      .describe(
        'Profile managed assignment cap alongside the global limit. Omit or null for no profile cap. Changes affect new dispatch only.',
      ),
    enabled: z.boolean().default(false),
    revision: z.number().int().min(0).default(0),
    command: z.string().trim().min(1).max(4096).optional(),
    cwd: z.string().trim().min(1).max(4096).optional(),
    allowedRoots: z
      .array(allowedRootSchema)
      .optional()
      .describe('Allowed root directories for dynamic cwd binding.'),
    provider: z.string().trim().min(1).max(200).optional(),
    model: executorModelSchema.optional().describe('Default model ID.'),
    effort: executorEffortSchema
      .nullable()
      .optional()
      .describe('Default effort for a selected model.'),
    tools: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    skills: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    permissions: z
      .enum(['ask', 'read-only', 'standard', 'full-access'])
      .default('standard')
      .transform((mode) => (mode === 'ask' ? 'standard' : mode))
      .describe(
        'Default managed permissions: standard, read-only, or full-access.',
      ),
    mode: z.enum(['direct', 'launcher']).optional(),
    transport: z.enum(['subprocess', 'http', 'pull']).optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    clientTimeoutSeconds: z
      .number()
      .int()
      .min(10)
      .max(3600)
      .optional()
      .describe('Pull client offline after this many seconds (60).'),
    env: z.record(z.string()).optional(),
    environmentMode: environmentModeSchema.optional(),
    environmentPassthrough: environmentPassthroughSchema
      .refine((names) => names.every((name) => /^[A-Za-z_]\w*$/.test(name)))
      .optional(),
    headers: z.record(z.string()).optional(),
    turnCommand: z.string().trim().min(1).max(4096).optional(),
    turnUrl: z.string().trim().min(1).max(4096).optional(),
    launchCommand: z.string().trim().min(1).max(4096).optional(),
    launchUrl: z.string().trim().min(1).max(4096).optional(),
    statusCommand: z.string().trim().min(1).max(4096).optional(),
    statusUrl: z.string().trim().min(1).max(4096).optional(),
    messageCommand: z.string().trim().min(1).max(4096).optional(),
    messageUrl: z.string().trim().min(1).max(4096).optional(),
    stopCommand: z.string().trim().min(1).max(4096).optional(),
    stopUrl: z.string().trim().min(1).max(4096).optional(),
    archiveCommand: z.string().trim().min(1).max(4096).optional(),
    archiveUrl: z.string().trim().min(1).max(4096).optional(),
    continueOnMissingResult: continueOnMissingResultSchema.optional(),
    transientRetry: transientRetrySchema.optional(),
    sessionNameTemplate: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe('Session name template.'),
    resumeCommandTemplate: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe('Resume command template.'),
    deepLinkTemplate: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe('Deep link URL template.'),
  })
  .strict();
export type ExecutorProfile = z.infer<typeof executorProfileSchema>;
export const executorProfileUpdateSchema = executorProfileSchema
  .extend({
    expectedRevision: z.number().int().min(0),
  })
  .omit({ revision: true });
export type ExecutorProfileUpdate = z.input<typeof executorProfileUpdateSchema>;
export type ExecutorState =
  | 'starting'
  | 'running'
  | 'needs_human'
  | 'needs_model'
  | 'completed'
  | 'failed'
  | 'interrupted';
export interface ExecutorQuestion {
  id: string;
  text: string;
  options?: string[];
  multiple?: boolean;
  allowOther?: boolean;
}
export interface ExecutorRequest {
  id: string;
  createdAt?: string;
  kind: 'permission' | 'question';
  title: string;
  detail: string;
  questions?: ExecutorQuestion[];
  state: 'pending' | 'answered' | 'cancelled';
  answer?: ExecutorAnswer;
}
export interface ExecutorAnswer {
  allow?: boolean;
  answers?: Record<string, string[]>;
}
export const executorResponseSchema = z
  .object({
    executionId: z.string().min(1),
    requestId: z.string().min(1),
    answer: z
      .object({
        allow: z.boolean().optional(),
        answers: z
          .record(z.array(z.string().max(4000)).min(1).max(20))
          .optional(),
      })
      .strict(),
  })
  .strict();
export const executorOperationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('transcript'),
      ...transcriptQueryBaseSchema.shape,
    })
    .strict(),
  z
    .object({ action: z.literal('message'), ...executorMessageSchema.shape })
    .strict(),
  z
    .object({
      action: z.literal('receipt'),
      ...messageReceiptQuerySchema.shape,
    })
    .strict(),
  z.object({ action: z.literal('settings') }).strict(),
  executorSettingsUpdateSchema.extend({ action: z.literal('save_settings') }),
  executorModelsQuerySchema.extend({ action: z.literal('models') }),
  z
    .object({ action: z.literal('list'), refresh: z.boolean().default(false) })
    .strict(),
  z
    .object({ action: z.literal('save'), profile: executorProfileUpdateSchema })
    .strict(),
  z
    .object({ action: z.literal('inspect'), workId: z.string().min(1) })
    .strict(),
  z
    .object({ action: z.literal('respond'), ...executorResponseSchema.shape })
    .strict(),
  z
    .object({ action: z.literal('stop'), executionId: z.string().min(1) })
    .strict(),
  z
    .object({
      action: z.literal('retry_model'),
      executionId: z.string().min(1),
      model: executorModelSchema.describe(
        'Explicit human-selected replacement for a needs_model execution.',
      ),
    })
    .strict(),
  z
    .object({
      action: z.literal('reconcile'),
      executionId: z.string().min(1),
      confirmStopped: z.literal(true),
    })
    .strict(),
]);
export const managedWorkSummarySchema = z.object({
  profileId: z.string(),
  executionId: z.string().optional(),
  harness: harnessNameSchema.optional(),
  state: z.enum([
    'starting',
    'running',
    'needs_human',
    'needs_model',
    'completed',
    'failed',
    'interrupted',
    'queued',
    'blocked',
  ]),
  reason: z.string().optional(),
  pendingRequests: z.number().int().nonnegative().optional(),
  recoveryEvents: z.array(recoveryEventSchema).optional(),
  sessionId: z.string().optional(),
  sessionName: z.string().optional(),
  resumeCommand: z.string().optional(),
  deepLink: z.string().optional(),
});
/** Local execution provenance. Never contains a claim token or credentials. */
export interface ManagedExecution {
  transcriptCapture?: 'conversation' | 'partial';
  transcriptError?: string;
  id: string;
  workId: string;
  runId: string;
  attempt: number;
  state: ExecutorState;
  profile: ExecutorProfile;
  permissionSource?: 'workflow' | 'harness' | 'preset';
  /** Present when the workflow has a permission policy. */
  permissionPolicy?: {
    state: 'applied' | 'awaiting_approval' | 'unavailable';
    /** Permission requests the policy answered without asking. */
    autoAllowed: number;
    /** Rules this harness cannot apply, or why none apply. Those actions ask. */
    notApplied?: string[];
    /** The latest auto-allowed actions, at most 50, with the rules that matched. */
    allowed?: { action: string; rule: string; at: string }[];
  };
  modelSource?: z.infer<typeof executorSettingSourceSchema>;
  effortSource?: z.infer<typeof executorSettingSourceSchema>;
  command: string;
  cwd: string;
  sessionId?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  startedAt: string;
  endedAt?: string;
  reconciledAt?: string;
  error?: string;
  modelRecovery?: {
    sessionKey: string;
    holdRevision: number;
    replacementModel?: string;
  };
  recoveryEvents?: RecoveryEvent[];
  requests: ExecutorRequest[];
  logs: { at: string; message: string }[];
  logCount: number;
  output?: Json;
}
export interface ManagedWorkSummary {
  profileId: string;
  executionId?: string;
  harness?: ExecutorProfile['harness'];
  state: ExecutorState | 'queued' | 'blocked';
  reason?: string;
  pendingRequests?: number;
  recoveryEvents?: RecoveryEvent[];
  sessionId?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
}
import {
  executorMessageSchema,
  transcriptQueryBaseSchema,
  messageReceiptQuerySchema,
} from './transcripts.js';
