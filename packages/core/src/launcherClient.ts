import { z } from 'zod';
import { InterlockError } from './index.js';

/** Operations a pull launcher client performs for Interlock. */
export type LauncherOperationKind =
  'launch' | 'status' | 'message' | 'stop' | 'archive';

const profileId = z.string().trim().min(1).max(200);
const credential = z
  .string()
  .min(1)
  .max(200)
  .describe('Launcher credential for this profile.');
const lease = {
  profileId,
  credential,
  operationId: z.string().min(1).max(200),
  leaseToken: z.string().min(1).max(200),
};

export const launcherPollSchema = z
  .object({
    profileId,
    credential,
    clientId: z.string().trim().min(1).max(200),
    waitMs: z.number().int().min(0).max(25_000).default(20_000),
    limit: z.number().int().min(1).max(10).default(1),
  })
  .strict();
export const launcherCompleteSchema = z
  .object({ ...lease, result: z.record(z.unknown()).default({}) })
  .strict();
export const launcherFailSchema = z
  .object({
    ...lease,
    error: z.string().trim().min(1).max(2000),
    retryable: z.boolean().default(false),
  })
  .strict();
export const launcherCredentialSchema = z.object({ profileId }).strict();

export interface LeasedLauncherOperation {
  operationId: string;
  kind: LauncherOperationKind;
  leaseToken: string;
  leaseExpiresAt: string;
  payload: Record<string, unknown>;
}

export type LauncherClientErrorCode =
  | 'launcher_credential_invalid'
  | 'launcher_client_conflict'
  | 'launcher_lease_invalid'
  | 'launcher_operation_not_found'
  | 'launcher_poll_busy'
  | 'launcher_profile_disabled';

/** A pull client request Interlock refused; `code` is stable for clients. */
export class LauncherClientError extends InterlockError {
  constructor(
    readonly code: LauncherClientErrorCode,
    message: string,
  ) {
    super(message);
  }
}
