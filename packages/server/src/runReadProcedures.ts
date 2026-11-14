import { runListQuerySchema } from '@interlock/core';
import { p } from './trpc.js';

/** Full run records, newest first, paged by the last run ID read. */
export const runReadProcedures = {
  list: p
    .input(runListQuerySchema.default({}))
    .query(({ ctx, input }) =>
      ctx.engine.projectRuns(ctx.engine.store.runScopes.page(input)),
    ),
};
