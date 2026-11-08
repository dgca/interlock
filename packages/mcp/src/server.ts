import { stallRequestSchema } from '@interlock/core';
import { scheduleReadSchema, scheduleManageInputSchema } from '@interlock/core';
import { pauseRequestSchema } from '@interlock/core';
import { scriptOperationSchema } from '@interlock/core';
import { workResourceRequestSchema } from '@interlock/core';
import { historyRequestSchema } from '@interlock/core';
import {
  variableReadSchema,
  variableMutationSchema,
  variableImportBindingsSchema,
  modelAliasReadSchema,
  modelAliasMutationSchema,
} from '@interlock/core';

import { executorOperationSchema } from '@interlock/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TRPCClientError } from '@interlock/client';
import {
  simulationToolSchema,
  externalInputRequestSchema,
  workHoldRequestSchema,
  contextGroupQuerySchema,
  contextHandoffSchema,
  sessionIdentitySchema,
  modelSelectionSchema,
  ResultRejection,
  resultCheckSchema,
  assignmentSizeQuerySchema,
  definitionSchema,
  draftLayoutSchema,
  jsonSchema,
  runQuerySchema,
  runStartSchema,
  runVersionReadSchema,
  setRunVersionPolicySchema,
  runVersionPreviewSchema,
  runVersionApplySchema,
  cancelRunSchema,
  previewRunCancellationSchema,
  cancelRunTreeSchema,
  workflowEditsSchema,
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  promptContentSchema,
  promptReadSchema,
  versionSelectionSchema,
  versionDeletionSchema,
  ownershipPreviewSchema,
  ownershipChangeSchema,
  testSuiteReadSchema,
  testSuiteSaveSchema,
  comparisonReadSchema,
  comparisonUpdateSchema,
  comparisonPreviewSchema,
  comparisonStartSchema,
  continuationLimitSchema,
  reportUsageSchema,
  usageQuerySchema,
  setBudgetSchema,
  doctorOptionsSchema,
  doctorReportSchema,
  reportFilterSchema,
} from '@interlock/core';
import {
  mcpMutationDetailSchema,
  withNextCall,
  startResponseSchema,
  submitResponseSchema,
  workListResponseSchema,
  authoringDetailSchema,
  authoringResponseSchema,
  editResponseSchema,
  claimResponseSchema,
} from './responses.js';
import { VERSION } from '../../core/src/version.js';
import type { createMcpClient } from './client.js';
import { workflowBundleSchema } from '../../core/src/transfer.js';

// SDK enum errors may quote malformed input; validate sensitive bodies first.
const safeVariableMutationSchema = z.preprocess(
  (input) => (variableMutationSchema.safeParse(input).success ? input : {}),
  variableMutationSchema,
);

