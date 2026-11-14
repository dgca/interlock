import { z } from 'zod';
import {
  setPriceTableSchema,
  setStartCostWarningSchema,
} from '@interlock/core';
import { p, t } from './trpc.js';

export const pricesRouter = t.router({
  read: p.query(({ ctx }) => ctx.engine.usage.prices.read()),
  set: p
    .input(setPriceTableSchema)
    .mutation(({ ctx, input }) => ctx.engine.usage.prices.set(input)),
  startWarning: p.query(({ ctx }) => ctx.engine.startCosts.setting()),
  setStartWarning: p
    .input(setStartCostWarningSchema)
    .mutation(({ ctx, input }) => ctx.engine.startCosts.configure(input)),
  // Null without a threshold or with fewer than three costed recent runs.
  startCost: p
    .input(z.object({ workflowId: z.string().min(1) }).strict())
    .query(({ ctx, input }) => ctx.engine.startCosts.project(input.workflowId)),
});
