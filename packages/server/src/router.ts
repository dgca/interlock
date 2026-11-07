import { listStarters, importStarter } from './starters.js';
import { parseImportDocument } from '../../core/src/importDocument.js';
import { workResourceRequestSchema } from '@interlock/core';
import {
  variableReadSchema,
  variableMutationSchema,
  variableImportBindingsSchema,
} from '@interlock/core';
import {
  executorOperationSchema,
  executorModelsQuerySchema,
} from '@interlock/core';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { developmentConnection, type ConnectionConfig } from './connection.js';
import {
  externalInputMutationSchema,
  externalInputStatusSchema,
  simulationRequestSchema,
  workHoldRequestSchema,
  contextGroupQuerySchema,
  contextHandoffSchema,
  sessionIdentitySchema,
  modelSelectionSchema,
  assignmentSizeQuerySchema,
  definitionSchema,
  draftLayoutSchema,
  workflowEditsSchema,
  jsonSchema,
  runQuerySchema,
  runSummaryQuerySchema,
  runStartSchema,
  cancelRunSchema,
  ExternalInputConflict,
  InterlockError,
  ResultRejection,
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  promptContentSchema,
  promptReadSchema,
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
  trialReadSchema,
  trialCleanupSchema,
  comparisonCancelSchema,
  qualityJudgmentSchema,
  continuationLimitSchema,
  reportUsageSchema,
  usageQuerySchema,
  setBudgetSchema,
  historyPreviewSchema,
  historyDeletionSchema,
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
  .create({
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          ...(error.cause instanceof ResultRejection
            ? { resultCheck: error.cause.resultCheck }
            : {}),
        },
      };
    },
  });
