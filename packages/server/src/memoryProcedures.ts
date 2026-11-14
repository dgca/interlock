import {
  memoryManageSchema,
  memoryReadSchema,
  workMemorySchema,
} from '@interlock/core';
import { p, t } from './trpc.js';

/** Workflow memory: people read and manage notes; claims read and write their scopes. */
export const memoryRouter = t.router({
  read: p
    .input(memoryReadSchema)
    .query(({ ctx, input }) => ctx.engine.memory.read(input)),
  manage: p
    .input(memoryManageSchema)
    .mutation(({ ctx, input }) => ctx.engine.memory.manage(input)),
  work: p
    .input(workMemorySchema)
    .mutation(({ ctx, input }) => ctx.engine.memory.work(input)),
});
