import { z } from 'zod';
import type { RunStatus, WorkflowNode } from './index.js';

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(200);
const stageId = z.string().min(1).max(80);

export const boardSuggestionSchema = z
  .object({
    id,
    name,
    columns: z.array(z.object({ id, name }).strict()).max(100),
    stages: z
      .array(z.object({ id: stageId, name, columnId: id.nullable() }).strict())
      .max(1000),
  })
  .strict()
  .superRefine(({ columns, stages }, ctx) => {
    const columnIds = new Set(columns.map((column) => column.id));
    if (
      columnIds.size !== columns.length ||
      new Set(stages.map((stage) => stage.id)).size !== stages.length ||
      stages.some((stage) => stage.columnId && !columnIds.has(stage.columnId))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Board suggestion must have unique stages and valid columns',
      });
  });

const setupChoice = {
  suggestionId: id,
  expectedBoards: z.record(id, id.nullable()),
};
export const boardImportSetupSchema = z
  .object({
    requestId: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => /\S/.test(value)),
    choices: z
      .array(
        z.discriminatedUnion('action', [
          z
            .object({
              ...setupChoice,
              action: z.literal('create'),
              name: name.optional(),
            })
            .strict(),
          z
            .object({
              ...setupChoice,
              action: z.literal('existing'),
              boardId: id,
              expectedRevision: z.number().int().positive(),
              stageColumns: z.record(id, z.record(stageId, id.nullable())),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type BoardSuggestion = z.infer<typeof boardSuggestionSchema>;
export type BoardImportSetup = z.infer<typeof boardImportSetupSchema>;
export type BoardImportResult = {
  boards: { suggestionId: string; boardId: string; workflowIds: string[] }[];
};

type StageNode = Pick<WorkflowNode, 'stageId' | 'boardColumnId'>;
export function workflowStageId(node: StageNode) {
  return node.stageId ?? node.boardColumnId;
}

export function workflowStageColumn(
  node: StageNode,
  mapping?: Readonly<Record<string, string | null>>,
) {
  const id = workflowStageId(node);
  if (id && mapping && Object.hasOwn(mapping, id))
    return mapping[id] ?? undefined;
  return node.stageId ? undefined : node.boardColumnId;
}

export const boardSettingsRevisionConflict =
  'Board settings changed. Refresh and try again.';

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
