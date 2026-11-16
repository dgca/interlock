import { z } from 'zod';
import { runTagsSchema } from './runTags.js';
import { runPageCursorSchema, runStatusSchema } from './runPages.js';
import {
  startRequestIdSchema,
  externalTaskIdentitySchema,
} from './runStarts.js';
import { jsonSchema } from './json.js';
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runQuerySchema = z.object({
  requestId: startRequestIdSchema.optional(),
  externalTask: externalTaskIdentitySchema.optional(),
  tags: runTagsSchema.optional(),
  chainRootRunId: z.string().min(1).optional(),
  workflowId: z.string().optional(),
  status: runStatusSchema.optional(),
  rootOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(50),
  afterRunId: runPageCursorSchema.optional(),
  inputMatch: z.object({ path: z.string(), equals: jsonSchema }).optional(),
});
export type RunQuery = z.infer<typeof runQuerySchema>;
export const runSummaryQuerySchema = runQuerySchema
  .pick({ workflowId: true, status: true, tags: true })
  .extend({
    tab: z.enum(['active', 'attention', 'history']).optional(),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  });
export type RunSummaryQuery = z.infer<typeof runSummaryQuerySchema>;
