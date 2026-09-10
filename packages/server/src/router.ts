import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { developmentConnection, type ConnectionConfig } from './connection.js';
import { definitionSchema, jsonSchema, InterlockError } from '@interlock/core';
import type { Engine } from '@interlock/runtime';

const t = initTRPC
  .context<{ engine: Engine; connection?: ConnectionConfig }>()
  .create();
const p = t.procedure.use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof InterlockError)
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
});
const id = z.object({ id: z.string() });
const claim = z.object({ workId: z.string(), token: z.string() });
export const appRouter = t.router({
  connection: p.query(({ ctx }) => {
    const config = ctx.connection ?? developmentConnection();
    return { ...config, mcpUrl: new URL('/mcp', config.engineUrl).href };
  }),
  workflows: t.router({
    list: p
      .input(
        z
          .object({ ownerWorkflowId: z.string().nullable().optional() })
          .optional(),
      )
      .query(({ ctx, input }) =>
        ctx.engine.store
          .workflows()
          .filter(
            (w) =>
              input?.ownerWorkflowId === undefined ||
              (w.ownerWorkflowId ?? null) === input.ownerWorkflowId,
          ),
      ),
    get: p.input(id).query(({ ctx, input }) => ctx.engine.workflow(input.id)),
    create: p
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          description: z.string().default(''),
          definition: definitionSchema.optional(),
          ownerWorkflowId: z.string().min(1).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.create(
          input.name,
          input.description,
          input.definition,
          input.ownerWorkflowId,
        ),
      ),
    createChild: p
      .input(
        z.object({
          ownerWorkflowId: z.string(),
          name: z.string().trim().min(1).max(120),
          parentDraftRevision: z.number().int(),
          parent: z.object({
            name: z.string().trim().min(1).max(120),
            description: z.string(),
            definition: definitionSchema,
          }),
          nodeId: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.engine.createChild(input)),
    useChildVersion: p
      .input(
        z.object({
          id: z.string(),
          childId: z.string(),
          nodeId: z.string(),
          version: z.number().int().positive(),
          draftRevision: z.number().int(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.engine.useChildVersion(input)),
    update: p
      .input(
        id.extend({
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().optional(),
          archived: z.boolean().optional(),
          draft: definitionSchema.optional(),
          draftRevision: z.number().int().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.engine.update(input.id, input)),
    delete: p
      .input(id)
      .mutation(({ ctx, input }) => ctx.engine.deleteWorkflow(input.id)),
    clone: p.input(id).mutation(({ ctx, input }) => ctx.engine.clone(input.id)),
    publish: p
      .input(id.extend({ cascade: z.boolean().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.engine.publish(input.id, input.cascade),
      ),
    versions: p.input(id).query(({ ctx, input }) => {
      const w = ctx.engine.workflow(input.id);
      return Array.from({ length: w.latestVersion }, (_, i) =>
        ctx.engine.store.getVersion(w.id, i + 1)!,
      );
    }),
  }),
  runs: t.router({
    list: p.query(({ ctx }) => ctx.engine.store.runs().reverse()),
    get: p.input(id).query(({ ctx, input }) => ctx.engine.inspect(input.id)),
    start: p
      .input(
        z.object({
          workflowId: z.string(),
          version: z.number().int().positive().optional(),
          input: jsonSchema,
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.start(input.workflowId, input.input, input.version),
      ),
    cancel: p
      .input(id)
      .mutation(({ ctx, input }) => ctx.engine.cancel(input.id)),
    retry: p.input(id).mutation(({ ctx, input }) => ctx.engine.retry(input.id)),
  }),
  work: t.router({
    list: p
      .input(z.object({ runId: z.string().optional() }).default({}))
      .query(({ ctx, input }) => ctx.engine.available(input.runId)),
    claim: p
      .input(
        z.object({
          workId: z.string(),
          workerId: z.string().min(1),
          freshContext: z.boolean().default(false),
          tools: z.array(z.string()).default([]),
          skills: z.array(z.string()).default([]),
          leaseSeconds: z.number().int().min(10).max(3600).default(300),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.claim(input.workId, input, input.leaseSeconds),
      ),
    renew: p
      .input(
        claim.extend({
          leaseSeconds: z.number().int().min(10).max(3600).default(300),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.renew(input.workId, input.token, input.leaseSeconds),
      ),
    submit: p
      .input(claim.extend({ output: jsonSchema }))
      .mutation(({ ctx, input }) =>
        ctx.engine.submit(input.workId, input.token, input.output),
      ),
    fail: p
      .input(claim.extend({ error: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        ctx.engine.reportFailure(input.workId, input.token, input.error),
      ),
  }),
});
export type AppRouter = typeof appRouter;