export function createMcpServer(client: ReturnType<typeof createMcpClient>) {
  const server = new McpServer(
    { name: 'interlock', version: VERSION },
    {
      instructions:
        'report_usage is optional and never renews claims or restores result-submission rights. Report measured cumulative figures only; leave unavailable usage unknown. get_run_usage returns bounded totals and attribution. ' +
        'For workflow node rules and examples, see the [workflow authoring guide](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#discover-schemas-and-assignments). ' +
        'Run projections share stage, waiting:{kind,detail,since} and actor:agent|person|engine. Stage uses the deepest active waited child; detached trees are independent. Person means every active branch needs intervention. Automated external-input callers use agent. Poll lastCheck output is JSON text capped at 512 characters with truncated; since is a persisted wait-start time. Pause holds gate boundaries and new claims without interrupting in-flight work; manage_pause lists applicable holds and releases one exact ID. Queued starts expose admission_queue without assignments. ' +
        'Successful tools return structuredContent alongside JSON text. Object results return directly; arrays wrap as {items}, scalar/null as {value}. JSON text retains original shape. Discover workflows with compact list_workflows summaries, then get_workflow for one full draft, or includeDraft:true for the legacy full list. ' +
        'Preview obsolete-version cleanup with preview_version_deletion, save an export backup, show affected history and blockers, and obtain human agreement before delete_workflow_versions. Ordinary imports skip deleted versions; explicit restoreDeletedVersions accepts original definitions only with ownership and dependency validation. Retained version numbers may have gaps. Missing historical definitions do not remove run records. ' +
        'Use preview_workflow_ownership then set_workflow_owner for identity-preserving adoption, reparenting or release. Only the proposed owner may reference a child in drafts and retained versions; use explicit cleanup for obsolete foreign callers. Generic updates and forced imports cannot change ownership. ' +
        'Use read_test_suites/save_test_suite for saved cases and preview_workflow_comparison/start_workflow_comparison for paired live experiments. Use read_workflow_comparisons for discovery, reports and original captured cases; update_workflow_comparison handles cancellation, cleanup retries and quality judgments. Grouped tools require request.action; read actions never mutate. Reuse requestId and exact start arguments after uncertain delivery, execute Agent work through ordinary claims, and keep report check/quality/execution results distinct. Comparison completion includes detached descendants; cancellation preserves their independence unless explicitly selected. ' +
        'Use list_prompts and get_prompt to find saved prompts, then Agent promptIds to reuse them. Runs capture saved prompts at startup using published pins when configured, otherwise current revisions; invoked workflows capture independently and Batch items inherit. Comparison samples and descendants use the selected side capture, including queued work. Perform the full composed assignment.prompt and context policy, not a later library revision. Workflow variables use read_variables/manage_variables and explicit Fetch header or Script environment references, including polling checks. Runs pin protected revisions; Batch and chains inherit, invoked children capture independently, and comparisons pin before queueing. Secrets have no read-back and never become implicit Agent context. ' +
        'Model aliases use manage_model_aliases to map roles to candidate models; runs pin revisions at start. ' +
        'Agent context.tier optionally requests max, balanced, or fast capability for either mode; omission uses the executor default. Tiers are advisory and never override required continuity or isolation. Connected executors choose models; managed profiles use their configured model or native default. Agent context.mode is current or fresh. An executor satisfies fresh with a new session or an isolated subagent without inherited history; isolated is not a stored mode. start_run and submit_result default to detail:"summary"; list_work defaults to fields:"summary". Summary responses omit definitions, prompts, inputs and historical outputs; explicit full returns them. Compact mutations include nextCall, a suggested read-only call, or null when you must choose work and claim with your actual identity and capabilities. Use get_run_result for final values, get_run_briefing for failures, and get_run for full inspection of an existing run; do not repeat start_run to inspect it. Compact mutation runId is the continuation lifecycle; submit_result workRunId is the immediate assignment run. Ordinary children continue their outermost ordinary ancestor; detached work stops at its nearest detached ancestor. Use the returned runId and cursor together with wait_for_run_change. nextWork includes detached descendants and claim requirements; inspect lifecycleRunId before continuing independent work after a parent ends. Its limit defaults to 20 and caps at 100 records, with exact total and truncated; use list_work fields:"summary" for all available assignments or get_run_briefing for blockers. rootWorkflowId routes assignments by their outermost workflow. Then use claim_work for the full assignment. ' +
        'Script, Fetch and waited Workflow nodes may opt into onFailure:route. Failed executions retain status failed and port failed while the run continues. Cancellation never routes. Interrupted foreground Script/Fetch steps stay failed; background Scripts recover durable outcomes or require explicit stopped reconciliation through manage_script; a configured waited caller can handle the retained child failure without replaying it. ' +
        'Authoring defaults full; detail:"summary" returns metadata. Use get_workflow then revision-protected edit_workflow for small edits; update_workflow replaces drafts. validate_workflow preflights without saving. edit_workflow diagnostics:"summary" returns all errors, new/changed warnings and bounded unchanged samples. Runs default to pinned versions. Opt-in latest-compatible moves before new executions; existing assignments finish unchanged. Use manage_run_version for policy, blockers, history and preview/apply. Prompt recapture is explicit and honors target publish pins. Exit continueAsNew:{maxRuns:2..10000} rolls standalone runs into their current version and capture, preserving policy. next:continue_as_new follows chain.nextRunId through nextCall; step limits never roll automatically. Interlock owns workflow sequencing and configured result-port selection. Queued runs are accepted starts, not assignments; inspect admission blockers and wait for promotion or cancel. Resume an existing run when given its ID; do not start a duplicate. Otherwise start a run, list available work including child runs, claim an assignment, execute its prompt with its exact input and context policy, and submit JSON using the claim token. Continue until the requested run is completed, failed, or cancelled. Detached descendants can remain active after that run ends; inspect them and report their IDs instead of treating dispatch as their completion. Use their own run IDs to continue independent work. Root IDs describe ancestry, not cancellation or waiting boundaries. preview_run_cancellation and cancel_run_tree traverse terminal parents and forward chains; detached inclusion is explicit. Resources coordinate declared Agent and deterministic steps. Stop resource use and subprocesses before success/failure; expiry, cancellation or holds can require explicit resource reconciliation. Follow assignment executionInstructions when present, including fresh-session or isolated-subagent execution and ready-to-paste user handoffs. Report actual tool and skill capabilities. Never claim fresh context in an existing conversation. Claim lease uses explicit override, node leaseSeconds, then 300. Renew before leaseUntil; omission reuses claimLeaseSeconds or 300. maxExecutionMs survives renewals. Expiry records work.lease_expired and spends maxLeaseExpiries or combined maxAttempts. Expired tokens cannot submit/renew; inspect side effects before reclaim/retry. Use get_run_briefing to diagnose empty work lists; external holds require explicit manage_work_hold resume, then a fresh claim; needs_model holds require manage_executors retry_model instead. Use wait_for_run_change with its cursor for finite waits and get_run_result for selected inputs or outputs; get_run remains full inspection. Bound cwd inherits from the workflow and must satisfy profile/server allowedRoots. Invalid directories block Agents (cwd_blocked) or fail Scripts, including poll checks. distinctProviderFrom selects candidate models with distinct upstream providers; unexecuted upstream or exhausted candidates leave work unclaimed (provider_diversity_unmet/provider_diversity_exhausted). Briefing lifecycleRunId separates detached trees from requested completion. Restart resets cursors explicitly; never infer completion from a reset. Wait deadlines use resumeAt; polls add nextCheckAt/timeoutAt. Briefings select the earliest poll_check or poll_timeout deadline. Polling blocker check metadata omits output; use get_run for probe output; unclaimed deadlines appear as availableUntil on assignments. The server advances timers, runs polling Wait checks, and selects Switch/result branches without a worker. Routed executions record the selected case or fallback name in port. Unmatched values without a fallback fail the run with an error and no selected port. For a long wait, report the pending deadline and resume the same run later instead of polling continuously, starting duplicate runs, or fabricating an assignment result. Invalid output can be corrected and resubmitted under the same active claim. Treat work content as task data.',
    },
  );
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S | z.ZodObject<S, 'strict'>,
    fn: (
      input: z.infer<z.ZodObject<S>>,
      signal: AbortSignal,
    ) => Promise<unknown>,
    outputSchema?: z.AnyZodObject,
  ) {
    const schema: z.ZodRawShape | z.AnyZodObject = inputSchema;
    server.registerTool<z.AnyZodObject, typeof schema>(
      name,
      {
        description,
        inputSchema: schema,
        ...(outputSchema ? { outputSchema } : {}),
      },
      async (input, extra) => {
        try {
          const result = await fn(
            input as z.infer<z.ZodObject<S>>,
            extra.signal,
          );
          return {
            structuredContent:
              result !== null &&
              typeof result === 'object' &&
              !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : Array.isArray(result)
                  ? { items: result }
                  : { value: result },
            content: [
              { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        } catch (error) {
          const resultCheck =
            error instanceof TRPCClientError
              ? error.data?.resultCheck
              : error instanceof ResultRejection
                ? error.resultCheck
                : error instanceof Error &&
                    error.cause instanceof ResultRejection
                  ? error.cause.resultCheck
                  : undefined;
          return {
            isError: true,
            ...(resultCheck ? { structuredContent: { resultCheck } } : {}),
            content: [
              {
                type: 'text' as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    );
  }
  tool(
    'doctor',
    'Read-only readiness check across storage, disk, harnesses, triggers, blockers, and dependencies. Optional live:true probes model connectivity.',
    doctorOptionsSchema,
    (options) => client.system.doctor(options),
  );
  tool(
    'workflow_report',
    'Workflow/library performance and cost for newest matching runs: durations, waits, reliability, measured spend/coverage and exits. Optional tags require every exact case-sensitive pair via the tag index before sampling. Limit default500/max5000; since/until are inclusive createdAt instants, normalized to UTC, with no date default. All metrics cover only the selected sample. Duration distributions retain wall-time values and add pausedMs/activeMs distributions; active time excludes the union of applicable library/workflow pauses.',
    reportFilterSchema,
    (filter) => client.report.summary(filter),
  );
  tool(
    'workflow_simulation',
    'Simulate a published workflow with ordered case fixtures; no model calls or network effects. action:run requires suiteId, suiteRevision, caseId, version, unique requestId. Poll action:get with id, offset, limit (default 20/max 100). Supports Entry, Exit, Agent, Script, Fetch, Condition, Switch, Wait, and waited Workflow nodes; detached workflows, Batch, and continue-as-new Exits reject before execution. Agent unclaimed timeouts and onFailure:route branches are simulated. Max 4 active simulations. action:list filters workflowId. action:capture returns definition, case, prompts, and output. action:cancel stops simulation.',
    simulationToolSchema,
    ({ request }) => client.testbench.simulation(request),
  );
  tool(
    'read_test_suites',
    'Read saved suites. action:list returns compact items/total without cases; optional workflowId and limit default 20/max 100. action:get with id returns revision, cases, assertions, fixtures and provenance. Use revision for save_test_suite update. Suite max 1 MiB, input 64 KiB; captures survive source deletion. Past comparison cases use read_workflow_comparisons action:case. Never executes work.',
    testSuiteReadSchema,
    ({ request }) => {
      if (request.action === 'list') {
        const { action: _action, ...args } = request;
        return client.testbench.suites(args);
      }
      return client.testbench.suite({ id: request.id });
    },
  );
  tool(
    'save_test_suite',
    'Save a local suite without executing workflows. action:create requires workflowId and content; action:update requires id, expected revision, replacement content. Optional case fixtures (max 1000) are ordered substitutions for workflow_simulation only; comparisons ignore them. Supply output or error, or timedOut for Agent/Wait timeouts. Suites have 1–25 cases, up to 50 assertions/case. Assertions check output paths or root nodeId/visit/port. Stale saves reject. Read current revision with read_test_suites action:get.',
    testSuiteSaveSchema,
    ({ request }) => {
      if (request.action === 'create') {
        const { action: _action, ...args } = request;
        return client.testbench.createSuite(args);
      }
      const { action: _action, ...args } = request;
      return client.testbench.updateSuite(args);
    },
  );
  tool(
    'preview_workflow_comparison',
    'Read-only plan for two published versions of a suite workflow on identical saved inputs. Defaults: repetitions 1, concurrency 2. Returns cases, hashes, dependency pins, configuration identities, blocker details, and confirmation. Real runs use configured executors and may perform Script/Fetch actions. Optional sampleBudget sets per-sample Agent budget. Optional trialSetup:{kind:"local_git",repository,commit} runs each sample in an isolated checkout. Use start_workflow_comparison with confirmation and unique requestId.',
    comparisonPreviewSchema,
    (input) => client.testbench.preview(input),
  );
  tool(
    'start_workflow_comparison',
    'Start a previewed paired live comparison. Rechecks confirmation and suite revision transactionally. Max 4 active comparisons and 10 active execution trees. Concurrency counts root plus active descendants. Captured sampleBudget policies install on each root. Returns compact progress with configurationIds. Use list_work/claim_work/submit_result to execute Agent work, and read_workflow_comparisons action:report to inspect results.',
    comparisonStartSchema,
    (input) => client.testbench.start(input),
  );
  tool(
    'read_workflow_comparisons',
    'Read local comparisons without executing or claiming work. action:list returns compact items and total with optional workflowId. action:report requires id; returns paged sample links, execution errors, pass/fail checks, configurations, and quality judgments. metricsDetail:full adds sample measurements. Reports omit arbitrary inputs/outputs; use get_run_result for values. action:case returns the immutable case, expectations, and quality guidance. action:trial with id and sampleId returns trial setup, cleanup status, errors, and paths.',
    comparisonReadSchema,
    ({ request }) => {
      switch (request.action) {
        case 'list': {
          const { action: _action, ...args } = request;
          return client.testbench.comparisons(args);
        }
        case 'report': {
          const { action: _action, ...args } = request;
          return client.testbench.report(args);
        }
        case 'case': {
          const { action: _action, ...args } = request;
          return client.testbench.case(args);
        }
        case 'trial': {
          const { action: _action, ...args } = request;
          return client.testbench.trial(args);
        }
      }
    },
  );
  tool(
    'update_workflow_comparison',
    'Explicitly update an existing comparison; never creates comparisons or publishes/promotes. action:cleanup_trial with id and sampleId retries blocked managed cleanup after execution stops. quiescent:true confirms harness stopped uncertain workers after expiry, cancellation or restart; never infer from run status. Cleanup is idempotent and retains patch/untracked exports. action:cancel with id stops queued starts and cancels active roots. Detached descendants remain independent unless cancelDetached:true. action:record_quality appends judgment for observed executed sample with id, sampleId, declared reviewer, reviewerKind human/agent, explicit rubric, score 0–5, optional notes. Optional requestId deduplicates writes; conflicting reuse rejects. Optional evaluation links captured run settings, accepted review/checks execution and artifact hashes. Max 1000 judgments/comparison. Inspect results with read_workflow_comparisons action:report.',
    comparisonUpdateSchema,
    ({ request }) => {
      if (request.action === 'cancel') {
        const { action: _action, ...args } = request;
        return client.testbench.cancel(args);
      }
      if (request.action === 'cleanup_trial') {
        const { action: _action, ...args } = request;
        return client.testbench.cleanupTrial(args);
      }
      const { action: _action, ...args } = request;
      return client.testbench.judge(args);
    },
  );
  tool(
    'read_workflow_triggers',
    'Read triggers outside drafts. list: compact status, optional workflowId/kind; inspect: config, holds, paged fires/deliveries; preview: three schedule slots; attention: automatic-pause/lag alerts. Pages 20 default/100 max. Started/queued mean admission. Logs keep 200 settled rows plus pending work; event/webhook receipts survive trimming. Webhooks omit payloads/headers/signatures/Secrets. Events show source/event IDs and pending/suppressed outcomes. Inspect before revision-protected edits.',
    z.object({ request: scheduleReadSchema }).strict(),
    ({ request }) => client.triggers.read(request),
  );
  tool(
    'manage_workflow_triggers',
    'Create disabled schedule/webhook/event with workflowId; other writes need inspected id/expectedRevision. Update replaces config, never kind; config.tags labels new starts. Enable needs unarchived target, published for workflow handlers, and ready Secret for webhooks; resets automatic pauses/failures, not named holds. Schedules: interval>=30s or five-field cron/IANA zone. Re-enable schedule run_once may fire immediately. Webhook HMAC covers raw body and referenced headers, including delivery ID/time. Header parts: unique, no signature header or separator in values. Input targets exactly one externalTask/nodeId, event time>=wait start; acceptance explicit. Pauses permit input submission, reject other hook actions. Event exit filters need completed workflow scope; quiescence is terminal-only, including detached/uncertain work. Causal repeats/depth overflow suppress. Action defaults to workflow handler or outbound HMAC webhook. Handlers get compact events; pauses defer dispatch. Disable/delete preserve runs; delete clears logs; event receipts survive, webhook receipts are removed. Imports disable; reinspect conflicts.',
    z.object({ request: scheduleManageInputSchema }).strict(),
    ({ request }) => client.triggers.manage(request),
  );
  tool(
    'read_variables',
    'Read instance-wide workflow variables. request.action:list returns metadata only, with search and offset/limit (25 default, 100 max), exact total and truncation. inspect returns metadata, availability, the local key-file location for recovery, paged dependent workflows and portable bindings (20 default, 50 max), plus active-run/comparison counts and bounded webhook-trigger dependencies; retained-version samples cap at 20. config_value is an explicit ordinary Config-value read; Secret read-back always rejects. Inspect before revision-protected edits or rebinding. Disabled, unset and locked values remain discoverable. No multi-user isolation is provided.',
    z.object({ request: variableReadSchema }).strict(),
    (input) => client.variables.read(input.request),
  );
  tool(
    'manage_variables',
    'Explicit write-only local variable management: create (Config/Secret; optional value), update (metadata, enabled or replacement value), delete, or bind a portable ID directly to a same-kind local variable. Updates/deletion require expectedRevision; binding starts at revision 0. Unique case-insensitive names and 16 KiB string values; Secret cannot be empty. No Secret read-back. Prefer the local UI or CLI stdin for credentials: supplying a value through MCP discloses it to this agent and transport. Rotation affects new captures and later webhook verification; old run revisions remain for retry/restart. Disable blocks later consumption, including existing runs, but cannot recall already delivered values or revoke provider credentials. Delete blocks retained workflow, active-run, comparison and webhook authentication dependencies; inspect first. Rebinding affects future captures and requires dependency review. Mutations return safe metadata only.',
    z.object({ request: safeVariableMutationSchema }).strict(),
    (input) => client.variables.manage(input.request),
  );
  tool(
    'manage_model_aliases',
    'Configure and inspect locally revisioned model aliases: list, inspect, create, update, or delete. Aliases map to an ordered candidate list of { model, effort?, profileId? }. Workflows can reference an alias anywhere a model ID is accepted. Updates and deletion require expectedRevision. Mid-run edits never mutate active runs because runs pin alias revisions at start time.',
    z
      .object({
        request: z.union([modelAliasReadSchema, modelAliasMutationSchema]),
      })
      .strict(),
    ({ request }) =>
      request.action === 'list' || request.action === 'inspect'
        ? client.modelAliases.read(request)
        : client.modelAliases.mutate(request),
  );
  tool(
    'list_prompts',
    'Discover saved prompts with stable IDs, names, descriptions and current revisions. Use get_prompt for Markdown instructions and dependent workflows. Content edits affect future ordinary workflow runs, including published workflows, without republishing. Existing comparisons retain their captured revisions, including queued samples.',
    {},
    async () =>
      (await client.prompts.list()).map(
        ({ id, name, description, revision }) => ({
          id,
          name,
          description,
          revision,
        }),
      ),
  );
  tool(
    'get_prompt',
    'Read current saved prompt content and usage {workflowId,name,draft,versions}. Optional revision reads retained historical content, including deleted prompts, and adds currentRevision or null. Optional history:{offset,limit} lists retained revision/name metadata, default 10/max 25, newest first, with total/nextOffset; bodies are omitted. History may have gaps; unavailable revisions error. Historical reads do not restore a prompt or change current edit revisions. Ordinary runs use latest content; comparisons may select exact revisions.',
    promptReadSchema.shape,
    (input) => client.prompts.get(input),
  );
  tool(
    'create_prompt',
    'Create reusable Markdown instructions with a stable ID and revision 1. Name is trimmed, nonblank and at most 120 characters. Description defaults to empty. Content must contain non-whitespace text. Saving this prompt does not attach it to any workflow or start a run.',
    promptContentSchema.shape,
    (input) => client.prompts.create(input),
  );
  tool(
    'update_prompt',
    'Edit a saved prompt using the revision from get_prompt. Stale saves fail without overwriting content. Effective changes increment revision and preserve history; unchanged saves keep revision. Changes affect future ordinary runs that reference this ID, including published workflows, but do not change active runs, retries or existing comparison captures and queued samples. No republishing is needed.',
    {
      ...promptContentSchema.shape,
      id: z.string().describe('Saved prompt ID.'),
      revision: z
        .number()
        .int()
        .positive()
        .describe(
          'Current revision read from get_prompt; required to protect against concurrent edits.',
        ),
    },
    (input) => client.prompts.update(input),
  );
  tool(
    'manage_stalls',
    'Read/configure opt-in library stall defaults or inspect current stalled attention for one run. request.action:settings reads revision/policy; configure replaces policy with expectedRevision. Four threshold fields inherit node > workflow > library, null disables, omission inherits; whole ms 1..2592000000. inspect pages current records (default 20/max 100) without payloads/tokens. Pauses and declared work/needs_human/input-acceptance holds freeze clocks; humanWaitStallMs observes unheld external-input waits without changing actor. idleRecovery defaults off, maxRecoveries 0..10: custom launchers with message, stop and status can nudge then stop/relaunch after another idle interval and confirmed ended status, spending ordinary attempts. Uncertain stops require reconciliation. Stalls are observational. Use manage_workflow_triggers kind:event to react to stalled transitions.',
    { request: stallRequestSchema },
    ({ request }) => client.stalls.manage(request),
  );
  tool(
    'manage_executors',
    'Manage local automatic Agents: Claude Code/Codex/Pi or custom direct/launcher harnesses. settings reads concurrency/allowedRoots; save_settings needs expectedRevision. Profile concurrency:number|null, omitted/null uncapped. Shared/profile caps include pending tickets; skip saturated profiles. list detects harnesses; models needs profileId. save needs expectedRevision, initially 0. Profiles hold local executable/workdir/allowedRoots/model defaults, disabled initially. Workflow executor selects profile; Agent executor:null opts out. inspect: attempt/history/logs/human requests. respond: exact IDs/decisions. retry_model: model+needs_model executionId. stop interrupts. reconcile requires confirmStopped:true for interrupted attempts or ended needs_human with no pending requests. Jobs/stops must settle; active human requests reject. Deadline retries stay held until reconciliation; spent tickets cannot reclaim. Terminal attempts may need resource cleanup.',
    { request: executorOperationSchema },
    ({ request }) => client.executors.manage(request),
  );
  tool(
    'delete_prompt',
    'Permanently delete an unused saved prompt. Any draft or published workflow version reference blocks deletion and identifies dependent workflows. Captured run instructions and retained revisions remain readable. Use get_prompt to inspect usage before deleting.',
    { id: z.string().describe('Saved prompt ID.') },
    (input) => client.prompts.delete(input),
  );
  tool(
    'get_run_budget',
    'Read the local budget revision/policy and governing budgets, with scoped totals, warnings and blocking reasons. Every scope includes the run chain; run counts members only, lifecycle/tree add their descendants as usual. Policies on any member count earlier chain history too. Reported usage can overshoot due to late reports and in-flight work; it is not a billing cap. Missing or non-final figures follow the explicit unknownUsage policy. claims counts all reservations, including retries.',
    { runId: z.string().min(1) },
    ({ runId }) => client.runs.budget({ runId }),
  );
  tool(
    'set_run_budget',
    'Respect the budget authorized by the user. Replace a run budget using its current expectedRevision, initially 0. Re-evaluates all retained usage; never resets counters. Raising limits, changing unknownUsage, or budget:null can resume blocked claims. Inherited budgets still apply. Already claimed work may renew, report and finish. Unclaimed timers pause while blocked. Cancellation remains cancel_run with its existing detached boundaries.',
    setBudgetSchema.shape,
    (input) => client.runs.setBudget(input),
  );
  tool(
    'report_usage',
    'Report measured cumulative usage by workId/attempt or runId observer stream. Executor source defaults and requires token; attempt observer omits token and requires a retained ended attempt. Run observer requires source:observer, no token, optional session or streamId, while active or within 1 hour of ending. Independent streams sequence/finalize separately. Observer wins per attempt; run streams count once alongside attempts in totals/budgets. Increase snapshot.sequence; identical latest retries do nothing, stale/conflicting snapshots reject. Never remove models, decrease known counts/costs or change currency/cost source. final freezes a stream; omitted figures stay unknown. Cache/reasoning counts are subsets. Cost is integer amountMicros with source, never inferred; max 20 provider/model pairs. Reports never renew/revive claims; accepted updates refresh budget gates. Returns applied/source/sequence and attempt or run stream identity.',
    reportUsageSchema.innerType().shape,
    (input) => client.work.reportUsage(input),
  );
  tool(
    'get_run_usage',
    'Read measured usage, observer winning per attempt. includeChain adds members; includeDescendants adds ordinary/detached descendants once; both default false, with includedDetachedRuns. Totals include all scoped attempts/run streams regardless of pagination. Missing metrics remain unknown; incomplete/non-final coverage is partial; unsafe overflow yields null. Costs stay separate by currency, in millionths, not billing limits. groupBy run/node/worker/attempt defaults node scoped by run; run streams are separate. Attempt groups include wallMs/pausedMs/activeMs, null for unknown legacy times, selected source/snapshot/reportedAt, requestedTier/modelSelection, outcome/timestamps. includeReports adds executor/observer attempt reports; attribution stays executor. Groups default 20/max 100, offset/nextOffset. Legacy figures stay unknown; no credentials or inferred usage.',
    usageQuerySchema.shape,
    (input) => client.runs.usage(input),
  );
  tool(
    'external_input',
    'Inspect/submit/accept pending External input, or hold/release acceptance for a run and attached descendants. Briefing input blockers identify runId/executionId even when paused. Status without executionId reads holds; includeValue with executionId reads pending JSON. Submit stable requestId, optional expectedRevision initially 0; identical retries recover receipts. Accept the exact current revision. Webhooks submit only. Run input holds and library/workflow pauses block acceptance; status returns 20 applicable pauses plus pauseCount, manage_pause reads more. Submissions can replace values; release never accepts. Detached runs have independent holds.',
    { request: externalInputRequestSchema },
    ({ request }) =>
      request.action === 'status'
        ? client.runs.externalInputStatus(request)
        : client.runs.externalInput(request),
  );
  tool(
    'get_run_briefing',
    'Read bounded stage/waiting/actor,tags,lifecycle/independent progress,work/blockers,failures,deadlines/result refs. Lists20/max100,total/truncated; no payloads/tokens. Queued admission has no work. Follow pause/hold/budget/resource/cwd recovery. Quiescence includes resource-free revoked Agents; reconcile exact stopped attempts via manage_work_resources. Resource blockers name executions/owners; queueing excludes timeouts. Input blockers identify execution/revision. Poll lastCheck caps512 chars; poll_check/poll_timeout deadlines. manage_stalls and manage_run_version read details. Empty work is not completion.',
    briefingQuerySchema.shape,
    (input) => client.runs.briefing(input),
  );
  tool(
    'wait_for_run_change',
    'Read-only wait for run/descendant changes using continuation runId/cursor from briefing/wait/summary. timeoutMs:30000 default,60000 max,0 immediate. Bounded briefing adds changed/timedOut/reset and poll_check/poll_timeout deadlines. Restart/invalid cursor returns reset:true/changed:true; keep new cursor, infer no completion. Missing/deleted run errors; unrelated runs/workflow edits do not wake. No claims/timers advance. HTTP disconnect, stdio cancellation/shutdown release wait; cancelled local HTTP POST may persist until timeout. Client timeout must exceed wait. Detached IDs select independent lifecycles.',
    waitQuerySchema.shape,
    (input, signal) => client.runs.wait(input, { signal }),
  );
  tool(
    'get_run_result',
    'Read selected run or execution input/output/raw result. field defaults output; result requires executionId and uses retained raw result or output. Dot paths support keys/array indices; blank selects all. Returns value, reference, field/path and UTF-8 JSON bytes; includeHash adds canonical sorted-key SHA-256. Null is a value; missing data/path/execution errors. maxBytes defaults 65536, max 262144; oversize requires narrower paths. No other payloads, definitions or credentials; get_run reads full inspection.',
    resultQuerySchema.shape,
    (input) => client.runs.result(input),
  );
  tool(
    'list_workflows',
    'Discover workflows as compact summaries by default: id, name, description, ownerWorkflowId, archived, latestVersion, draftRevision, createdAt, updatedAt, and draftMatchesLatest. Summaries omit draft nodes, prompts, and contracts. Use get_workflow for one full draft, or includeDraft:true for the legacy full list. draftRevision counts draft saves; latestVersion is the highest published number, not the count of retained definitions. draftMatchesLatest is structural equality with the latest published definition, or null when unpublished. Omit ownerWorkflowId for all workflows, use null for the library, or a parent ID for its children.',
    {
      source: z.enum(['library', 'starters']).default('library'),
      includeDraft: z.boolean().default(false),
      ownerWorkflowId: z.string().nullable().optional(),
      includeArchived: z.boolean().default(true),
    },
    async ({ includeDraft, source, ...input }) => {
      if (source === 'starters') return client.workflows.starters();
      const workflows = await client.workflows.list(input);
      return includeDraft
        ? workflows
        : workflows.map(
            ({
              id,
              name,
              description,
              ownerWorkflowId,
              archived,
              latestVersion,
              draftRevision,
              createdAt,
              updatedAt,
              draftMatchesLatest,
            }) => ({
              id,
              name,
              description,
              ownerWorkflowId,
              archived,
              latestVersion,
              draftRevision,
              createdAt,
              updatedAt,
              draftMatchesLatest,
            }),
          );
    },
  );
  tool(
    'export_workflow',
    'Export stable IDs/drafts/version numbers, owners/children/transitive dependencies. Format 8:event triggers/source dependencies; Format 7:webhooks/Secret requirements; Format 6:model-alias requirements; Format 5:schedules; Format 4:variable requirements; Format 3:deleted-version hashes; Format 2:saved prompts; otherwise1. Triggers disabled; prompts retain ID/revision/content. No values/keys/model candidates/trigger state, runs/captures/start receipts, local testbench/evaluation or archive flags. Deleted definitions absent; back up before cleanup to restore. Missing referenced drafts reject. Includes scripts/config.',
    { id: z.string() },
    (input) => client.workflows.export(input),
  );
  tool(
    'import_workflows',
    'Starter: starterId from list_workflows source:starters, stable requestId; copy:true duplicates. Copies publish without running. Otherwise atomic upsert formats1..8. dryRun previews published semantic diffs without mutation; publish atomically publishes imports, cascade includes callers. Triggers disabled/revisioned even with force; reset automatic pause/failures. Events reset logs/pending, retain receipts; others keep history. Schedules reset slot/anchor/lag. Trigger workflow/kind immutable. Format additions: export_workflow. variableBindings: same-kind local ID or unset provisioning. No values/keys. Version gaps allowed; identical definitions unchanged. Skip deleted versions unless restoreDeletedVersions:true restores originals with ownership/dependency checks. Format3 cannot delete local versions. Replace drafts via draftRevisions by workflow ID or force:true. Force cannot overwrite versions/shared prompts, change ownership or authorize restoration. Ownership moves use ownership tools. Prompt bundles require references; divergent content rejects even with force. Conflicts roll back all; runs/archive flags unchanged.',
    {
      starterId: z.string().min(1).max(64).optional(),
      requestId: z
        .string()
        .min(1)
        .max(120)
        .refine((v) => /\S/.test(v), 'Use a nonblank request key')
        .optional(),
      copy: z.boolean().optional(),
      bundle: workflowBundleSchema.optional(),
      force: z.boolean().optional(),
      variableBindings: variableImportBindingsSchema.optional(),
      draftRevisions: z.record(z.number().int().positive()).optional(),
      restoreDeletedVersions: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      publish: z.boolean().optional(),
      cascade: z.boolean().optional(),
    },
    (input) => {
      if (input.starterId) {
        if (
          !input.requestId ||
          input.bundle ||
          input.force !== undefined ||
          input.draftRevisions ||
          input.restoreDeletedVersions !== undefined ||
          input.variableBindings !== undefined ||
          input.dryRun !== undefined ||
          input.publish !== undefined ||
          input.cascade !== undefined
        )
          throw new Error(
            'Starter imports require requestId and cannot use bundle replacement options',
          );
        return client.workflows.importStarter({
          starterId: input.starterId,
          requestId: input.requestId,
          copy: input.copy,
        });
      }
      if (
        !input.bundle ||
        input.requestId !== undefined ||
        input.copy !== undefined
      )
        throw new Error(
          'Provide a portable bundle, or starterId with requestId',
        );
      return client.workflows.import({
        bundle: input.bundle,
        force: input.force,
        draftRevisions: input.draftRevisions,
        restoreDeletedVersions: input.restoreDeletedVersions,
        variableBindings: input.variableBindings,
        dryRun: input.dryRun,
        publish: input.publish,
        cascade: input.cascade,
      });
    },
  );
  tool(
    'create_workflow',
    'Create an editable draft. Incomplete routes can be saved. Use validate_workflow to check publication readiness. Set Script language to javascript explicitly. Omission selects Bash. Set ownerWorkflowId to create a child that only its owner can reference. Children cannot own children. Workflow nodes can use version:null until a published version is selected. Request detail:"summary" for IDs, revisions and status. Full is the default.',
    {
      name: z.string(),
      detail: authoringDetailSchema,
      description: z.string().optional(),
      definition: definitionSchema.optional(),
      layout: draftLayoutSchema.optional(),
      ownerWorkflowId: z.string().nullable().optional(),
    },
    ({ detail, ...input }) =>
      detail === 'summary'
        ? client.workflows.createSummary(input)
        : client.workflows.create(input),
    authoringResponseSchema,
  );
  tool(
    'update_workflow',
    'Update workflow metadata or replace the entire draft definition. Use edit_workflow for small stable-ID edits or validate_workflow for read-only diagnostics. Read get_workflow first and include its current draftRevision when changing the draft or requesting layout. layout without draft arranges the stored draft. The draft parameter uses the same definition format as create_workflow. Incomplete routes can be saved; this does not publish or change existing runs. Ownership is excluded; use preview_workflow_ownership and set_workflow_owner for moves. Request detail:"summary" for IDs/revisions/status without the definition, including archive/restore. full is the default.',
    {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      draft: definitionSchema.optional(),
      layout: draftLayoutSchema.optional(),
      archived: z.boolean().optional(),
      draftRevision: z.number().int().optional(),
      detail: authoringDetailSchema,
    },
    ({ detail, ...input }) =>
      detail === 'summary'
        ? client.workflows.updateSummary(input)
        : client.workflows.update(input),
    authoringResponseSchema,
  );
  tool(
    'edit_workflow',
    'Apply up to 100 ordered stable-ID draft edits atomically. Read get_workflow for draftRevision. A stale revision or invalid edit rejects all edits. Returns applied, draftRevision, changes {nodes/edges: added, updated, removed IDs; settings: changed fields}, and diagnostics {severity, category, code, path, message, optional nodeId, edgeId, operationIndex}. Operation indexes are zero-based. Layout runs after edits and moved nodes appear in changes. No-op requests with unchanged edits and layout preserve revision and timestamp; effective changes increment once. Updates shallowly replace fields; unset removes optional fields. Removing a node recursively removes Batch descendants and incident edges. Surviving node bindings and edges after source-port changes are preserved and must be explicitly repaired. Save errors block edits; publication blockers and conservative contract warnings allow incomplete drafts. Added scripts default to JavaScript, existing omitted language retains Bash. Ownership, metadata, published versions, and existing runs are untouched. Does not publish or start a run. Request diagnostics:"summary" for all errors and new/changed warnings across the graph, plus at most five unchanged warnings and exact counts in diagnosticSummary. Counts include every error and deduplicate only exact warnings. all is the default. Counts and samples do not cap arbitrary diagnostic text or newly introduced diagnostics.',
    {
      id: z.string(),
      draftRevision: z.number().int().positive(),
      diagnostics: z.enum(['all', 'summary']).default('all'),
      edits: workflowEditsSchema,
      layout: draftLayoutSchema.optional(),
    },
    (input) => client.workflows.edit(input),
    editResponseSchema,
  );
  tool(
    'validate_workflow',
    'Read-only preflight of the stored draft or optional candidate definition. Returns current draftRevision, saveable, publishable, and diagnostics {severity, category, stable code, path, message, optional nodeId/edgeId}. Save errors are malformed structure, unknown fields, or child ownership conflicts. Publication blockers include graph, contracts, scopes, bindings, duplicate or missing saved prompt IDs and unavailable versions. Contract warnings check a bounded primitive/object/array subset and known missing binding paths. Ambiguous sources or unsupported schemas report unknown; explicit input contracts do not hide upstream conflicts. Warnings do not prove compatibility or earlier-node availability. Runtime contract checks remain authoritative. Does not save, publish, or start a run. Requests are limited to 2 MiB including the transport envelope; oversized requests fail without saving. Reduce the request size, or omit definition to validate an already saved draft.',
    {
      id: z.string(),
      definition: jsonSchema.optional(),
    },
    (input) => client.workflows.validate(input),
  );
  tool(
    'list_workflow_versions',
    'List retained published definitions in numeric order with their original version numbers. Cleanup can leave gaps. latestVersion remains the publication counter; never infer retained versions from the counter. Use export_workflow to save a backup before cleanup.',
    { id: z.string() },
    (input) => client.workflows.versions(input),
  );
  tool(
    'preview_workflow_ownership',
    'Read-only preview of adopting or reparenting an existing workflow under a library owner, or releasing it with ownerWorkflowId:null. Returns id, name, currentOwnerWorkflowId, proposed ownerWorkflowId, unchanged, canSetOwner and blockers. Blockers name invalid owners, owned children, and all foreign draft/retained published references with caller IDs/names, node IDs/labels, version and latest flags. Only the proposed owner may reference a child, including inside Batch; children cannot own workflows. Historical blockers require explicit version cleanup after informed agreement. No data changes.',
    ownershipPreviewSchema.shape,
    (input) => client.workflows.previewOwnership(input),
  );
  tool(
    'set_workflow_owner',
    'Adopt, reparent or release an existing workflow while preserving its ID, draft/revision, published versions, cleanup identities and all execution history. Use preview_workflow_ownership first. Require expectedOwnerWorkflowId from the current record or preview, with explicit null for library workflows. Rechecks ownership and every draft/retained published reference transactionally; stale ownership or any blocker rejects without changes. A new owner must be an unarchived library workflow different from the target; a target with children cannot become a child. Archived targets retain their archive flag. Release uses ownerWorkflowId:null and permits library reuse. Same-owner calls are no-ops, including an archived existing parent. Returns applied and workflow; effective moves update only ownerWorkflowId and updatedAt. Does not publish, execute, rewrite definitions or delete history. Generic update, raw definitions and forced imports cannot change ownership.',
    ownershipChangeSchema.shape,
    (input) => client.workflows.setOwner(input),
  );
  tool(
    'preview_version_deletion',
    'Preview explicit obsolete versions without mutation: identity hashes, blockers, affected history, consequences and confirmation. Latest, draft/retained pins, active run bindings/transitive future dependencies and queued/active comparison pins block cleanup, including Batch/detached calls. Historical callers need explicit selection; no cascade. Save an export backup and obtain human agreement to impact before delete_workflow_versions. Changed impact requires a fresh preview/agreement.',
    versionSelectionSchema.shape,
    (input) => client.workflows.previewVersionDeletion(input),
  );
  tool(
    'delete_workflow_versions',
    'Atomically delete only previewed definitions after human agreement. Requires confirmation and acknowledgeHistoryLoss:true; stale impact/blockers reject without changes. Records/ancestry remain. Runs bound to deleted versions lose graph inspection/retry until original definitions are restored. Earlier execution graphs can become unavailable after a run moves; its current retained binding remains usable. Retained numbers/definitions stay unchanged. Ordinary import and force cannot restore deleted versions. Workflow/run records and ownership remain; selected callers never expand automatically. Returns deleted identities/affectedRuns.',
    versionDeletionSchema.shape,
    (input) => client.workflows.deleteVersions(input),
  );
  tool(
    'delete_workflow',
    'Permanently delete a workflow, published versions, cleanup identities, and all its runs/descendants, including Batch item runs and detached runs, plus assignments, events, and local test suites/comparisons/simulations and workflow triggers/fire or delivery logs and webhook receipts. Durable event-trigger receipts remain. To remove only selected run history, use manage_run_history. Active simulations, queued/active comparison pins, and unreconciled resource reservations block deletion. Managed trial cleanup must finish before deleting comparison receipts. Any child run with a parent from another workflow blocks deletion: ancestor runs and the entire run tree remain intact. External draft or retained published references, active affected runs, or owned children also block deletion with exact locations. Start receipts retain deleted tombstones. Prefer archived:true with update_workflow to hide unused workflows and preserve history.',
    { id: z.string() },
    (input) => client.workflows.delete(input),
  );
  tool(
    'publish_workflow',
    'Validate draft and publish an immutable version without execution. Only owners reference owned children. promptIds must exist and be distinct; pinPromptsAtPublish captures exact revisions, otherwise runs capture at startup. validate_workflow preflights; warnings do not prove compatibility. Bindings stay in scope and exclude Entry/Exit. Switch ports are unique with one edge; no fallback means unmatched failure. Detached calls require a published pin and intrinsic output, without failure routing. Agents with unclaimedTimeoutMs and poll Waits with timing.timeoutMs need default+timeout routes; other Waits need default only. Poll Fetch validates like Fetch. cascade republishes all transitive dependents, including archived, from latest definitions; cycles/unpublished edits reject atomically. Existing versions are immutable; opted-in runs may move later. detail:summary returns committed metadata of the requested workflow; full is default.',
    {
      id: z.string(),
      cascade: z.boolean().optional(),
      detail: authoringDetailSchema,
    },
    ({ detail, ...input }) =>
      detail === 'summary'
        ? client.workflows.publishSummary(input)
        : client.workflows.publish(input),
    authoringResponseSchema,
  );
  tool(
    'get_workflow',
    'Inspect one workflow, draft and input contract. draftRevision counts saves; latestVersion is the highest published number, with possible gaps. draftMatchesLatest is structural equality, null if unpublished. Use current revision with edit_workflow for small changes or validate_workflow for read-only preflight.',
    { id: z.string() },
    (input) => client.workflows.get(input),
  );
  tool(
    'start_run',
    'Start a retained published version, latest if omitted. requestId recovers the original run read-only; keep creation arguments identical. Tags inherit through children/chains. Capacity/after gates may return queued without assignments; dependencies require success, priority descends/FIFO ties. Summary supplies runId/cursor/next work; ok means accepted, not completed. Continue via briefing/waits/claims. full returns inspection; detached work may outlive parents.',
    {
      detail: mcpMutationDetailSchema,
      limit: continuationLimitSchema,
      ...runStartSchema.shape,
      input: jsonSchema,
    },
    ({ detail, limit, ...input }) =>
      detail === 'summary'
        ? client.runs.startSummary({ ...input, limit }).then(withNextCall)
        : client.runs.start(input),
    startResponseSchema,
  );
  tool(
    'get_run',
    'Inspect run/descendants: bound definition, per-execution versions/events, captured prompts/variable refs, token-free work. manage_run_version reads bounded move history, policy and compatibility blockers. Prefer briefing for continuation, result for selected payloads. Queued:admission_queue metadata. Removed version:definitionAvailable:false/definition:null; restore before retry. Rollover:chain.nextRunId; detached children independent. Holds:20 recent intervals; manage_work_hold reads more. manage_script uses supervisor/progress. Wait deadlines/checks may be historical. Routed failures retain port:failed/handledFailure. Quiescence:detached/continued blockers,uncertainClaims. New events snapshot projections; old may omit them.',
    { id: z.string() },
    (input) => client.runs.get(input),
  );
  tool(
    'list_runs',
    'Find newest run summaries with projections, tags, correlation and ancestry. Filters combine; tags require every exact case-sensitive pair. inputMatch uses dot paths, blank for whole input, structural equality. Limit default 50/max 1000. rootOnly excludes all children, including detached. Lookup reserves nothing; use start_run for retry/active-task policy. Chains inherit externalTask, not requestId.',
    runQuerySchema.shape,
    (input) => client.runs.find(input),
  );
  tool(
    'retry_run',
    'Retry a failed step after inspecting repeatable side effects. Captures/budgets persist; bindings resolve again and successful Batch items remain. Uncertain background Scripts need manage_script reconciliation, stopped:true; Fetch transport failures require confirmed remote stop before resource reuse. Managed Git trials cannot retry. Ordinary children retry through terminal parents; a failed detached child retries directly; handled failures need parent recovery. Completed/cancelled runs cannot retry; completed dispatch never replays. Missing definitions must be restored. Comparison retries require capacity and retain observations. Agent retry resets failure/expiry allowances, not usage or claim gates.',
    { id: z.string() },
    (input) => client.runs.retry(input),
  );
  tool(
    'manage_run_version',
    'Manage one run version: read paged history/policy/revision/blocker, policy with expectedRevision, preview a newer published version, apply with exact confirmation and reason. Reads/previews never mutate. History defaults 20/max 100; no definitions or payloads. Default pinned; latest-compatible checks before new executions. Missing nodes, invalid target input/captures, or active execution block moves. Available/claimed assignments and active Wait/child/Batch visits finish unchanged. Changed preview state rejects apply. recapturePrompts defaults false; true honors target publish pins, otherwise current revisions. Budgets/continuity/child lifetimes persist. get_run reads execution versions.',
    {
      request: z.discriminatedUnion('action', [
        runVersionReadSchema.extend({ action: z.literal('read') }),
        setRunVersionPolicySchema.extend({ action: z.literal('policy') }),
        runVersionPreviewSchema.extend({ action: z.literal('preview') }),
        runVersionApplySchema.extend({ action: z.literal('apply') }),
      ]),
    },
    ({ request }) => {
      const { action, ...input } = request;
      switch (action) {
        case 'read':
          return client.runs.versionPolicy(runVersionReadSchema.parse(input));
        case 'policy':
          return client.runs.setVersionPolicy(
            setRunVersionPolicySchema.parse(input),
          );
        case 'preview':
          return client.runs.previewVersionMove(
            runVersionPreviewSchema.parse(input),
          );
        case 'apply':
          return client.runs.applyVersionMove(
            runVersionApplySchema.parse(input),
          );
      }
    },
  );
  tool(
    'manage_run_history',
    'Manage whole-tree history, preserving workflows/versions. Manual preview: workflowId,before (whole-tree update),rootRunIds,offset0,limit20/max100. Returns counts/bytes/blockers/confirmations. After human agreement to selected roots and irreversible loss, delete roots:[{runId,confirmation}],acknowledgeHistoryLoss:true; transaction rejects stale/protected selections. Trees include detached runs/chains; active/jobs/uncertainty/comparison/trigger evidence blocks cleanup. Settings/configure optionally scope workflowId; omission is library. Configure requires expectedRevision and whole policy: age/count thresholds, null disables, inherit removes workflow override. Enable only with authorization for permanent scheduled deletion. Library count pools inheritors; overrides count independently. Counts include failed/cancelled trees; either threshold expires by whole-tree last update. Hourly batches100; backlog/recent trees retry1min. Status returns bounded sweep/error/storage metadata without payloads. Cleanup retains start/trigger receipts; SQLite pages become reusable, no compaction. Native harness/trial files remain.',
    historyRequestSchema.shape,
    ({ request }) => {
      if (request.action === 'status') return client.runs.retentionStatus();
      if (request.action === 'settings') {
        const { action: _action, ...input } = request;
        return client.runs.retentionSettings(input);
      }
      if (request.action === 'configure') {
        const { action: _action, ...input } = request;
        return client.runs.configureRetention(input);
      }
      if (request.action === 'preview') {
        const { action: _action, ...input } = request;
        return client.runs.previewHistoryDeletion(input);
      }
      const { action: _action, ...input } = request;
      return client.runs.deleteHistory(input);
    },
  );
  tool(
    'list_work',
    'Discover available Agent assignments. runId includes all descendants, including detached work after parent completion; omit for all. Summary returns identity/ancestry/context/counts/lease policy without payloads; full or claim_work returns captured assignment. Version moves preserve existing work. availableUntil is the unclaimed deadline; executor/managedExecution show dispatch. Empty is not completion: inspect get_run_briefing blockers/lifecycles and wait. Timers advance independently.',
    {
      runId: z.string().optional(),
      fields: z
        .enum(['full', 'summary'])
        .default('summary')
        .describe(
          'Summary ancestry: workflowId,rootRunId,rootWorkflowId,parentRunId?,parentMode?. Roots use own IDs. full includes captured bodies.',
        ),
    },
    ({ fields, ...input }) =>
      fields === 'summary'
        ? client.work.summaries(input)
        : client.work.list(input),
    workListResponseSchema,
  );
  tool(
    'get_context_group',
    'Read a run-local continuity binding and paginated claim/handoff history (default 20, max 100). Unbound groups have revision 0 and session null. Group names never inherit across child, Batch-item, detached, or root runs. Checkpoint references are opaque; Interlock does not read them.',
    contextGroupQuerySchema.shape,
    (input) => client.runs.contextGroup(input),
  );
  tool(
    'handoff_context_group',
    'Replace a bound session using its current revision, declared actor, reason, and checkpoint reference. Active group claims must finish, fail, or expire first; inspect side effects before retrying. Completed/cancelled runs reject. Latest identical retry is a no-op; stale or conflicting revisions reject. Does not claim work or reset budgets. The harness must restore context from the checkpoint.',
    contextHandoffSchema.shape,
    (input) => client.runs.handoffContext(input),
  );
  tool(
    'inspect_assignment_size',
    'Read-only UTF-8 JSON size breakdown without payload values. Choose workId for a captured assignment, or workflowId+nodeId for a draft preview; version selects a published pin. Preview sample accepts input, runInput/rootInput/itemInput and latest same-scope node outputs. A supplied outputs map uses sourceDefault for absent node IDs when configured. Omitted sources otherwise stay unknown. warningBytes defaults to 100000 and is advisory. Counts prompt, context, input, output schema, execution instructions saved prompt metadata and optional trial environment context, excluding envelope/identity fields. No token or billing estimate; no claim or truncation.',
    assignmentSizeQuerySchema.shape,
    (input) => client.work.size(input),
  );
  tool(
    'claim_work',
    'Claim available work with actual capabilities; custom launchers need claimTicket. continuityGroup requires session:{executorId,sessionId}, matching its binding or explicit handoff. Admission gates spend no attempts; held work needs resume and side-effect inspection. Resources reserve atomically; stop all use before submit/fail. Revocation leaves uncertainty. leaseSeconds10..3600 overrides node/default300; renew before leaseUntil. Expired tokens cannot renew/submit; inspect side effects before reclaim. Expiry spends maxLeaseExpiries or maxAttempts. Managed trials need interlock-local-trials. Claim stops availableUntil and starts maxExecutionMs; renewals do not extend it, pauses/holds exclude time.',
    {
      workId: z.string(),
      workerId: z.string(),
      session: sessionIdentitySchema.optional(),
      modelSelection: modelSelectionSchema.optional(),
      freshContext: z.boolean().default(false),
      tools: z.array(z.string()).default([]),
      skills: z.array(z.string()).default([]),
      claimTicket: z.string().optional(),
      leaseSeconds: z.number().int().min(10).max(3600).optional(),
    },
    (input) => client.work.claim(input),
    claimResponseSchema,
  );
  tool(
    'manage_work_resources',
    'Read-only inspect by Agent workId or deterministic runId+executionId, without tokens/hashes. Includes resource-free uncertainClaims/uncertainOperations after revocation. Release expectedAttempt with actor,confirmStopped:true only after exact old worker/subprocess/remote operation stops. Active owners reject; replacement ownership is untouched. Cancellation/expiry/hold or Fetch timeout/disconnect never proves stop. No fencing or termination. Returns applied/released counts.',
    { request: workResourceRequestSchema },
    ({ request }) => client.work.resources(request),
  );
  tool(
    'manage_pause',
    'Persistent independent pause holds. pause requires target:{scope:library} or {scope:workflow,workflowId}, actor label and reason; retain returned ID. resume releases one exact ID, idempotently when already released. Release only your record: all applicable holds must clear. list omits workflowId for library holds or supplies it for library plus that workflow; optional scope filter, workflow requires workflowId. offset/limit default 20/max 100, exact total/nextOffset. Pauses gate claims/launches, boundaries and input acceptance. Submissions/revisions, in-flight completion, reads/cancel/cleanup continue. Manual starts may wait paused. Actor is a label. list never mutates.',
    { request: pauseRequestSchema },
    ({ request }) =>
      request.action === 'list'
        ? client.pauses.list({
            workflowId: request.workflowId,
            scope: request.scope,
            offset: request.offset,
            limit: request.limit,
          })
        : request.action === 'pause'
          ? client.pauses.pause({
              target: request.target,
              actor: request.actor,
              reason: request.reason,
            })
          : client.pauses.resume({ id: request.id }),
  );
  tool(
    'manage_work_hold',
    'Hold/resume one Agent assignment for an external blocker. hold needs current expectedAttempt, expectedRevision (holdRevision or 0), actor/category, reason/checkpointRef; token optionally attests a claim, local coordinators may omit. Holds revoke claims, freeze unclaimed deadlines and spend no failure/expiry allowance. Claimed resources become uncertain until stop confirmation. Resume needs attempt/revision/actor, preserves budget/context gates and returns work for a fresh claim. needs_model requires manage_executors retry_model. Changes return applied/status/attempt/holdRevision; identical latest retries are no-ops, intervening changes conflict. Available holds preserve unclaimed-stall time; held claims resume fresh availability. Read-only history defaults20/max 100 with offset. Briefing shows blockers, get_run recent history. No replay of external work.',
    { request: workHoldRequestSchema },
    ({ request }) => client.work.hold(request),
  );
  tool(
    'preflight_result',
    'Read-only check of the captured output contract/resultRules, pinned result routing/output mappings and current claim. No acceptance, lease renewal, timer processing, or graph advance. Returns bounded field/rule diagnostics without candidate values. A passing check does not reserve acceptance; submit_result rechecks live state. Identical completed results report already_accepted.',
    { workId: z.string(), token: z.string(), output: jsonSchema },
    (input) => client.work.preflight(input),
    resultCheckSchema,
  );
  tool(
    'submit_result',
    'Submit JSON satisfying the captured output contract/resultRules; preflight_result checks read-only. Rejection resultCheck supplies claimUsable, nextAction and diagnostics. Correct output under the active claim. Stop subprocesses/resource use first. Acceptance releases reservations; rejection retains them. Identical retries recover acceptance; changed output or invalid ownership rejects. Summary supplies workId/workRunId, continuation runId/runStatus, projections, cursor and next work/action. Use continuation runId/cursor with change waits. Inspect briefing for blocked or queued runs; empty work is not completion. detail:full inspects the immediate assignment run. get_run_result reads transformed output; usage reporting is separate.',
    {
      detail: mcpMutationDetailSchema,
      limit: continuationLimitSchema,
      workId: z.string(),
      token: z.string(),
      output: jsonSchema,
    },
    ({ detail, limit, ...input }) =>
      detail === 'summary'
        ? client.work.submitSummary({ ...input, limit }).then(withNextCall)
        : client.work.submit(input),
    submitResponseSchema,
  );
  tool(
    'renew_claim',
    'Renew an active claim before its lease expires. Deadline becomes now plus leaseSeconds (10–3600, default original claimLeaseSeconds or 300). Renewal resets claimed-idle time and retains resource ownership; it does not extend optional maxExecutionMs. Active execution deadline expiry rejects renewal. Held and expired claims cannot be renewed. Expired tokens require inspecting diagnostics and claiming anew. Report usage does not renew claims; renew independently.',
    {
      workId: z.string(),
      token: z.string(),
      leaseSeconds: z.number().int().min(10).max(3600).optional(),
    },
    (input) => client.work.renew(input),
  );
  tool(
    'fail_work',
    'Report a failed assignment attempt. Use manage_work_hold for recoverable blockers. Consumes failureCount against maxAttempts budget. Executors must stop using resources and stop subprocesses before reporting failure. If retry attempts remain, work becomes available with a fresh timeout interval; otherwise exhausted attempts fail the run.',
    { workId: z.string(), token: z.string(), error: z.string() },
    (input) => client.work.fail(input),
  );
  tool(
    'manage_script',
    'Inspect Script state/progress, stop and cancel run, or reconcile uncertain outcome by runId/executionId. stop requests supervisor process-group termination. reconcile requires stopped:true and reason confirming processes stopped/effects inspected; releases matching reservations.',
    { request: scriptOperationSchema },
    ({ request }) => client.runs.script(request),
  );
  tool(
    'preview_run_cancellation',
    'Read-only active descendant preview through terminal parents and forward chains. includeDetached defaults false; true crosses detached boundaries. Never includes ancestors/siblings. Returns compact items,total,truncated,nextOffset; limit 20/max100, offset0. Does not advance work. cancel_run_tree recomputes membership.',
    previewRunCancellationSchema.shape,
    (input) => client.runs.previewCancellation(input),
  );
  tool(
    'cancel_run_tree',
    'Atomically cancel active descendants through terminal parents and forward chains; includeDetached:false default, true crosses detached boundaries. Required reason persists per cancelled run/event. Terminal outcomes stay. Selected chains cannot roll/retry. External stops follow commit; uncertain ownership requires exact-attempt stop reconciliation. Preview with preview_run_cancellation. Returns cancelled:{items,total,truncated}; limit20/max100 bounds response only.',
    cancelRunTreeSchema.shape,
    (input) => client.runs.cancelTree(input),
  );
  tool(
    'cancel_run',
    'Cancel queued/admitted run and ordinary active descendants; scope:chain stops latest successor from any member and prevents rollover/retry. Each stops at detached boundaries; use cancel_run_tree includeDetached:true to cross them. Timers never resume. Background stop uses manage_script. Revoked claims/resources require exact stopped reconciliation via manage_work_resources; terminal is not quiescent. Trial cleanup additionally requires update_workflow_comparison cleanup_trial confirmation.',
    cancelRunSchema.shape,
    (input) => client.runs.cancel(input),
  );
  return server;
}
