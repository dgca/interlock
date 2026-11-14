import { z } from 'zod';
import {
  boardMembershipSchema,
  boardQuerySchema,
  columnBoardSchema,
} from '@interlock/core';
import type { createMcpClient } from '../client.js';
import type { createProfileServer } from './register.js';

function withoutAction<T extends { action: string }>(
  request: T,
): Omit<T, 'action'> {
  const { action, ...rest } = request;
  void action;
  return rest;
}

/** Board reads and column-board management. */
export function registerBoardTools(
  tool: ReturnType<typeof createProfileServer>['tool'],
  client: ReturnType<typeof createMcpClient>,
) {
  tool(
    'read_workflow_boards',
    'List board IDs, names and counts (offset 0, limit 30, max 100, total and nextOffset). settings reads revision, ordered columns, workflowIds and protectedColumnIds. get pages one column, including queued or unstaged, with per-column totals and optional workflowId/status filters. view returns lanes with cards (limit per lane) for a board id, or a workflowId alone for its stage board. Pass card.request to workflow_requests get.',
    {
      request: z.discriminatedUnion('action', [
        boardQuerySchema
          .pick({ offset: true, limit: true })
          .extend({ action: z.literal('list') }),
        boardQuerySchema.pick({ id: true }).extend({
          action: z.literal('settings'),
        }),
        boardQuerySchema.extend({
          action: z.literal('get'),
          column: boardQuerySchema.shape.id,
        }),
        z
          .object({
            action: z.literal('view'),
            id: z.string().optional(),
            workflowId: z.string().optional(),
            lane: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(10),
          })
          .strict(),
      ]),
    },
    async ({ request }) => {
      if (request.action === 'list') {
        const { offset, limit } = request;
        const boards = await client.boards.list();
        return {
          items: boards
            .slice(offset, offset + limit)
            .map(({ id, name, workflowIds, attentionCount }) => ({
              id,
              name,
              workflowCount: workflowIds.length,
              attentionCount,
            })),
          total: boards.length,
          nextOffset: offset + limit < boards.length ? offset + limit : null,
        };
      }
      if (request.action === 'settings')
        return client.boards.settings({ id: request.id });
      if (request.action === 'view')
        return client.boards.view({
          id: request.id,
          workflowId: request.workflowId,
          lane: request.lane,
          limit: request.limit,
        });
      return client.boards.get(withoutAction(request));
    },
  );
  tool(
    'manage_workflow_boards',
    "Save boards or assign workflows to them. save replaces a board's ordered columns and workflowIds. To update, pass id and expectedRevision from settings, keep existing column IDs, and omit IDs for new columns; protected columns cannot be removed. Guard workflow moves with expectedBoards, mapping each selected workflow to its current board ID or null. To create, omit id and expectedRevision, and check the list before retrying. assign takes workflowId, boardId and expectedBoardId (null means unassigned). Membership changes apply immediately, and moving a workflow clears its imported stage mappings.",
    {
      request: z.discriminatedUnion('action', [
        columnBoardSchema.extend({ action: z.literal('save') }),
        boardMembershipSchema.extend({ action: z.literal('assign') }),
      ]),
    },
    async ({ request }) => {
      if (request.action === 'save')
        return client.boards.save(withoutAction(request));
      const workflow = await client.boards.assign(withoutAction(request));
      return { workflowId: workflow.id, boardId: workflow.boardId ?? null };
    },
  );
}
