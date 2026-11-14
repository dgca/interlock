import { runListQuerySchema } from '@interlock/core';
import { z } from 'zod';
import { boundRunInspection } from './runInspectionBounds.js';
import { id, p } from './trpc.js';

const runGetSchema = id.extend({
  full: z
    .boolean()
    .optional()
    .describe('Return every payload even above the 64 KiB response limit.'),
});

/** Full run records, newest first, paged by the last run ID read. */
export const runReadProcedures = {
  list: p
    .input(runListQuerySchema.default({}))
    .query(({ ctx, input }) =>
      ctx.engine.projectRuns(ctx.engine.store.runScopes.page(input)),
    ),
  /** One run's inspection, compacted above the response limit unless `full`. */
  get: p
    .input(runGetSchema)
    .query(({ ctx, input }) =>
      boundRunInspection(ctx.engine.inspect(input.id), input.full),
    ),
};
