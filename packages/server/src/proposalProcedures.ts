import { z } from 'zod';
import { InterlockError } from '@interlock/core';
import {
  proposalCreateSchema,
  proposalDecisionSchema,
  proposalListSchema,
  proposalSettingsSchema,
} from '@interlock/core/proposals';
import { workflowProposals } from '@interlock/runtime/workflowProposals';
import { p, t, type Context } from './trpc.js';

/** Agents may propose; only a person decides or changes the policy. */
function person(ctx: Context) {
  if (ctx.author === 'agent')
    throw new InterlockError(
      'A person must review proposals or change proposal settings in the Interlock UI or CLI',
    );
}
const workflowId = z.object({ workflowId: z.string().min(1) }).strict();

export const proposalsRouter = t.router({
  create: p
    .input(proposalCreateSchema)
    .mutation(({ ctx, input }) =>
      workflowProposals(ctx.engine).create(input, ctx.author ?? 'person'),
    ),
  list: p
    .input(proposalListSchema.default({}))
    .query(({ ctx, input }) => workflowProposals(ctx.engine).list(input)),
  get: p
    .input(z.object({ id: z.string().min(1) }).strict())
    .query(({ ctx, input }) => workflowProposals(ctx.engine).view(input.id)),
  decide: p.input(proposalDecisionSchema).mutation(({ ctx, input }) => {
    person(ctx);
    return workflowProposals(ctx.engine).decide(input);
  }),
  settings: p
    .input(workflowId)
    .query(({ ctx, input }) =>
      workflowProposals(ctx.engine).settings(input.workflowId),
    ),
  saveSettings: p
    .input(workflowId.extend({ settings: proposalSettingsSchema }).strict())
    .mutation(({ ctx, input }) => {
      person(ctx);
      return workflowProposals(ctx.engine).saveSettings(
        input.workflowId,
        input.settings,
      );
    }),
});
