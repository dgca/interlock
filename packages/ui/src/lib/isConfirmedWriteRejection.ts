import { TRPCClientError } from '@interlock/client';

export function isConfirmedWriteRejection(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    (error.data?.code === 'BAD_REQUEST' || error.data?.domainRejection === true)
  );
}