const p = t.procedure.use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof InterlockError)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
        cause: error,
      });
    throw error;
  }
});
const id = z.object({ id: z.string() });
const createWorkflowInput = z.object({
  layout: draftLayoutSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().default(''),
  definition: definitionSchema.optional(),
  ownerWorkflowId: z.string().min(1).nullable().optional(),
});
const updateWorkflowInput = id.extend({
  layout: draftLayoutSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  draft: definitionSchema.optional(),
  draftRevision: z.number().int().optional(),
});
const claim = z.object({ workId: z.string(), token: z.string() });
export const appRouter = t.router({
  variables: t.router({
    read: p
      .input(variableReadSchema)
      .query(({ ctx, input }) => ctx.engine.variables.read(input)),
    manage: p
      .input(
        z.unknown().transform((input, context) => {
          const parsed = variableMutationSchema.safeParse(input);
          if (!parsed.success) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                'Invalid variable change. Check required fields, name, value size, and expectedRevision. Values were not saved.',
            });
            return z.NEVER;
          }
          return parsed.data;
        }),
      )
      .mutation(({ ctx, input }) => ctx.engine.variables.mutate(input)),
  }),
  executors: t.router({
    settings: p.query(({ ctx }) => ctx.engine.executors.settings()),
    models: p
      .input(executorModelsQuerySchema)
      .query(({ ctx, input }) => ctx.engine.executors.models(input)),
    profiles: p.query(({ ctx }) => ctx.engine.executors.listProfiles()),
    inspect: p
      .input(z.object({ workId: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.engine.executors.inspect(input.workId)),
    manage: p
      .input(executorOperationSchema)
      .mutation(({ ctx, input }) => ctx.engine.executors.manage(input)),
  }),
  connection: p.query(({ ctx }) => {
    const config = ctx.connection ?? developmentConnection();
    return { ...config, mcpUrl: new URL('/mcp', config.engineUrl).href };
  }),
  testbench: t.router({
    simulation: p
      .input(simulationRequestSchema)
      .mutation(({ ctx, input }) => ctx.engine.simulations.request(input)),
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
    trial: p
      .input(trialReadSchema)
      .query(({ ctx, input }) => ctx.engine.testbench.readTrial(input)),
    cleanupTrial: p.input(trialCleanupSchema).mutation(({ ctx, input }) => {
      const result = ctx.engine.testbench.cleanupTrial(input);
      ctx.engine.pump();
      return result;
    }),
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
    get: p
      .input(promptReadSchema)
      .query(({ ctx, input }) => ctx.engine.prompts.read(input)),
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
    starters: p.query(({ ctx }) => listStarters(ctx.engine)),
    importStarter: p
      .input(
        z
          .object({
            starterId: z.string().min(1).max(64),
            requestId: z
              .string()
              .min(1)
              .max(120)
              .refine((v) => /\S/.test(v), 'Use a nonblank request key'),
            copy: z.boolean().default(false),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) => importStarter(ctx.engine, input)),
    previewImport: p
      .input(z.object({ document: jsonSchema }))
      .query(({ ctx, input }) => {
        const doc = parseImportDocument(input.document);
        if (doc.kind === 'legacy')
          return {
            name: doc.workflow.name,
            description: doc.workflow.description,
            workflows: [] as { id: string; name: string; owned: boolean }[],
            prompts: [] as { id: string; name: string }[],
            published: false,
            variables: [],
          };
        const root = doc.bundle.workflows.find(
          (w) => w.id === doc.bundle.rootId,
        );
        if (!root)
          throw new InterlockError('Bundle is missing its root workflow');
        return {
          name: root.name,
          description: root.description,
          workflows: doc.bundle.workflows
            .filter((w) => w.id !== root.id)
            .map((w) => ({
              id: w.id,
              name: w.name,
              owned: !!w.ownerWorkflowId,
            })),
          prompts: (doc.bundle.prompts ?? []).map((p) => ({
            id: p.id,
            name: p.name,
          })),
          published: root.versions.length > 0,
          variables: ctx.engine.variables.previewRequirements(
            doc.bundle.variables ?? [],
          ),
        };
      }),
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
            variableBindings: variableImportBindingsSchema.optional(),
          })
          .strict(),
      )
      .mutation(({ ctx, input, signal }) =>
        githubImporter.import(
          ctx.engine,
          input.source,
          input.files,
          ctx.signal ?? signal,
          input.variableBindings,
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
          variableBindings: variableImportBindingsSchema.optional(),
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
            input.layout,
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
          input.layout,
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
            layout: draftLayoutSchema.optional(),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        ctx.engine.editDraft(
          input.id,
          input.draftRevision,
          input.edits,
          input.diagnostics,
          input.layout,
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
    externalInputStatus: p
      .input(externalInputStatusSchema)
      .query(({ ctx, input }) => ctx.engine.externalInputs.status(input)),
    externalInput: p
      .input(externalInputMutationSchema)
      .mutation(({ ctx, input }) => {
        try {
          return ctx.engine.externalInputs.mutate(input);
        } catch (error) {
          if (error instanceof InterlockError)
            throw new TRPCError({
              code:
                error instanceof ExternalInputConflict
                  ? 'CONFLICT'
                  : 'BAD_REQUEST',
              message: error.message,
              cause: error,
            });
          throw error;
        }
      }),
    previewHistoryDeletion: p
      .input(historyPreviewSchema)
      .query(({ ctx, input }) => ctx.engine.history.preview(input)),
    deleteHistory: p
      .input(historyDeletionSchema)
      .mutation(({ ctx, input }) => ctx.engine.history.delete(input)),
    contextGroup: p
      .input(contextGroupQuerySchema)
      .query(({ ctx, input }) => ctx.engine.contextGroups.read(input)),
    handoffContext: p
      .input(contextHandoffSchema)
      .mutation(({ ctx, input }) => ctx.engine.handoffContext(input)),
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
      .input(runStartSchema.extend({ limit: continuationLimitSchema }))
      .mutation(({ ctx, input }) =>
        ctx.engine.startSummary(
          input.workflowId,
          input.input,
          input.version,
          input.limit,
          input.budget,
          { requestId: input.requestId, externalTask: input.externalTask },
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
    summaries: p
      .input(runSummaryQuerySchema.default({}))
      .query(({ ctx, input }) => {
        const attention = new Map(
          ctx.engine.runAttention().map((entry) => [entry.runId, entry]),
        );
        const page = ctx.engine.store.runSummaries(input, [
          ...attention.keys(),
        ]);
        return {
          ...page,
          items: page.items.map((run) => ({
            ...run,
            attention: attention.get(run.id),
          })),
        };
      }),
    attention: p.query(({ ctx }) => ctx.engine.runAttention()),
    get: p.input(id).query(({ ctx, input }) => ctx.engine.inspect(input.id)),
    start: p
      .input(runStartSchema)
      .mutation(({ ctx, input }) =>
        ctx.engine.start(
          input.workflowId,
          input.input,
          input.version,
          input.budget,
          { requestId: input.requestId, externalTask: input.externalTask },
        ),
      ),
    cancel: p
      .input(cancelRunSchema)
      .mutation(({ ctx, input }) => ctx.engine.cancel(input.id, input.scope)),
    retry: p.input(id).mutation(({ ctx, input }) => ctx.engine.retry(input.id)),
  }),
  work: t.router({
    resources: p
      .input(workResourceRequestSchema)
      .mutation(({ ctx, input }) => ctx.engine.manageWorkResources(input)),
    hold: p
      .input(workHoldRequestSchema)
      .mutation(({ ctx, input }) => ctx.engine.manageWorkHold(input)),
    size: p
      .input(assignmentSizeQuerySchema)
      .query(({ ctx, input }) => ctx.engine.assignmentSizes.read(input)),
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
          session: sessionIdentitySchema.optional(),
          modelSelection: modelSelectionSchema.optional(),
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
    preflight: p
      .input(claim.extend({ output: jsonSchema }))
      .query(({ ctx, input }) =>
        ctx.engine.preflightResult(input.workId, input.token, input.output),
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
