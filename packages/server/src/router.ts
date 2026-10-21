import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { developmentConnection, type ConnectionConfig } from './connection.js';
import {
  definitionSchema,
  workflowEditsSchema,
  jsonSchema,
  runQuerySchema,
  InterlockError,
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  promptContentSchema,
  versionSelectionSchema,
  versionDeletionSchema,
  ownershipPreviewSchema,
  ownershipChangeSchema,
  createSuiteSchema,
  updateSuiteSchema,
  comparisonPreviewSchema,
  comparisonStartSchema,
  testbenchListSchema,
  comparisonReportSchema,
  comparisonCaseSchema,
  comparisonCancelSchema,
  qualityJudgmentSchema,
  continuationLimitSchema,
  reportUsageSchema,
  usageQuerySchema,
  budgetPolicySchema,
  setBudgetSchema,
} from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import {
  exportWorkflows,
  importWorkflows,
} from '../../runtime/src/transfer.js';
import { workflowBundleSchema } from '../../core/src/transfer.js';

import { GithubImporter, githubSourceSchema } from './githubImport.js';
const githubImporter = new GithubImporter();

const t = initTRPC
  .context<{
    engine: Engine;
    connection?: ConnectionConfig;
    signal?: AbortSignal;
  }>()
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
const createWorkflowInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().default(''),
  definition: definitionSchema.optional(),
  ownerWorkflowId: z.string().min(1).nullable().optional(),
});
const updateWorkflowInput = id.extend({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  draft: definitionSchema.optional(),
  draftRevision: z.number().int().optional(),
});
const claim = z.object({ workId: z.string(), token: z.string() });
export const appRouter = t.router({
  connection: p.query(({ ctx }) => {
    const config = ctx.connection ?? developmentConnection();
    return { ...config, mcpUrl: new URL('/mcp', config.engineUrl).href };
  }),
  testbench: t.router({
    suites: p
      .input(testbenchListSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.listSuites(input)),
    suite: p
      .input(id)
      .query(({ ctx, input }) => ctx.engine.testbench.getSuite(input.id)),
    createSuite: p
      .input(createSuiteSchema)
      .mutation(({ ctx, input }) => ctx.engine.testbench.createSuite(input)),
    updateSuite: p
      .input(updateSuiteSchema)
      .mutation(({ ctx, input }) => ctx.engine.testbench.updateSuite(input)),
    preview: p
      .input(comparisonPreviewSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.preview(input)),
    start: p.input(comparisonStartSchema).mutation(({ ctx, input }) => {
      const comparison = ctx.engine.testbench.start(input);
      ctx.engine.pump();
      return ctx.engine.testbench.progress(comparison.id);
    }),
    comparisons: p
      .input(testbenchListSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.list(input)),
    report: p
      .input(comparisonReportSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.report(input)),
    case: p
      .input(comparisonCaseSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.getCase(input)),
    cancel: p.input(comparisonCancelSchema).mutation(({ ctx, input }) => {
      const result = ctx.engine.testbench.cancel(input);
      ctx.engine.pump();
      return ctx.engine.testbench.progress(result.id);
    }),
    judge: p
      .input(qualityJudgmentSchema)
      .mutation(({ ctx, input }) => ctx.engine.testbench.judge(input)),
  }),
  prompts: t.router({
    list: p.query(({ ctx }) => ctx.engine.prompts.list()),
    get: p.input(id).query(({ ctx, input }) => ({
      ...ctx.engine.prompts.get(input.id),
      usage: ctx.engine.prompts.usage(input.id),
    })),
    create: p
      .input(promptContentSchema)
      .mutation(({ ctx, input }) => ctx.engine.prompts.create(input)),
    update: p
      .input(
        promptContentSchema.extend({
          id: z.string(),
          revision: z.number().int().positive(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.prompts.update(input.id, input.revision, input),
      ),
    delete: p
      .input(id)
      .mutation(({ ctx, input }) => ctx.engine.prompts.delete(input.id)),
  }),
  workflows: t.router({
    discoverGithub: p
      .input(z.object({ url: z.string().max(2000) }))
      .query(({ ctx, input, signal }) =>
        githubImporter.discover(input.url, ctx.signal ?? signal),
      ),
    importGithub: p
      .input(
        z
          .object({
            source: githubSourceSchema,
            files: z.array(z.string().min(1).max(255)).min(1).max(50),
          })
          .strict(),
      )
      .mutation(({ ctx, input, signal }) =>
        githubImporter.import(
          ctx.engine,
          input.source,
          input.files,
          ctx.signal ?? signal,
        ),
      ),
    export: p
      .input(id)
      .query(({ ctx, input }) => exportWorkflows(ctx.engine.store, input.id)),
    exportDraft: p
      .input(
        id.extend({
          name: z.string(),
          description: z.string(),
          draft: definitionSchema,
        }),
      )
      .mutation(({ ctx, input }) =>
        exportWorkflows(ctx.engine.store, input.id, input),
      ),
    import: p
      .input(
        z.object({
          bundle: workflowBundleSchema,
          force: z.boolean().optional(),
          draftRevisions: z.record(z.number().int().positive()).optional(),
          restoreDeletedVersions: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        importWorkflows(ctx.engine.store, input.bundle, input),
      ),
    list: p
      .input(
        z
          .object({
            ownerWorkflowId: z.string().nullable().optional(),
            includeArchived: z.boolean().optional(),
          })
          .optional(),
      )
      .query(({ ctx, input }) =>
        ctx.engine.store
          .workflows()
          .filter(
            (w) =>
              (input?.ownerWorkflowId === undefined ||
                (w.ownerWorkflowId ?? null) === input.ownerWorkflowId) &&
              (input?.includeArchived !== false ||
                (!w.archived &&
                  (!w.ownerWorkflowId ||
                    !ctx.engine.workflow(w.ownerWorkflowId).archived))),
          )
          .map((workflow) => ctx.engine.describeWorkflow(workflow)),
      ),
    get: p
      .input(id)
      .query(({ ctx, input }) =>
        ctx.engine.describeWorkflow(ctx.engine.workflow(input.id)),
      ),
    createSummary: p
      .input(createWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.authoringSummary(
          ctx.engine.create(
            input.name,
            input.description,
            input.definition,
            input.ownerWorkflowId,
          ),
        ),
      ),
    updateSummary: p
      .input(updateWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.authoringSummary(ctx.engine.update(input.id, input)),
      ),
    publishSummary: p
      .input(id.extend({ cascade: z.boolean().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.engine.authoringSummary(
          ctx.engine.publish(input.id, input.cascade),
        ),
      ),
    create: p
      .input(createWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.create(
          input.name,
          input.description,
          input.definition,
          input.ownerWorkflowId,
        ),
      ),
    previewOwnership: p
      .input(ownershipPreviewSchema)
      .query(({ ctx, input }) => ctx.engine.ownership.preview(input)),
    setOwner: p
      .input(ownershipChangeSchema)
      .mutation(({ ctx, input }) => ctx.engine.ownership.set(input)),
    edit: p
      .input(
        z
          .object({
            id: z.string(),
            draftRevision: z.number().int().positive(),
            edits: workflowEditsSchema,
            diagnostics: z.enum(['all', 'summary']).default('all'),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.editDraft(
          input.id,
          input.draftRevision,
          input.edits,
          input.diagnostics,
        ),
      ),
    validate: p
      .input(
        z
          .object({ id: z.string(), definition: jsonSchema.optional() })
          .strict(),
      )
      .query(({ ctx, input }) =>
        ctx.engine.validateDraft(input.id, input.definition),
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
      .input(updateWorkflowInput)
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
      return ctx.engine.store.listVersions(w.id);
    }),
    previewVersionDeletion: p
      .input(versionSelectionSchema)
      .query(({ ctx, input }) => ctx.engine.versions.preview(input)),
    deleteVersions: p
      .input(versionDeletionSchema)
      .mutation(({ ctx, input }) => ctx.engine.versions.delete(input)),
  }),
  runs: t.router({
    budget: p
      .input(z.object({ runId: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.engine.budgets.read(input.runId)),
    setBudget: p
      .input(setBudgetSchema)
      .mutation(({ ctx, input }) => ctx.engine.budgets.set(input)),
    usage: p
      .input(usageQuerySchema)
      .query(({ ctx, input }) => ctx.engine.usage.read(input)),
    startSummary: p
      .input(
        z.object({
          workflowId: z.string(),
          version: z.number().int().positive().optional(),
          input: jsonSchema,
          budget: budgetPolicySchema.optional(),
          limit: continuationLimitSchema,
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.startSummary(
          input.workflowId,
          input.input,
          input.version,
          input.limit,
          input.budget,
        ),
      ),
    briefing: p
      .input(briefingQuerySchema)
      .query(({ ctx, input }) => ctx.engine.continuation.briefing(input)),
    wait: p
      .input(waitQuerySchema)
      .query(({ ctx, input, signal }) =>
        ctx.engine.continuation.wait(
          input,
          ctx.signal && signal
            ? AbortSignal.any([ctx.signal, signal])
            : (ctx.signal ?? signal),
        ),
      ),
    result: p
      .input(resultQuerySchema)
      .query(({ ctx, input }) => ctx.engine.continuation.result(input)),
    find: p
      .input(runQuerySchema.default({}))
      .query(({ ctx, input }) => ctx.engine.store.findRuns(input)),
    list: p.query(({ ctx }) => ctx.engine.store.runs().reverse()),
    get: p.input(id).query(({ ctx, input }) => ctx.engine.inspect(input.id)),
    start: p
      .input(
        z.object({
          workflowId: z.string(),
          version: z.number().int().positive().optional(),
          input: jsonSchema,
          budget: budgetPolicySchema.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.start(
          input.workflowId,
          input.input,
          input.version,
          input.budget,
        ),
      ),
    cancel: p
      .input(id)
      .mutation(({ ctx, input }) => ctx.engine.cancel(input.id)),
    retry: p.input(id).mutation(({ ctx, input }) => ctx.engine.retry(input.id)),
  }),
  work: t.router({
    reportUsage: p
      .input(reportUsageSchema)
      .mutation(({ ctx, input }) => ctx.engine.usage.report(input)),
    submitSummary: p
      .input(
        claim.extend({ output: jsonSchema, limit: continuationLimitSchema }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.submitSummary(
          input.workId,
          input.token,
          input.output,
          input.limit,
        ),
      ),
    summaries: p
      .input(z.object({ runId: z.string().optional() }).default({}))
      .query(({ ctx, input }) => ctx.engine.workSummaries(input.runId)),
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
          leaseSeconds: z.number().int().min(10).max(3600).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.claim(input.workId, input, input.leaseSeconds),
      ),
    renew: p
      .input(
        claim.extend({
          leaseSeconds: z.number().int().min(10).max(3600).optional(),
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
