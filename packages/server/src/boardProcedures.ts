import {
  boardMembershipSchema,
  boardQuerySchema,
  boardViewQuerySchema,
  saveBoardSchema,
  saveBoardTypeSchema,
  startHoldSchema,
  startReleaseSchema,
} from '@interlock/core';
import { z } from 'zod';
import { id, p, t } from './trpc.js';

/** Boards, board types and the board view shared by the UI, CLI, MCP and HTTP API. */
export const boardsRouter = t.router({
  list: p.query(({ ctx }) => ctx.engine.boards.list()),
  get: p
    .input(boardQuerySchema)
    .query(({ ctx, input }) => ctx.engine.boards.read(input)),
  settings: p
    .input(id)
    .query(({ ctx, input }) => ctx.engine.boards.settings(input.id)),
  save: p
    .input(saveBoardSchema)
    .mutation(({ ctx, input }) => ctx.engine.boards.save(input)),
  assign: p
    .input(boardMembershipSchema)
    .mutation(({ ctx, input }) =>
      ctx.engine.describeWorkflow(ctx.engine.boards.assign(input)),
    ),
  view: p
    .input(boardViewQuerySchema)
    .query(({ ctx, input }) => ctx.engine.boards.views.view(input)),
  hold: p
    .input(startHoldSchema)
    .mutation(({ ctx, input }) => ctx.engine.boards.hold(input)),
  release: p
    .input(startReleaseSchema)
    .mutation(({ ctx, input }) => ctx.engine.boards.release(input)),
});
export const boardTypesRouter = t.router({
  list: p
    .input(z.object({ builtIn: z.boolean().optional() }).strict().optional())
    .query(({ ctx, input }) => ctx.engine.boards.types.list(input)),
  get: p
    .input(id)
    .query(({ ctx, input }) => ctx.engine.boards.types.get(input.id)),
  save: p
    .input(saveBoardTypeSchema)
    .mutation(({ ctx, input }) => ctx.engine.boards.types.save(input)),
  delete: p
    .input(id)
    .mutation(({ ctx, input }) => ctx.engine.boards.types.delete(input.id)),
});
