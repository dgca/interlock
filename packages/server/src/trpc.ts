import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  ExternalInputConflict,
  InterlockError,
  ResultRejection,
} from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import type { ConnectionConfig } from './connection.js';

export type Context = {
  engine: Engine;
  connection?: ConnectionConfig;
  signal?: AbortSignal;
  /** Set for MCP callers so the library can gate agent-authored Scripts. */
  author?: 'agent';
};
export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(error.cause instanceof InterlockError
          ? { domainRejection: true as const }
          : {}),
        ...(error.cause instanceof ResultRejection
          ? { resultCheck: error.cause.resultCheck }
          : {}),
      },
    };
  },
});
export const p = t.procedure.use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof InterlockError)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
        cause: error,
      });
    throw error;
  }
});
export const id = z.object({ id: z.string() });
export function inputMutation<T>(action: () => T) {
  try {
    return action();
  } catch (error) {
    if (error instanceof InterlockError)
      throw new TRPCError({
        code:
          error instanceof ExternalInputConflict ? 'CONFLICT' : 'BAD_REQUEST',
        message: error.message,
        cause: error,
      });
    throw error;
  }
}
