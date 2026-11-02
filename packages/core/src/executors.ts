import { z } from 'zod';
import type { Json } from './index.js';

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
export const executorProfileSchema = z
  .object({
    id: executorReferenceSchema,
    harness: z.enum(['claude-code', 'codex']),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    revision: z.number().int().min(0).default(0),
    command: z.string().trim().min(1).max(4096).optional(),
    cwd: z.string().trim().min(1).max(4096).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    tools: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    skills: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    concurrency: z.number().int().min(1).max(8).default(1),
    permissions: z
      .enum(['ask', 'read-only', 'standard', 'full-access'])
      .default('standard')
      .transform((mode) => (mode === 'ask' ? 'standard' : mode))
      .describe(
        'Default managed Agent permissions. standard uses native approval rules; read-only denies writes; full-access opts into broad access without routine approval stops. Legacy ask means standard. Workflow agentPermissions can override this default.',
      ),
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
      action: z.literal('reconcile'),
      executionId: z.string().min(1),
      confirmStopped: z.literal(true),
    })
    .strict(),
]);
export const managedWorkSummarySchema = z.object({
  profileId: z.string(),
  executionId: z.string().optional(),
  harness: z.enum(['claude-code', 'codex']).optional(),
  state: z.enum([
    'starting',
    'running',
    'needs_human',
    'completed',
    'failed',
    'interrupted',
    'queued',
    'blocked',
  ]),
  reason: z.string().optional(),
  pendingRequests: z.number().int().nonnegative().optional(),
});
/** Local execution provenance. Never contains a claim token or credentials. */
export interface ManagedExecution {
  id: string;
  workId: string;
  runId: string;
  attempt: number;
  state: ExecutorState;
  profile: ExecutorProfile;
  permissionSource?: 'workflow' | 'harness';
  command: string;
  cwd: string;
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
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
}
