import { z } from 'zod';

export const trialSetupSchema = z
  .object({
    kind: z.literal('local_git'),
    repository: z.string().min(1).max(2000),
    commit: z
      .string()
      .regex(
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
        'Use a full captured commit ID',
      ),
  })
  .strict()
  .describe(
    'Opt-in trusted local Git trials. Prepare independent clones before work; Fetch is unsupported. External executors own scoped tools and outbound-write prevention, not an OS sandbox.',
  );
export type TrialSetup = z.infer<typeof trialSetupSchema>;
export const trialReadSchema = z
  .object({
    id: z.string().min(1).max(120),
    sampleId: z.string().min(1).max(120),
  })
  .strict();
export const trialCleanupSchema = trialReadSchema.extend({
  quiescent: z
    .boolean()
    .default(false)
    .describe(
      'Explicit harness confirmation that uncertain external workers stopped. Never inferred from lease expiry/cancellation.',
    ),
});
export interface TrialEnvironment {
  id: string;
  configurationId: string;
  setupId: string;
  baseCommit: string;
  preparation: 'queued' | 'preparing' | 'ready' | 'failed';
  cleanup: 'pending' | 'running' | 'complete' | 'blocked';
  requiresQuiescence: boolean;
  cleanupRequested?: boolean;
  error?: string;
  cleanupError?: string;
  artifacts?: {
    patch: string;
    untracked: string;
    fileCount: number;
    bytes: number;
  };
  updatedAt: string;
  /** Local implementation data, omitted from ordinary comparison reports. */
  ownerToken: string;
  directory?: string;
  workspace?: string;
}
export interface TrialWorkContext {
  id: string;
  workspace: string;
  baseCommit: string;
  configurationId: string;
  policy: 'trusted_local';
}
export const trialWorkContextSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  baseCommit: z.string(),
  configurationId: z.string(),
  policy: z.literal('trusted_local'),
});
