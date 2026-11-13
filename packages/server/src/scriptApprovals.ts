import {
  InterlockError,
  scriptApprovalSettingsSchema,
  scriptApprovalTargetSchema,
  type DraftLayout,
  type WorkflowDefinition,
} from '@interlock/core';
import { p, t, type Context } from './trpc.js';

/** Agents can read approval state but only a person approves or changes the gate. */
function person(ctx: Context) {
  if (ctx.author === 'agent')
    throw new InterlockError(
      'A person must approve Scripts or change Script approval in the Interlock UI or CLI',
    );
}

export const scriptRouter = t.router({
  settings: p.query(({ ctx }) => ctx.engine.scriptApprovals.settings()),
  saveSettings: p
    .input(scriptApprovalSettingsSchema)
    .mutation(({ ctx, input }) => {
      person(ctx);
      return ctx.engine.scriptApprovals.saveSettings(input.mode);
    }),
  approve: p.input(scriptApprovalTargetSchema).mutation(({ ctx, input }) => {
    person(ctx);
    const approval = ctx.engine.scriptApprovals.approve(input);
    ctx.engine.pump();
    return approval;
  }),
});

/**
 * Apply a draft change. When an agent made it and the library extends approval
 * to agents, Script content new to the workflow waits for a person.
 */
export function agentDraftEdit<T>(
  ctx: Context,
  workflowId: string | ((result: T) => string),
  mutate: () => T,
): T {
  if (ctx.author !== 'agent') return mutate();
  const approvals = ctx.engine.scriptApprovals;
  return ctx.engine.store.transaction(() => {
    const previous =
      typeof workflowId === 'string' ? approvals.definitions(workflowId) : [];
    const result = mutate();
    approvals.recordAgentEdit(
      typeof workflowId === 'string' ? workflowId : workflowId(result),
      previous,
    );
    return result;
  });
}

/** Create a workflow. A legacy file import records its Scripts as imported. */
export function createWorkflow(
  ctx: Context,
  input: {
    name: string;
    description: string;
    definition?: WorkflowDefinition;
    ownerWorkflowId?: string | null;
    layout?: DraftLayout;
    imported?: boolean;
  },
) {
  return agentDraftEdit(
    ctx,
    (workflow) => workflow.id,
    () => {
      const workflow = ctx.engine.create(
        input.name,
        input.description,
        input.definition,
        input.ownerWorkflowId,
        input.layout,
      );
      if (input.imported)
        ctx.engine.scriptApprovals.record(workflow.id, [], [workflow.draft]);
      return workflow;
    },
  );
}
