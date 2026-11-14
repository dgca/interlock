import { setPriceTableSchema } from '@interlock/core';
import { p, t } from './trpc.js';

export const pricesRouter = t.router({
  read: p.query(({ ctx }) => ctx.engine.usage.prices.read()),
  set: p
    .input(setPriceTableSchema)
    .mutation(({ ctx, input }) => ctx.engine.usage.prices.set(input)),
});
