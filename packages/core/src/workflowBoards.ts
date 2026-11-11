import { z } from 'zod';
import type { RunStatus } from './index.js';

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(200);

export const saveBoardSchema = z
  .object({
    id: id.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name,
    columns: z.array(z.object({ id: id.optional(), name })).max(100),
    workflowIds: z.array(id).max(1000),
    expectedBoards: z.record(id, id.nullable()).optional(),
  })
  .strict();

export const boardMembershipSchema = z
  .object({
    workflowId: id,
    boardId: id.nullable(),
    expectedBoardId: id.nullable(),
  })
  .strict();

export const boardStatusSchema = z.enum([
  'all',
  'attention',
  'queued',
  'running',
  'waiting',
  'failed',
  'completed',
  'cancelled',
]);
export const boardQuerySchema = z
  .object({
    id,
    workflowId: id.optional(),
    status: boardStatusSchema.default('all'),
    column: id.optional(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();

export type BoardStatus = z.infer<typeof boardStatusSchema>;
export type BoardQuery = z.infer<typeof boardQuerySchema>;
export type SaveBoard = z.infer<typeof saveBoardSchema>;
export type BoardMembership = z.infer<typeof boardMembershipSchema>;
export type BoardColumn = { id: string; name: string };
export type WorkflowBoard = {
  id: string;
  revision: number;
  name: string;
  columns: BoardColumn[];
};
export type BoardRun = {
  id: string;
  runId: string;
  workflowId: string;
  workflowName: string;
  title?: string;
  externalTask?: import('./runStarts.js').ExternalTask;
  status: RunStatus;
  changedAt: string;
  columnId?: string;
  error?: string;
  activity?: string;
};
