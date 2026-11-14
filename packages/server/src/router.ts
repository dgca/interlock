import {
  stallSettingsUpdateSchema,
  stallRequestSchema,
  doctorOptionsSchema,
  reportFilterSchema,
  transcriptQuerySchema,
  messageReceiptQuerySchema,
} from '@interlock/core';
import {
  scheduleMutationSchema,
  scheduleReadSchema,
  scheduleTimingSchema,
  triggerListQuerySchema,
  pauseCreateSchema,
  pauseListSchema,
  pauseResumeSchema,
} from '@interlock/core';
import { startersQuery, importStarter } from './starters.js';
import { parseImportDocument } from '@interlock/core/importDocument';
import {
  scriptOperationSchema,
  workResourceRequestSchema,
  variableReadSchema,
  variableMutationSchema,
  variableImportBindingsSchema,
  executorOperationSchema,
  executorModelsQuerySchema,
} from '@interlock/core';
import { z } from 'zod';
import { developmentConnection } from './connection.js';
import {
  externalInputMutationSchema,
  externalInputStatusSchema,
  blankDefinition,
  importReview,
  boardMembershipSchema,
  boardImportSetupSchema,
  boardQuerySchema,
  saveBoardSchema,
  humanResponseSchema,
  requestListSchema,
  requestTargetSchema,
  simulationRequestSchema,
  workHoldRequestSchema,
  contextGroupQuerySchema,
  contextHandoffSchema,
  sessionIdentitySchema,
  modelSelectionSchema,
  assignmentSizeQuerySchema,
  definitionSchema,
  authoringJsonSchema,
  workflowLayoutInputSchema,
  workflowCatalogQuerySchema,
  draftLayoutSchema,
  workflowEditsSchema,
  jsonSchema,
  runQuerySchema,
  runSummaryQuerySchema,
  runStartSchema,
  runVersionReadSchema,
  setRunVersionPolicySchema,
  runVersionPreviewSchema,
  runVersionApplySchema,
  cancelRunSchema,
  previewRunCancellationSchema,
  cancelRunTreeSchema,
  InterlockError,
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  promptContentSchema,
  promptCreateSchema,
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
  continuationLimitSchema,
  reportUsageSchema,
  usageQuerySchema,
  setBudgetSchema,
  retentionScopeSchema,
  retentionUpdateSchema,
  historyPreviewSchema,
  historyDeletionSchema,
  modelAliasReadSchema,
  modelAliasMutationSchema,
} from '@interlock/core';
import { exportWorkflows, importWorkflows } from '@interlock/runtime/transfer';
import { workflowSyncStatus } from '@interlock/runtime/workflowSync';
import { workflowBundleSchema } from '@interlock/core/transfer';
import {
  previewBoardImport,
  previewLegacyBoardImport,
} from '@interlock/runtime/boardImport';
import { GithubImporter, githubSourceSchema } from './githubImport.js';
const githubImporter = new GithubImporter();
import { pricesRouter } from './prices.js';
import { launcherRouter } from './launcherRouter.js';
import { evaluationProcedures } from './evaluationProcedures.js';
import { runReadProcedures } from './runReadProcedures.js';
import { id, inputMutation, p, t } from './trpc.js';
import {
  agentDraftEdit,
  createWorkflow,
  scriptRouter,
} from './scriptApprovals.js';
const createWorkflowInput = z.object({
  layout: draftLayoutSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().default(''),
  definition: definitionSchema.optional(),
  ownerWorkflowId: z.string().min(1).nullable().optional(),
  imported: z.boolean().optional(),
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
  scripts: scriptRouter,
  prices: pricesRouter,
  launcher: launcherRouter,
  triggers: t.router({
    read: p
      .input(scheduleReadSchema)
      .query(({ ctx, input }) => ctx.engine.triggers.read(input)),
    list: p
      .input(triggerListQuerySchema)
      .query(({ ctx, input }) =>
        ctx.engine.triggers.list(
          input.workflowId,
          input.offset,
          input.limit,
          input.kind,
          { search: input.search, status: input.status },
        ),
      ),
    inspect: p
      .input(
        z.object({
          id: z.string().min(1),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(20),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.engine.triggers.inspect(input.id, input.offset, input.limit),
      ),
    preview: p
      .input(z.object({ timing: scheduleTimingSchema }))
      .query(({ ctx, input }) => ctx.engine.triggers.preview(input.timing)),
    attention: p
      .input(
        z
          .object({
            workflowId: z.string().optional(),
            offset: z.number().int().min(0).default(0),
            limit: z.number().int().min(1).max(100).default(20),
          })
          .default({}),
      )
      .query(({ ctx, input }) =>
        ctx.engine.triggers.attention(
          input.workflowId,
          input.offset,
          input.limit,
        ),
      ),
    manage: p.input(scheduleMutationSchema).mutation(({ ctx, input }) => {
      return ctx.engine.triggers.mutate(input);
    }),
  }),
  stalls: t.router({
    manage: p.input(stallRequestSchema).mutation(({ ctx, input }) => {
      if (input.action === 'settings') return ctx.engine.stalls.settings();
      if (input.action === 'configure') {
        const { action, ...q } = input;
        return ctx.engine.stalls.configure(q);
      }
      return ctx.engine.stalls.inspect(input.runId, input.offset, input.limit);
    }),
    settings: p.query(({ ctx }) => ctx.engine.stalls.settings()),
    configure: p
      .input(stallSettingsUpdateSchema)
      .mutation(({ ctx, input }) => ctx.engine.stalls.configure(input)),
    inspect: p
      .input(stallRequestSchema.options[2].omit({ action: true }))
      .query(({ ctx, input }) =>
        ctx.engine.stalls.inspect(input.runId, input.offset, input.limit),
      ),
  }),
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
  modelAliases: t.router({
    read: p
      .input(modelAliasReadSchema)
      .query(({ ctx, input }) => ctx.engine.modelAliases.read(input)),
    mutate: p
      .input(modelAliasMutationSchema)
      .mutation(({ ctx, input }) => ctx.engine.modelAliases.mutate(input)),
  }),
  executors: t.router({
    transcript: p
      .input(transcriptQuerySchema)
      .query(({ ctx, input }) => ctx.engine.executors.transcript(input)),
    receipt: p
      .input(messageReceiptQuerySchema)
      .query(({ ctx, input }) => ctx.engine.executors.messageReceipt(input)),
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
    ...evaluationProcedures,
  }),
  prompts: t.router({
    list: p.query(({ ctx }) => ctx.engine.prompts.list()),
    catalog: p.query(({ ctx }) => ctx.engine.store.promptCatalog()),
    instructions: p
      .input(id)
      .query(({ ctx, input }) => ctx.engine.prompts.get(input.id)),
    get: p
      .input(promptReadSchema)
      .query(({ ctx, input }) => ctx.engine.prompts.read(input)),
    create: p
      .input(promptCreateSchema)
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
  boards: t.router({
    list: p.query(({ ctx }) => ctx.engine.boards.list()),
    get: p
      .input(boardQuerySchema)
      .query(({ ctx, input }) => ctx.engine.boards.read(input)),
    settings: p
      .input(id)
      .query(({ ctx, input }) => ctx.engine.boards.settings(input.id)),
    save: p
      .input(saveBoardSchema)
      .mutation(({ ctx, input }) => ctx.engine.boards.save(input)),
    assign: p
      .input(boardMembershipSchema)
      .mutation(({ ctx, input }) =>
        ctx.engine.describeWorkflow(ctx.engine.boards.assign(input)),
      ),
  }),
  requests: t.router({
    list: p
      .input(requestListSchema.default({}))
      .query(({ ctx, input }) => ctx.engine.requests.list(input)),
    get: p
      .input(requestTargetSchema)
      .query(({ ctx, input }) => ctx.engine.requests.get(input)),
    answer: p
      .input(
        z.object({
          request: humanResponseSchema,
          source: z.enum(['ui', 'mcp']).default('ui'),
        }),
      )
      .mutation(({ ctx, input }) =>
        inputMutation(() =>
          ctx.engine.externalInputs.answer(input.request, input.source),
        ),
      ),
  }),
  workflows: t.router({
    starters: startersQuery,
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
            boardSetup: boardImportSetupSchema.optional(),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) => importStarter(ctx.engine, input)),
    previewImport: p
      .input(z.object({ document: authoringJsonSchema }))
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
            ...importReview([
              {
                name: doc.workflow.name,
                draft: doc.workflow.definition ?? blankDefinition(),
              },
            ]),
            boardSetup: previewLegacyBoardImport(
              doc.workflow.name,
              doc.workflow.definition ?? blankDefinition(),
            ),
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
          ...importReview(doc.bundle.workflows),
          variables: ctx.engine.variables.previewRequirements(
            doc.bundle.variables ?? [],
          ),
          boardSetup: previewBoardImport(ctx.engine.store, doc.bundle),
        };
      }),
    discoverGithub: p
      .input(z.object({ url: z.string().max(2000) }))
      .query(({ ctx, input, signal }) =>
        githubImporter.discover(
          input.url,
          ctx.signal ?? signal,
          ctx.engine.store,
        ),
      ),
    importGithub: p
      .input(
        z
          .object({
            source: githubSourceSchema,
            files: z.array(z.string().min(1).max(255)).min(1).max(50),
            variableBindings: variableImportBindingsSchema.optional(),
            boardSetup: boardImportSetupSchema.optional(),
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
          input.boardSetup,
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
          boardSetup: boardImportSetupSchema.optional(),
          publish: z.boolean().optional(),
          cascade: z.boolean().optional(),
          dryRun: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        importWorkflows(ctx.engine.store, input.bundle, {
          ...input,
          engine: ctx.engine,
        }),
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
    catalog: p
      .input(workflowCatalogQuerySchema.optional())
      .query(({ ctx, input }) => ctx.engine.store.workflowCatalog(input)),
    get: p
      .input(id)
      .query(({ ctx, input }) =>
        ctx.engine.describeWorkflow(ctx.engine.workflow(input.id)),
      ),
    saveLayout: p
      .input(workflowLayoutInputSchema)
      .mutation(({ ctx, input }) => ctx.engine.saveLayout(input)),
    createSummary: p
      .input(createWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.authoringSummary(createWorkflow(ctx, input)),
      ),
    updateSummary: p
      .input(updateWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.authoringSummary(
          agentDraftEdit(ctx, input.id, () =>
            ctx.engine.update(input.id, input),
          ),
        ),
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
        ctx.engine.describeWorkflow(createWorkflow(ctx, input)),
      ),
    previewOwnership: p
      .input(ownershipPreviewSchema)
      .query(({ ctx, input }) => ctx.engine.ownership.preview(input)),
    setOwner: p.input(ownershipChangeSchema).mutation(({ ctx, input }) => {
      const result = ctx.engine.ownership.set(input);
      return {
        ...result,
        workflow: ctx.engine.describeWorkflow(result.workflow),
      };
    }),
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
        agentDraftEdit(ctx, input.id, () =>
          ctx.engine.editDraft(
            input.id,
            input.draftRevision,
            input.edits,
            input.diagnostics,
            input.layout,
          ),
        ),
      ),
    validate: p
      .input(
        z
          .object({
            id: z.string(),
            definition: authoringJsonSchema.optional(),
          })
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
      .mutation(({ ctx, input }) => {
        const result = ctx.engine.createChild(input);
        return {
          parent: ctx.engine.describeWorkflow(result.parent),
          child: ctx.engine.describeWorkflow(result.child),
        };
      }),
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
      .mutation(({ ctx, input }) =>
        ctx.engine.describeWorkflow(ctx.engine.useChildVersion(input)),
      ),
    update: p
      .input(updateWorkflowInput)
      .mutation(({ ctx, input }) =>
        ctx.engine.describeWorkflow(
          agentDraftEdit(ctx, input.id, () =>
            ctx.engine.update(input.id, input),
          ),
        ),
      ),
    delete: p
      .input(id)
      .mutation(({ ctx, input }) => ctx.engine.deleteWorkflow(input.id)),
    clone: p
      .input(id)
      .mutation(({ ctx, input }) =>
        ctx.engine.describeWorkflow(ctx.engine.clone(input.id)),
      ),
    publish: p
      .input(id.extend({ cascade: z.boolean().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.engine.describeWorkflow(
          ctx.engine.publish(input.id, input.cascade),
        ),
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
    script: p
      .input(scriptOperationSchema)
      .mutation(({ ctx, input }) => ctx.engine.manageScript(input)),
    externalInputStatus: p
      .input(externalInputStatusSchema)
      .query(({ ctx, input }) => ctx.engine.externalInputs.status(input)),
    externalInput: p
      .input(externalInputMutationSchema)
      .mutation(({ ctx, input }) =>
        inputMutation(() => ctx.engine.externalInputs.mutate(input)),
      ),
    retentionSettings: p
      .input(retentionScopeSchema.default({}))
      .query(({ ctx, input }) => ctx.engine.retention.settings(input)),
    configureRetention: p
      .input(retentionUpdateSchema)
      .mutation(({ ctx, input }) => ctx.engine.retention.configure(input)),
    retentionStatus: p.query(({ ctx }) => ctx.engine.retention.status()),
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
    versionPolicy: p
      .input(runVersionReadSchema)
      .query(({ ctx, input }) => ctx.engine.runVersions.read(input)),
    setVersionPolicy: p
      .input(setRunVersionPolicySchema)
      .mutation(({ ctx, input }) => ctx.engine.runVersions.setPolicy(input)),
    previewVersionMove: p
      .input(runVersionPreviewSchema)
      .query(({ ctx, input }) => ctx.engine.runVersions.preview(input)),
    applyVersionMove: p
      .input(runVersionApplySchema)
      .mutation(({ ctx, input }) => ctx.engine.runVersions.apply(input)),
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
          {
            requestId: input.requestId,
            externalTask: input.externalTask,
            title: input.title,
            tags: input.tags,
            priority: input.priority,
            after: input.after,
            onActiveExternalTask: input.onActiveExternalTask,
            versionPolicy: input.versionPolicy,
          },
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
      .query(({ ctx, input }) =>
        ctx.engine.projectRuns(ctx.engine.store.findRuns(input)),
      ),
    ...runReadProcedures,
    summaries: p
      .input(runSummaryQuerySchema.default({}))
      .query(({ ctx, input }) => {
        const requests = ctx.engine.requests.byCard();
        const attention = new Map(
          ctx.engine
            .runAttention([...requests.values()].flat())
            .map((entry) => [entry.runId, entry]),
        );
        const page = ctx.engine.store.runSummaries(input, [
          ...attention.keys(),
        ]);
        return {
          ...page,
          scheduleAttentionCount: ctx.engine.triggers.attention(
            input.workflowId,
            0,
            1,
          ).total,
          items: ctx.engine.projectRuns(page.items).map((run) => ({
            ...run,
            attention: attention.get(run.id),
            request: requests.get(run.id)?.[0]?.target,
            attentionCount: requests.get(run.id)?.length,
          })),
        };
      }),
    attention: p.query(({ ctx }) => ctx.engine.runAttention()),
    get: p.input(id).query(({ ctx, input }) => ctx.engine.inspect(input.id)),
    start: p.input(runStartSchema).mutation(({ ctx, input }) =>
      ctx.engine.start(
        input.workflowId,
        input.input,
        input.version,
        input.budget,
        {
          requestId: input.requestId,
          externalTask: input.externalTask,
          title: input.title,
          tags: input.tags,
          priority: input.priority,
          after: input.after,
          onActiveExternalTask: input.onActiveExternalTask,
          versionPolicy: input.versionPolicy,
        },
      ),
    ),
    previewCancellation: p
      .input(previewRunCancellationSchema)
      .query(({ ctx, input }) => ctx.engine.previewRunCancellation(input)),
    cancelTree: p
      .input(cancelRunTreeSchema)
      .mutation(({ ctx, input }) => ctx.engine.cancelRunTree(input)),
    cancel: p
      .input(cancelRunSchema)
      .mutation(({ ctx, input }) => ctx.engine.cancel(input.id, input.scope)),
    retry: p.input(id).mutation(({ ctx, input }) => ctx.engine.retry(input.id)),
  }),
  pauses: t.router({
    list: p
      .input(pauseListSchema)
      .query(({ ctx, input }) => ctx.engine.pauses.list(input)),
    pause: p
      .input(pauseCreateSchema)
      .mutation(({ ctx, input }) => ctx.engine.pauses.create(input)),
    resume: p.input(pauseResumeSchema).mutation(({ ctx, input }) => {
      const result = ctx.engine.pauses.resume(input.id);
      ctx.engine.pump();
      return result;
    }),
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
          claimTicket: z.string().optional(),
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
  report: t.router({
    summary: p
      .input(reportFilterSchema.optional())
      .query(({ ctx, input }) => ctx.engine.report(input ?? {})),
  }),
  system: t.router({
    workflowSync: p.query(({ ctx }) => workflowSyncStatus(ctx.engine)),
    doctor: p
      .input(doctorOptionsSchema.optional())
      .query(({ ctx, input }) => ctx.engine.doctor(input ?? undefined)),
    report: p
      .input(reportFilterSchema.optional())
      .query(({ ctx, input }) => ctx.engine.report(input ?? {})),
  }),
});
export type AppRouter = typeof appRouter;
