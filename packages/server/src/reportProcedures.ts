import { reportFilterSchema } from '@interlock/core';
import { generateReportDashboard } from '@interlock/runtime/reportDashboard';
import { p, t } from './trpc.js';

const summary = p
  .input(reportFilterSchema.optional())
  .query(({ ctx, input }) => ctx.engine.report(input ?? {}));

/** Report reads. The dashboard reuses the report and adds its previous window. */
export const reportRouter = t.router({
  summary,
  dashboard: p
    .input(reportFilterSchema.optional())
    .query(({ ctx, input }) =>
      generateReportDashboard(ctx.engine, input ?? {}),
    ),
});

export const systemReport = summary;
