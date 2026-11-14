import {
  evaluationPlanQuerySchema,
  evaluationRecordSchema,
  qualityJudgmentSchema,
} from '@interlock/core';
import {
  planEvaluation,
  recordEvaluation,
} from '@interlock/runtime/evaluationPlan';
import { p } from './trpc.js';

/** Quality judgments, plus the evaluation starter's plan and record-by-reference steps. */
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
};
