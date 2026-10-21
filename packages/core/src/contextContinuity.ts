import { z } from 'zod';

export const continuityGroupSchema = z.string().trim().min(1).max(128);
export const sessionIdentitySchema = z
  .object({
    executorId: z.string().trim().min(1).max(200),
    sessionId: z.string().trim().min(1).max(200),
  })
  .strict();
export const continuitySchema = z.object({
  runId: z.string(),
  group: continuityGroupSchema,
  revision: z.number().int().nonnegative(),
  session: sessionIdentitySchema.nullable(),
  checkpointRef: z.string().optional(),
});
export const contextGroupQuerySchema = z.object({
  runId: z.string().min(1),
  group: continuityGroupSchema,
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});
export const contextHandoffSchema = z
  .object({
    runId: z.string().min(1),
    group: continuityGroupSchema,
    expectedRevision: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    session: sessionIdentitySchema,
    actor: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1000),
    checkpointRef: z.string().trim().min(1).max(2048),
  })
  .strict();
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
export type ContextContinuity = z.infer<typeof continuitySchema>;
export type ContextHandoffInput = z.input<typeof contextHandoffSchema>;
export type ContextGroupQuery = z.input<typeof contextGroupQuerySchema>;
export type ContextEvent = {
  id: string;
  runId: string;
  group: string;
  revision: number;
  session: SessionIdentity;
  at: string;
} & (
  | {
      kind: 'claim';
      workId: string;
      attempt: number;
      workerId: string;
    }
  | {
      kind: 'handoff';
      fromSession: SessionIdentity;
      actor: string;
      reason: string;
      checkpointRef: string;
    }
);
