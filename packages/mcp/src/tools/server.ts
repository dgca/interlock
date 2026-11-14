import { stallRequestSchema, historyRequestSchema } from '@interlock/core';
import { scheduleReadSchema, scheduleManageInputSchema } from '@interlock/core';
import { scriptOperationSchema } from '@interlock/core';
import { workResourceRequestSchema } from '@interlock/core';
import {
  variableReadSchema,
  variableMutationSchema,
  variableImportBindingsSchema,
  boardImportSetupSchema,
  modelAliasReadSchema,
  modelAliasMutationSchema,
} from '@interlock/core';
import { executorOperationSchema } from '@interlock/core';
import { z } from 'zod';
import {
  simulationToolSchema,
  externalInputRequestSchema,
  workflowRequestSchema,
  workHoldRequestSchema,
  contextGroupQuerySchema,
  contextHandoffSchema,
  sessionIdentitySchema,
  modelSelectionSchema,
  resultCheckSchema,
  assignmentSizeQuerySchema,
  authoringJsonSchema,
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
  promptCreateSchema,
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
import { createProfileServer } from './register.js';
import { parseMcpProfile } from './profiles.js';
import { VERSION } from '@interlock/core/version';
import type { createMcpClient } from '../client.js';
import { registerBoardTools } from './boards.js';
import { registerPauseTools } from './pauses.js';
import { registerMemoryTools } from './memory.js';
import { workflowBundleSchema } from '@interlock/core/transfer';
import {
  publishSchemaResources,
  sharedDefinitionSchema,
  sharedBundle,
} from './schemas.js';
// SDK enum errors may quote malformed input; validate sensitive bodies first.
const safeVariableMutationSchema = z.preprocess(
  (input) => (variableMutationSchema.safeParse(input).success ? input : {}),
  variableMutationSchema,
);
/** Profile names come from the HTTP path, header or stdio environment. */
export function createMcpServer(
  client: ReturnType<typeof createMcpClient>,
  profile?: string,
) {
  const { server, tool } = createProfileServer(
    parseMcpProfile(profile),
    VERSION,
  );
  publishSchemaResources(server, workflowBundleSchema);
  tool(
    'doctor',
    'Read-only readiness check. Reports storage, disk and harness status; disabled variables that upgrading to 0.3.0 would delete, with the workflows that reference them; enabled triggers with failures or automatic pauses; active pauses and uncertain resource reservations; and the variables, known model aliases and prompt pins that the latest published versions depend on. Set live:true to also probe model connectivity.',
    doctorOptionsSchema,
    (options) => client.system.doctor(options),
  );
  tool(
    'workflow_report',
    'Report performance and cost for the newest matching runs of a workflow or the whole library: durations, waits, reliability, measured spend and its coverage, and exits. usage.pricing lists derived prices and unpriced models. Optional tags match runs that have every exact, case-sensitive pair, using the tag index before sampling. limit defaults to 500 and caps at 5000. since and until are inclusive createdAt instants normalized to UTC; there is no default date range. All metrics cover only the selected sample. Scalar cost groups that mix currencies return costMicros:null and currency:"mixed"; totals and alias groups keep currencies separate. usage.byAlias groups by the retained assignment alias, revision and candidate together with the reported model and provider; a null alias is unknown and includes run overhead. Duration distributions keep wall-time values and add pausedMs and activeMs distributions; active time excludes the union of applicable library and workflow pauses.',
    reportFilterSchema,
    (filter) => client.report.summary(filter),
  );
  tool(
    'workflow_simulation',
    'Simulate a published workflow with ordered case fixtures; no model calls or network effects. action:run requires suiteId, suiteRevision, caseId, version, unique requestId. Poll action:get with id, offset, limit (default 20/max 100). Supports every node except continue-as-new Exits, which reject before execution. Human input fixture output is the answer; a detached Workflow fixture supplies the started run reference. Batch items/Parallel branches run one at a time; their steps take the next unused fixture for their node. Agent unclaimed timeouts and onFailure:route branches are simulated. Max 4 active simulations. action:list filters workflowId. action:capture returns definition, case, prompts, and output. action:cancel stops simulation.',
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
    'Read-only plan for two published versions of a suite workflow on identical saved inputs. Defaults: repetitions 1, concurrency 2. Returns cases, hashes, dependency pins, configuration identities including model aliases, blocker details, and confirmation. Real runs use configured executors and may perform Script/Fetch actions. Optional sampleBudget sets per-sample Agent budget. Optional trialSetup:{kind:"local_git",repository,commit} runs each sample in an isolated checkout. Use start_workflow_comparison with confirmation and unique requestId.',
    comparisonPreviewSchema,
    (input) => client.testbench.preview(input),
  );
  tool(
    'start_workflow_comparison',
    'Start a previewed paired live comparison. Rechecks confirmation, suite revision and model aliases transactionally; aliases stay captured across samples and descendants. Max 4 active comparisons and 10 active execution trees. Concurrency counts root plus active descendants. Captured sampleBudget policies install on each root. Returns compact progress with configurationIds. Inspect results with read_workflow_comparisons action:report. Execute Agent work with list_work/claim_work/submit_result.',
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
    'Read schedule and event triggers, which live outside workflow drafts (Automations in the UI). action list returns compact status and latest activity, filtered by optional workflowId, kind, search and status; scoped counts are computed before the status filter, and all filters apply before paging. status is all, enabled (and not automatically paused), disabled, or attention (enabled but automatically paused or lagging). inspect returns the configuration, holds, and paged fires and deliveries. preview returns the next three schedule slots. attention lists automatic-pause and lag alerts. Pages default to 20 and cap at 100; search is at most 200 characters. Started and queued describe run admission. Logs keep 200 settled rows plus pending work; event receipts survive trimming. Event logs show source and event IDs and pending or suppressed outcomes. Inspect before making revision-protected edits.',
    z.object({ request: scheduleReadSchema }).strict(),
    ({ request }) => client.triggers.read(request),
  );
  tool(
    'manage_workflow_triggers',
    'Create, update, enable, disable or delete a schedule or event trigger. Create needs workflowId and saves the trigger disabled by default; create with enabled:true validates enablement and saves atomically, creating nothing on failure. Every other write needs the inspected id and expectedRevision. Update replaces the configuration but never the kind; config.tags labels the runs it starts. Enabling needs an unarchived target with a retained published version, and resets automatic pauses and failures but not named holds. Schedules use an interval of at least 30 seconds, or a five-field cron expression with an IANA time zone. Re-enabling a run_once schedule may fire immediately. Event triggers start handler workflows with compact event input. Exit filters on events need completed workflow scope; quiescence waits for every run to be terminal, including detached and uncertain work. Causal repeats and depth overflow are suppressed; pauses defer dispatch. Disable and delete keep existing runs; delete clears logs, while event receipts survive. Imported triggers arrive disabled; inspect again after a conflict.',
    z.object({ request: scheduleManageInputSchema }).strict(),
    ({ request }) => client.triggers.manage(request),
  );
  tool(
    'read_variables',
    'Read instance-wide workflow variables. request.action:list returns metadata only, with search and offset/limit (25 default, 100 max), exact total and truncation. inspect returns metadata, availability, the local key-file location for recovery, paged dependent workflows and portable bindings (20 default, 50 max), plus active-run/comparison counts; retained-version samples cap at 20. config_value returns the ordinary Config value and its valueRevision. Secret read-back always rejects. Inspect before revision-protected edits or rebinding. Disabled, unset and locked values remain discoverable. No multi-user isolation is provided.',
    z.object({ request: variableReadSchema }).strict(),
    (input) => client.variables.read(input.request),
  );
  tool(
    'manage_variables',
    'Explicit write-only local variable management: create (Config/Secret; optional value), update (metadata, enabled or replacement value), delete, or bind a portable ID directly to a same-kind local variable. Updates/deletion require expectedRevision; binding starts at revision 0. Unique case-insensitive names and 16 KiB string values; Secret cannot be empty. No Secret read-back. Prefer the local UI or CLI stdin for credentials: supplying a value through MCP discloses it to this agent and transport. Rotation affects new captures; old run revisions remain for retry/restart. Disable blocks later consumption, including existing runs, but cannot recall already delivered values or revoke provider credentials. Delete blocks retained workflow, active-run, and comparison dependencies; inspect first. Rebinding affects future captures and requires dependency review. Mutations return safe metadata only.',
    z.object({ request: safeVariableMutationSchema }).strict(),
    (input) => client.variables.manage(input.request),
  );
  tool(
    'manage_model_aliases',
    'Manage Agent presets (model aliases) with action list, inspect, create, update or delete. Candidates are tried in order. Permissions use the stricter of the preset and workflow modes; null on update restores inheritance. An Agent with executorMode:"preset" treats model as the alias ID; "harness" treats executor as a profile ID and model literally. Workflow agentModelMode:"preset" or "literal" says how to read agentModel. Omit the modes for legacy routing. Updates and deletes require expectedRevision. Pass exactId:true with an inspected preset ID so inspect, update or delete cannot resolve a replacement preset by name. Bundles carry named requirements, and runs pin preset revisions.',
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
    'Discover saved prompts with stable IDs, names, descriptions and current revisions. Use get_prompt for Markdown instructions and dependent workflows. Edits affect future runs of unpinned versions without republishing; publish-pinned versions retain their selected revisions. Existing comparisons retain their captured revisions, including queued samples.',
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
    'Read current saved prompt content and usage {workflowId,name,draft,versions}. Optional revision reads retained historical content, including deleted prompts, and adds currentRevision or null. Optional history:{offset,limit} lists retained revision/name metadata, default 10/max 25, newest first, with total/nextOffset; bodies are omitted. History may have gaps; unavailable revisions error. Historical reads do not restore a prompt or change current edit revisions. Runs capture published pins when configured, otherwise current content; comparisons may select exact revisions.',
    promptReadSchema.shape,
    (input) => client.prompts.get(input),
  );
  tool(
    'create_prompt',
    'Create reusable Markdown instructions with a stable ID and revision 1. Name is trimmed, nonblank and at most 120 characters. Description defaults to empty. Content must contain non-whitespace text. Saving this prompt does not attach it to any workflow or start a run. Reuse the same requestId and content after a lost response to recover the current saved prompt. Changed content or a missing original rejects without creating another prompt. Omit the key for an independent create.',
    promptCreateSchema.shape,
    (input) => client.prompts.create(input),
  );
  tool(
    'update_prompt',
    'Edit a saved prompt using the revision from get_prompt. Stale saves fail without overwriting content. Effective edits allocate above all retained revisions, including imported history; unchanged saves keep revision. Edits affect future unpinned runs without republishing. Publish-pinned versions, active runs, retries and existing comparison captures retain their instructions.',
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
    'Read or configure opt-in library stall defaults, or inspect the current stalled attention for one run. request.action settings reads the revision and policy; configure replaces the policy using expectedRevision. The four threshold fields inherit from node, then workflow, then library: null disables a threshold and omission inherits. Thresholds are whole milliseconds from 1 to 2592000000. inspect pages current stall records (default 20, max 100) without payloads or tokens. Pauses and declared work, needs_human or input-acceptance holds freeze the clocks; humanWaitStallMs observes unheld external-input waits without changing the actor. idleRecovery is off by default, with maxRecoveries from 0 to 10: custom launchers that define message, stop and status commands can be nudged, then stopped and relaunched after another idle interval and a confirmed ended status, spending ordinary attempts. Uncertain stops require reconciliation. Stalls only observe; to react to stalled transitions, use manage_workflow_triggers with kind:event.',
    { request: stallRequestSchema },
    ({ request }) => client.stalls.manage(request),
  );
  tool(
    'manage_executors',
    'Manage local automatic Agent execution: Claude Code, Codex, Pi, or custom harnesses in direct or launcher mode. Subprocess commands expand tokens as shell environment variables; double-quote values passed as arguments. settings reads shared concurrency and allowedRoots; save_settings needs expectedRevision. Profile concurrency is a number, or null or omitted for no profile limit. Shared and profile limits count pending launcher tickets, and saturated profiles are skipped. list detects harnesses and flags missing integration commands or URLs; models needs profileId. save needs expectedRevision, 0 for a new profile. Profiles hold the local executable, working directory, allowedRoots and model defaults, and start disabled. A workflow executor selects a profile; an Agent with executor:null opts out. inspect returns compact attempts, history, logs and human requests. transcript takes executionId and a before or after sequence; limit defaults to 50 and caps at 100, and a response is at most 256 KiB. Capture keeps at most 32 KiB per entry, 2000 entries or 10 MiB per execution and 256 MiB per library, expires 14 days after an attempt ends, and reports gaps explicitly. message takes an active executionId, a unique requestId, a message of 1 to 4000 characters and an optional operator; IDs or labels containing known protected values reject before dispatch. Repeating the same ID and content recovers the receipt without resending; conflicting reuse rejects. receipt reads a delivery by executionId and requestId as pending, accepted, failed or unknown; unknown deliveries are never resent automatically. Accepted means the harness accepted the input. Unsupported channels reject. Use workflow_requests to find individual requests. respond answers one request by exact managed execution ID and request ID. retry_model selects a replacement model for a needs_model executionId. stop interrupts an execution. reconcile requires confirmStopped:true, for interrupted attempts or for an ended needs_human attempt with no pending requests; jobs and stops must settle first, and active human requests reject. Deadline retries stay held until reconciliation, and spent tickets cannot claim again. Terminal attempts may still need resource cleanup.',
    { request: executorOperationSchema },
    ({ request }) =>
      client.executors.manage(
        request.action === 'message' ? { ...request, source: 'mcp' } : request,
      ),
  );
  tool(
    'delete_prompt',
    'Permanently delete an unused saved prompt. Any draft or published workflow version reference blocks deletion and identifies dependent workflows. Captured run instructions and retained revisions remain readable. Use get_prompt to inspect usage before deleting.',
    { id: z.string().describe('Saved prompt ID.') },
    (input) => client.prompts.delete(input),
  );
  tool(
    'get_run_budget',
    "Read a run's local budget revision and policy and the budgets that govern it, with scoped totals, warnings and blocking reasons. Every scope includes the run chain: run counts chain members only, while lifecycle and tree add their descendants. A policy on any member also counts earlier chain history. Tokens without reported cost count at the run's captured prices. Usage can overshoot because of late reports and in-flight work; it is not a billing cap. Missing or non-final figures follow the explicit unknownUsage policy. claims counts all reservations, including retries.",
    { runId: z.string().min(1) },
    ({ runId }) => client.runs.budget({ runId }),
  );
  tool(
    'set_run_budget',
    'Respect the budget authorized by the user. Replace a run budget using its current expectedRevision, initially 0. Re-evaluates all retained usage; never resets counters. Raising limits, changing unknownUsage, or budget:null can resume blocked claims. Inherited budgets still apply. Managed sessions stop at a token or cost limit and resume after a raise; other claimed work may renew, report and finish. Unclaimed timers pause while blocked. Cancellation remains cancel_run with its existing detached boundaries.',
    setBudgetSchema.shape,
    (input) => client.runs.setBudget(input),
  );
  tool(
    'report_usage',
    'Report measured cumulative usage for one attempt (workId and attempt) or for a run observer stream (runId). The executor source is the default and requires the claim token. An attempt observer omits the token and requires a retained attempt that has ended. A run observer requires source:observer and no token, optionally names a session or streamId, and is accepted while the run is active or within 1 hour after it ends. Each stream sequences and finalizes independently. Observer reports take precedence for an attempt; run streams are counted once alongside attempts in totals and budgets. Increase snapshot.sequence on every report: an identical latest retry does nothing, and stale or conflicting snapshots reject. Never remove models, decrease known counts or costs, or change the currency or cost source. final freezes a stream; omitted figures stay unknown. Cache and reasoning counts are subsets of the totals. Cost is integer amountMicros with its source; omit it unless measured, and Interlock derives it from its price table. At most 20 provider and model pairs. Reports never renew or revive claims, though accepted updates refresh budget gates. Returns whether the report applied, its source and sequence, and the attempt or run stream identity.',
    reportUsageSchema.innerType().shape,
    (input) => client.work.reportUsage(input),
  );
  tool(
    'get_run_usage',
    'Read measured usage for a run; observer reports take precedence for each attempt. includeChain adds chain members and includeDescendants adds ordinary and detached descendants once; both default to false, and includedDetachedRuns lists the detached runs counted. Totals include every scoped attempt and run stream regardless of pagination. Missing metrics remain unknown, incomplete or non-final coverage is marked partial, and an unsafe overflow returns null. Costs stay separate by currency, in millionths, and are not billing limits. Tokens without reported cost are priced from the table the run captured: those models carry derivedCost, and totals.pricing lists assumed prices and unpriced models. groupBy is run, node, worker or attempt and defaults to node, scoped by run; run streams are grouped separately. Attempt groups include wallMs, pausedMs and activeMs (null for unknown legacy times), the selected source, snapshot and reportedAt, requestedTier and modelSelection, and the outcome and timestamps. includeReports adds the executor and observer reports for each attempt; attribution stays with the executor. Groups default to 20 and cap at 100, with offset and nextOffset. Legacy figures stay unknown; credentials and inferred usage are never returned.',
    usageQuerySchema.shape,
    (input) => client.runs.usage(input),
  );
  registerBoardTools(tool, client);
  registerMemoryTools(tool, client);
  tool(
    'workflow_requests',
    'Find individual Human input, managed-agent, recovery, budget, and stall requests. list filters by boardId or runId and returns oldest first, exact total and nextOffset (25 default, 100 max). Discover board IDs with read_workflow_boards list. get takes the exact request target and loads captured context, state and answer. For Human input, answer uses a stable submissionId and current expectedRevision, initially 0. Repeat identical arguments after uncertain delivery. A saved answer under a pause or hold stays open. Release an acceptance hold through external_input using holding.runId/revision, then accept the saved revision. Use get.actions to select the operation. For managed requests use manage_executors with managedExecutionId and requestId when needed. Script and permission policy approval items need a person, not manage_script. For resource or Script recovery use manage_work_resources or manage_script with the exact target. Inspect stalls in the run. For budget items use set_run_budget.',
    { request: workflowRequestSchema },
    ({ request }) => {
      if (request.action === 'list') {
        const { action: _action, ...query } = request;
        return client.requests.list(query);
      }
      if (request.action === 'get') return client.requests.get(request.target);
      return client.requests.answer({ request, source: 'mcp' });
    },
  );
  tool(
    'external_input',
    'Inspect, submit or accept integration-owned External input. Use workflow_requests for Human input. Hold/release applies to both across attached descendants. Status without executionId reads holds. includeValue reads pending JSON. Submit with stable requestId and optional expectedRevision (initially 0). Identical retries recover receipts. Accept the current revision. Pauses and holds block acceptance. Release never accepts. Detached runs have independent holds.',
    { request: externalInputRequestSchema },
    ({ request }) =>
      request.action === 'status'
        ? client.runs.externalInputStatus(request)
        : client.runs.externalInput(request),
  );
  tool(
    'get_run_briefing',
    'Read a bounded progress summary for a run: available work, blockers, failures, deadlines (including poll_check and poll_timeout) and result references. Lists default to 20 and cap at 100, and report total and truncated. parallels counts named branches. Descendants include parallelBranch and parentExecutionId. humanRequest:true means the blocker is answered through workflow_requests. Use manage_stalls or manage_run_version for details.',
    briefingQuerySchema.shape,
    (input) => client.runs.briefing(input),
  );
  tool(
    'wait_for_run_change',
    'Wait, read-only, for a change to a run, scoped by the runId and cursor from a briefing, an earlier wait or a mutation summary. timeoutMs defaults to 30000 and caps at 60000; 0 returns immediately. Returns a briefing with changed, timedOut and reset, plus poll_check and poll_timeout deadlines. On reset, keep the new cursor and do not infer completion. A detached run ID selects that independent lifecycle. Set the client request timeout longer than the wait.',
    waitQuerySchema.shape,
    (input, signal) => client.runs.wait(input, { signal }),
  );
  tool(
    'get_run_result',
    'Read one selected input, output or raw result from a run or execution. field defaults to output; result requires executionId and returns the retained raw result, or the output when none was retained. Dot paths select object keys and array indices; a blank path selects the whole value. Returns the value, its reference, the field and path, and its UTF-8 JSON size in bytes; includeHash adds a canonical sorted-key SHA-256. Null is a value, while missing data, paths or executions return errors. maxBytes defaults to 65536 and caps at 262144; select a narrower path when a value is larger. No other payloads, definitions or credentials are returned; get_run reads full inspection.',
    resultQuerySchema.shape,
    (input) => client.runs.result(input),
  );
  tool(
    'list_workflows',
    'List compact workflow summaries. Use source:starters for bundled choices, plus starterId for one with its board setup, or includeDraft:true for full records; get_workflow reads one draft. ownerWorkflowId:null lists library workflows, a parent ID lists its children, and omission lists all. draftRevision ignores layout-only edits; draftMatchesLatest is null before publication. latestVersion is a publication counter; retained versions can have gaps.',
    {
      source: z.enum(['library', 'starters']).default('library'),
      starterId: z.string().min(1).max(64).optional(),
      includeDraft: z.boolean().default(false),
      ownerWorkflowId: z.string().nullable().optional(),
      includeArchived: z.boolean().default(true),
    },
    async ({ includeDraft, source, starterId, ...input }) => {
      if (source === 'starters')
        return client.workflows.starters({ starterId });
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
    'Export workflows with their IDs, drafts, versions and dependencies, including saved draft layout, exact published definitions, prompts and required pins. Format 4 added variable requirements and Format 6 added model alias requirements. Later formats add disabled event triggers, exact prompt snapshots and authored alias IDs, and Format 11 adds board suggestions. Exports never include local board assignments, credentials, variable values, model candidates, trigger state, runs, captures, receipts, testbench data or archive flags. Deleted definitions are absent. Missing dependencies reject the export.',
    { id: z.string() },
    (input) => client.workflows.export(input),
  );
  tool(
    'import_workflows',
    'Import a bundled starter or a workflow bundle. For a starter, pass starterId from list_workflows source:starters and a stable requestId; copy:true adds another published copy. A bundle (export formats 1 through 11) imports atomically. dryRun previews semantic differences and boardSetup, with suggestions and destination boards. Use those IDs and the current membership to create a suggested board, or pass a destination revision and stageColumns to use an existing board; omit boardSetup to keep membership and mappings. Starter board setup requires a new copy and the same requestId in both arguments. Retries reuse the same keys and arguments. variableBindings binds portable IDs to local variables of the same kind, or provisions unset variables. Included triggers import disabled with new revisions, and their automatic pauses and failures are cleared; their workflow and kind stay fixed. Event triggers reset logs and pending work but keep receipts; schedules reset slot, anchor and lag but keep history. publish and cascade publish atomically. draftRevisions or force replace existing drafts; force cannot replace versions or shared prompts, move ownership, or restore deleted versions. restoreDeletedVersions:true requires the original definitions and valid dependencies; deletion hashes never remove local versions. Divergent or unavailable prompt pins reject. Layout-only drafts keep draftRevision. Conflicts roll back the whole import; runs and archive flags are kept.',
    {
      starterId: z.string().min(1).max(64).optional(),
      requestId: z
        .string()
        .min(1)
        .max(120)
        .refine((v) => /\S/.test(v), 'Use a nonblank request key')
        .optional(),
      copy: z.boolean().optional(),
      bundle: sharedBundle(workflowBundleSchema).optional(),
      force: z.boolean().optional(),
      variableBindings: variableImportBindingsSchema.optional(),
      boardSetup: boardImportSetupSchema.optional(),
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
          boardSetup: input.boardSetup,
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
        boardSetup: input.boardSetup,
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
      definition: sharedDefinitionSchema.optional(),
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
    'Update metadata or replace the definition with draft and current draftRevision. Use edit_workflow for small stable-ID changes, validate_workflow for preflight. Layout-only updates preserve content revision. Does not publish or start a run.',
    {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      draft: sharedDefinitionSchema.optional(),
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
    'Apply up to 100 ordered stable-ID edits with current draftRevision. Invalid edits or stale revision reject atomically. Updates shallowly replace fields; unset removes optional fields. Removing a group removes Batch descendants or Parallel members and incident edges. Surviving bindings and changed-port edges need explicit repair. Incomplete drafts save; publication blockers remain. Layout-only changes and No-op edits preserve revision and timestamp. Returned changes include moved nodes. diagnostics:summary keeps all errors, new/changed warnings, five unchanged samples and exact counts. Default all. Does not publish or run.',
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
    'Preflight stored draft or supplied JSON definition without saving. Returns draftRevision, saveable, publishable and located diagnostics. Save errors cover malformed/unknown fields and ownership. Publication checks graph, contracts, Batch/Parallel scopes, bindings, prompts and versions. Conservative contract warnings report unknown for ambiguous sources or unsupported schemas; runtime checks are authoritative. 2 MiB envelope limit; omit definition to validate a saved draft.',
    {
      id: z.string(),
      definition: authoringJsonSchema.optional(),
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
    'Preview adoption, reparenting or release (ownerWorkflowId:null). Returns current/proposed owners and blockers with exact foreign draft and retained version reference locations. Historical blockers need explicit version cleanup after human agreement.',
    ownershipPreviewSchema.shape,
    (input) => client.workflows.previewOwnership(input),
  );
  tool(
    'set_workflow_owner',
    'Adopt, reparent or release (ownerWorkflowId:null). Preview first and supply expectedOwnerWorkflowId, null for a library workflow. Stale ownership or reference blockers reject atomically. New owners must be active library workflows. A workflow with children cannot become a child. Same-owner calls are no-ops. Effective moves preserve identity, definitions and runs.',
    ownershipChangeSchema.shape,
    (input) => client.workflows.setOwner(input),
  );
  tool(
    'preview_version_deletion',
    'Preview, without mutation, the deletion of explicitly selected obsolete versions: identity hashes, blockers, affected history, consequences and the confirmation to pass. The latest version, draft and retained pins, active run bindings and transitive future dependencies, and queued or active comparison pins block cleanup, including Batch and detached calls. Historical callers need explicit selection; nothing cascades. Save an export backup and obtain human agreement to the impact before delete_workflow_versions. If the impact changes, preview and obtain agreement again.',
    versionSelectionSchema.shape,
    (input) => client.workflows.previewVersionDeletion(input),
  );
  tool(
    'delete_workflow_versions',
    'After human agreement, delete only reviewed versions using confirmation and acknowledgeHistoryLoss:true. Stale impact or blockers reject atomically. Retained run records lose graph inspection and retry for deleted bindings until restored. Earlier execution graphs can become unavailable after a version move. Returns deleted identities and affectedRuns.',
    versionDeletionSchema.shape,
    (input) => client.workflows.deleteVersions(input),
  );
  tool(
    'delete_workflow',
    'Permanently delete a workflow, saved editor layout, published versions, cleanup identities, and all its runs/descendants, including Parallel branches, Batch item runs and detached runs, plus assignments, events, and local test suites/comparisons/simulations and workflow triggers/fire or delivery logs. Durable event-trigger receipts remain. To remove only selected run history, use manage_run_history. Active simulations, queued/active comparison pins, and unreconciled resource reservations block deletion. Managed trial cleanup must finish before deleting comparison receipts. Any child run with a parent from another workflow blocks deletion: ancestor runs and the entire run tree remain intact. External draft or retained published references, active affected runs, or owned children also block deletion with exact locations. Start receipts retain deleted tombstones. Prefer archived:true with update_workflow to hide unused workflows and preserve history.',
    { id: z.string() },
    (input) => client.workflows.delete(input),
  );
  tool(
    'publish_workflow',
    'Validate and publish an immutable version without starting it. Use validate_workflow first. Parallel starts and Join returns stay within declared branches. Agents with unclaimedTimeoutMs and poll Waits with timing.timeoutMs require timeout routes. cascade atomically republishes transitive dependents from latest definitions, including archived; cycles or unpublished content reject.',
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
    'Read one workflow, full draft with saved positions, and input contract. draftRevision tracks content. draftMatchesLatest ignores positions and is null if unpublished. Published version numbers can have gaps. Use edit_workflow with the current revision or validate_workflow for read-only diagnostics.',
    { id: z.string() },
    (input) => client.workflows.get(input),
  );
  tool(
    'start_run',
    'Start a run of a retained published version, the latest when version is omitted. Missing required aliases, or presets without an eligible harness, can block a start; repair the configuration and start again. A repeated requestId returns the original run read-only, so keep the creation arguments identical. title is optional and survives continuation. Tags are inherited by children and chains. Capacity limits or after gates can return a queued run without assignments; after dependencies must succeed, and higher priority admits first with FIFO ties. The summary response supplies runId, cursor and next work; ok means the start was accepted, not that the run completed. Continue with briefings, waits and claims. detail:full returns inspection. Detached work may outlive its parent.',
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
    'Inspect a run and descendants with definitions, execution versions, events, prompt captures, variable refs and token-free work. Prefer briefing for continuation and get_run_result for selected payloads; above 64 KiB the response is compacted unless full:true. Removed versions report definitionAvailable:false and require restoration before retry. Follow chain.nextRunId for rollover. Detached runs are independent. Use manage_run_version for moves, manage_work_hold for older holds, and manage_script for Script progress.',
    { id: z.string(), full: z.boolean().optional() },
    (input) => client.runs.get(input),
  );
  tool(
    'list_runs',
    'Find newest run summaries with projections, tags, correlation and ancestry. Filters combine; tags require every exact case-sensitive pair. inputMatch uses dot paths, blank for whole input, structural equality. Limit default 50/max 1000; next page: afterRunId = last id. rootOnly excludes all children, including detached. Lookup reserves nothing; use start_run for retry/active-task policy. Chains inherit externalTask, not requestId.',
    runQuerySchema.shape,
    (input) => client.runs.find(input),
  );
  tool(
    'retry_run',
    'Retry a failed step after inspecting side effects that would repeat. Captures and budgets persist, bindings resolve again, and successful Batch items and Parallel branches are kept. Retry Parallel from the parent run after confirming that any revoked attempts stopped. Uncertain background Scripts need manage_script reconciliation with stopped:true, and Fetch transport failures require a confirmed remote stop before resources are reused. Managed Git trials cannot retry. Ordinary children retry through terminal parents; a failed detached child retries directly; handled failures need recovery in the parent. Completed and cancelled runs cannot retry, and completed dispatch never replays. Missing definitions must be restored first. Comparison retries require capacity and keep observations. An Agent retry resets failure and expiry allowances, not usage or claim gates.',
    { id: z.string() },
    (input) => client.runs.retry(input),
  );
  tool(
    'manage_run_version',
    'Manage which published version one run uses. Read paged history, policy, revision and blocker; set the policy with expectedRevision; preview a move to a newer published version; or apply it with the exact confirmation and a reason. Reads and previews never mutate. History defaults to 20 and caps at 100, without definitions or payloads. Runs are pinned by default; latest-compatible checks for a move before new executions. Missing nodes, invalid target input or captures, or an active execution block a move. Available and claimed assignments and active Wait, child and group visits finish unchanged, and Parallel branches stay on the version they were invoked with. A changed preview state rejects apply. recapturePrompts defaults to false; true honors target publish pins and otherwise captures current revisions. Budgets, continuity and child lifetimes persist. get_run reads execution versions.',
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
    "Manage whole run trees in history; workflows and versions are always kept. Manual preview accepts workflowId, before (compared with the tree's last update), rootRunIds, offset (default 0) and limit (default 20, max 100), and returns counts, bytes, blockers and confirmations. After the human agrees to the selected roots and the irreversible loss, delete with roots:[{runId,confirmation}] and acknowledgeHistoryLoss:true; the transaction rejects stale or protected selections. Trees include detached runs and chains. Active runs, jobs, uncertain ownership, and comparison or trigger evidence block cleanup. settings and configure optionally scope to workflowId; omission means the library. configure requires expectedRevision and the whole policy: age and count thresholds, where null disables and inherit removes a workflow override. Enable it only with authorization for permanent scheduled deletion. The library count pool includes inheriting workflows, while overrides count independently. Counts include failed and cancelled trees, and either threshold expires a tree by its last update. Scheduled cleanup runs hourly in batches of 100, retrying backlog and recently updated trees after 1 minute. status returns bounded sweep, error and storage metadata without payloads. Cleanup keeps start and trigger receipts. Freed SQLite pages are reused without compaction. Native harness and trial files remain.",
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
    'Discover available Agent assignments. runId includes all of its descendants, including detached work after the parent completes; omit it to list all work. Summary fields return identity, ancestry, context, counts and lease policy without payloads; fields:"full" returns the captured assignment. claim_work also returns it. Version moves keep existing work unchanged. availableUntil is the unclaimed deadline, and executor and managedExecution show automatic dispatch. An empty list is not completion: inspect get_run_briefing blockers and lifecycles and wait. Timers advance independently.',
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
    'Read a run-local continuity binding and paginated claim/handoff history (default 20, max 100). Unbound groups have revision 0 and session null. Group names never inherit across run boundaries, including Batch items and Parallel branches. Checkpoint references are opaque; Interlock does not read them.',
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
    "Read-only breakdown of an assignment's UTF-8 JSON size, without payload values. Pass workId for a captured assignment, or workflowId and nodeId to preview a draft; version selects a published pin. A preview sample accepts input, runInput, rootInput, itemInput and the latest same-scope node outputs. A supplied outputs map uses sourceDefault for absent node IDs when configured; otherwise omitted sources stay unknown. warningBytes defaults to 100000 and is advisory. Counts the prompt, context, input, output schema, execution instructions, saved prompt metadata and optional trial environment context, excluding envelope and identity fields. No token or billing estimate; it never claims or truncates.",
    assignmentSizeQuerySchema.shape,
    (input) => client.work.size(input),
  );
  tool(
    'claim_work',
    'Claim an available assignment, declaring your actual capabilities; custom launcher sessions also pass claimTicket. A continuityGroup requires session:{executorId,sessionId} matching its binding or an explicit handoff. Admission gates spend no attempts; held work needs a resume and an inspection of side effects. Resources are reserved atomically; stop all use of them before submitting or failing. Revocation leaves ownership uncertain. leaseSeconds (10 to 3600) overrides the node value and the default of 300; renew before leaseUntil. Expired tokens cannot renew or submit; inspect side effects before claiming again. Each expiry spends maxLeaseExpiries or maxAttempts. Managed trials need the interlock-local-trials capability. Claiming stops the availableUntil deadline and starts maxExecutionMs; renewals do not extend it, and pauses and holds are excluded from it.',
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
    'Inspect, read-only, the resource reservations of an Agent assignment by workId or a deterministic step by runId and executionId, without tokens or hashes. Includes resource-free uncertainClaims and uncertainOperations left after revocation. release takes expectedAttempt, actor and confirmStopped:true, and is only for after the exact old worker, subprocess or remote operation has stopped. Active owners reject, and a replacement owner is never touched. Cancellation, expiry, a hold, or a Fetch timeout or disconnect never proves a stop. There is no fencing or termination. Returns applied and released counts.',
    { request: workResourceRequestSchema },
    ({ request }) => client.work.resources(request),
  );
  registerPauseTools(tool, client);
  tool(
    'manage_work_hold',
    'Hold or resume one Agent assignment for an external blocker. hold needs the current expectedAttempt, expectedRevision (holdRevision, or 0), actor and category, and reason or checkpointRef; token optionally proves a claim, and local coordinators may omit it. Holds revoke claims, freeze unclaimed deadlines, and spend no failure or expiry allowance. Claimed resources become uncertain until a stop is confirmed. resume needs attempt, revision and actor, keeps budget and context gates, and returns the work for a fresh claim. needs_model holds require manage_executors retry_model instead. Changes return applied, status, attempt and holdRevision; an identical latest retry is a no-op and an intervening change conflicts. Holds on available work keep unclaimed-stall time; held claims resume as fresh availability. Read-only history defaults to 20 and caps at 100, with offset. Briefings show blockers and get_run shows recent history. External work is never replayed.',
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
    "Submit JSON that satisfies the captured output contract and resultRules; preflight_result checks the same without submitting. A rejection's resultCheck gives claimUsable, nextAction and diagnostics; correct the output under the same active claim. Stop subprocesses and resource use first. Acceptance releases reservations, while rejection keeps them. An identical retry recovers the acceptance; changed output or invalid ownership rejects. The summary response gives workId and workRunId, the continuation runId and runStatus, projections, cursor, and next work and action. Use the continuation runId and cursor with wait_for_run_change. Inspect the briefing for blocked or queued runs; no available work is not completion. detail:full inspects the immediate assignment run. get_run_result reads the transformed output; usage reporting is separate.",
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
    'Inspect Script state and progress, stop a Script and cancel its run, or reconcile an uncertain outcome, by runId and executionId. stop asks the supervisor to terminate the process group. reconcile requires stopped:true and a reason confirming that processes stopped and effects were inspected, and releases matching reservations.',
    { request: scriptOperationSchema },
    ({ request }) => client.runs.script(request),
  );
  tool(
    'preview_run_cancellation',
    'Preview, read-only, which active descendants cancel_run_tree would cancel, following terminal parents and forward chains. includeDetached defaults to false; true crosses detached boundaries. Ancestors and siblings are never included. Returns compact items, total, truncated and nextOffset; limit defaults to 20 and caps at 100, offset defaults to 0. Does not advance work. cancel_run_tree recomputes membership when it runs.',
    previewRunCancellationSchema.shape,
    (input) => client.runs.previewCancellation(input),
  );
  tool(
    'cancel_run_tree',
    'Atomically cancel active descendants, following terminal parents and forward chains. includeDetached defaults to false; true crosses detached boundaries. The required reason is recorded on each cancelled run and event. Terminal outcomes stay as they are. Selected chains cannot roll over or retry. External stops follow the commit; uncertain ownership requires stop reconciliation for the exact attempt. Preview first with preview_run_cancellation. Returns cancelled:{items,total,truncated}; limit (default 20, max 100) bounds only the response.',
    cancelRunTreeSchema.shape,
    (input) => client.runs.cancelTree(input),
  );
  tool(
    'cancel_run',
    'Cancel a queued or admitted run and its ordinary active descendants. scope:"chain" cancels the latest successor from any chain member and prevents rollover and retry. Both stop at detached boundaries; use cancel_run_tree with includeDetached:true to cross them. Timers never resume. Stop background Scripts with manage_script. Revoked claims and resources require exact stopped reconciliation through manage_work_resources; a terminal run is not necessarily quiescent. Trial cleanup also requires update_workflow_comparison cleanup_trial confirmation.',
    cancelRunSchema.shape,
    (input) => client.runs.cancel(input),
  );
  return server;
}
