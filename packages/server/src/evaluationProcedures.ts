import {
  evaluationPlanQuerySchema,
  evaluationRecordSchema,
  qualityJudgmentSchema,
} from '@interlock/core';
import {
  planEvaluation,
  recordEvaluation,
} from '@interlock/runtime/evaluationPlan';
import { z } from 'zod';
import { p } from './trpc.js';

/** Quality judgments, the evaluation starter's plan and record steps, and saved-suite results. */
export const evaluationProcedures = {
  judge: p
    .input(qualityJudgmentSchema)
    .mutation(({ ctx, input }) => ctx.engine.testbench.judge(input)),
  evaluationPlan: p
    .input(evaluationPlanQuerySchema)
    .query(({ ctx, input }) => planEvaluation(ctx.engine.store, input)),
  recordEvaluation: p
    .input(evaluationRecordSchema)
    .mutation(({ ctx, input }) =>
      recordEvaluation(ctx.engine.testbench, ctx.engine.store, input),
    ),
  /** Latest fixture simulation of each case in one suite, for the UI suite view. */
  suiteSimulations: p
    .input(z.object({ id: z.string().min(1).max(120) }).strict())
    .query(({ ctx, input }) => ctx.engine.simulations.latestForSuite(input.id)),
};
