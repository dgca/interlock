# Author and operate workflows

## Project run stages and waiting

Nodes can set optional `stage` text, trimmed to 1–200 characters. Use the node editor's Stage field or the same field in definitions and `edit_workflow` node updates. This changes reporting, not routing.

All run summaries, full run/descendant inspection, briefings, compact start/submission responses, and new event snapshots expose `stage`, `waiting`, and `actor`. Stage is the deepest active label across waited children and Batch items; detached children stay independent. Equal depths use latest execution start, then ascending run/node IDs. An unlabeled child falls back to its labeled active ancestor. Terminal runs return null stage and waiting, and engine actor.

`waiting` is null during execution, or `{kind, detail, since}`. Detail identifies the run, node, execution, and assignment when present. `since` uses a persisted execution, assignment, hold or budget timestamp; reads and restart do not reset it. Resource waits use assignment creation as their available persisted anchor.

| Kind             | Current meaning                                                       | Actor                                     |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| `claim_queue`    | Connected Agent available                                             | agent                                     |
| `managed_launch` | Managed assignment awaiting dispatch                                  | engine                                    |
| `human_request`  | Managed permission, question, configuration, model choice or recovery | person                                    |
| `input_node`     | External submission or acceptance required                            | agent                                     |
| `hold`           | Assignment or external-input acceptance held                          | person                                    |
| `budget`         | New claim blocked by budget                                           | person                                    |
| `resource`       | Shared resource occupied                                              | engine, or person for uncertain ownership |
| `timer`          | Wait deadline pending                                                 | engine                                    |
| `poll`           | Polling Wait pending                                                  | engine                                    |

Person applies only when every active waited leaf requires intervention. A branch that can progress takes precedence, then agent before engine, then the stage tie order. External input uses agent because an integration can submit and accept automatically. Read briefing blocker lists to see branches omitted by the single waiting choice. Claimed connected work uses agent with null waiting; native execution uses engine.

Polling detail includes deadlines and `lastCheck` with count, at, optional error capped at 500 characters, and optional JSON output text capped at 512 characters. `truncated` indicates an incomplete preview; use full inspection for the original output. `pause` reports applicable named holds and `admission_queue` reports queued start blockers. Existing `waitReason` stays compatible. Historical events can omit projection fields; new events capture them when recorded.

## Manage run budgets

Optional [run budgets](run-budgets.md) stop new Agent claims when limits are reached. Use `get_run_budget` to inspect policy and usage, and `set_run_budget` for an authorized adjustment. `next:adjust_budget` and budget blockers identify recoverable gates; already claimed work can finish. Keep detached scope and incomplete-report policy explicit.

## Report usage

For executor-supplied or observer-supplied token counts and costs, use `report_usage` and `get_run_usage`. [Usage reporting](usage-reporting.md) defines cumulative snapshots, attempt identity, delayed reports, descendant scope, and coverage. A successful assignment does not imply complete usage data.

## Compare published workflow behavior

Use the [workflow testbench](workflow-testbench.md) to save representative cases, preview exact run counts/pins/current prompt revisions, and execute paired published versions. Resume a comparison through its ID and existing work claims; reuse the same start request ID after uncertain delivery. Keep execution errors, pass/fail/unknown checks and declared quality judgments distinct. Reports are bounded and link ordinary run inspection. Report metrics summarize both sides and paged paired cases with timing, reported cost and quality coverage. Follow `metrics.cases.nextOffset` for case pages; cost details support a `currency` filter. Timing/cohorts stay frozen after retries, while original late receipts can improve usage. Availability is descriptive and never selects a winner. Comparison cancellation preserves detached independence unless explicitly selected otherwise. In-flight comparison pins block cleanup/deletion; portable bundles exclude local cases and comparison records.

## Claim duration and expiry

Agent nodes can set `leaseSeconds` to a whole number from 10 through 3600. A claim uses the caller's explicit `leaseSeconds`, otherwise the node setting from the run's published version, otherwise 300 seconds. For example, an Agent with `"leaseSeconds": 1800` gives workers a 30-minute claim when they omit an override. Longer leases delay recovery when a worker disappears.

`list_work` and continuation summaries include the optional configured `leaseSeconds`. `claim_work` returns the effective `claimLeaseSeconds` and ISO `leaseUntil`. Renew before that deadline. Omitting `leaseSeconds` from `renew_claim` reuses the original effective duration; an explicit renewal override applies only once. Claims without `claimLeaseSeconds` use 300 seconds for omitted renewals. Renewal does not extend optional Agent `maxExecutionMs`; see [active attempt deadlines](timers.md#stall-detection-and-active-attempt-deadlines).

Each expired claim records `work.lease_expired` with its assignment ID, deadline, counts, and recovery guidance. By default, reported failures and expiries share `maxAttempts`. To separate them, set Agent `maxLeaseExpiries` to an integer from 1 through 10, or enable **Separate lease expiry budget** in Agent settings. With that setting, `maxAttempts` limits explicit failures and `maxLeaseExpiries` limits expiries. Reaching either count fails the run. For example, `maxAttempts: 2, maxLeaseExpiries: 3` permits recovery after two expiries but fails on the third, or on the second explicit failure.

`attempt` counts successful claims and never decreases. Claims released by an external hold increment optional `heldClaimCount`; subtract that count when interpreting the legacy combined failure/expiry allowance. Run claim budgets still count every successful claim. Separate-policy assignments expose `failureCount`, `leaseExpiryCount`, and `maxLeaseExpiries` in claims, discovery, and continuation summaries. Policy and counters persist across restarts. Policy comes from the run's published definition; editing a draft does not change active work. An unclaimed timeout remains a separate deadline to pick up work.

Expired tokens cannot renew or submit results. Recognized expired-token errors distinguish an available assignment, a later claim, terminal work, and exhausted budgets. When the assignment is available, call `claim_work` with your actual context and capabilities, then use its new token. Availability can change before that call. Preserve code and evidence saved outside Interlock, and check whether the assignment and result are still applicable before resubmitting. Reclaiming does not make repeated external side effects safe. Inspect the run before explicitly retrying an exhausted failed step. Unknown tokens and tokens whose expiry history was not recorded return an invalid-token error.

## Request compact authoring responses

Pass `detail: "summary"` to `create_workflow`, `update_workflow`, and `publish_workflow` to receive `ok`, `id`, `draftRevision`, `latestVersion`, `draftMatchesLatest`, and `archived` without the definition. Use the returned revision for the next edit. `draftMatchesLatest` is null before first publication. Publication returns the committed version number; cascade summaries describe the requested workflow. Archive and restore use `update_workflow.archived` with the same detail option.

Omitting `detail`, or passing `full`, returns the full workflow record and draft. Use `get_workflow` when you need the current definition. Imports already return compact IDs, revisions, and change lists. The shared API exposes `workflows.createSummary`, `updateSummary`, and `publishSummary`; the full operations keep their response shapes.

HTTP and stdio tool discovery includes object-root output schemas for these authoring mutations, `edit_workflow`, `claim_work`, `start_run`, `submit_result`, and `list_work`. A client may omit schemas in its own display; inspect raw `tools/list` when diagnosing discovery.

## Respond to an external-input wait

An `external_input` blocker identifies the exact run and execution waiting for an external answer. Use MCP `external_input` for status, submission, and explicit revision acceptance. Use the receipt to recover after an uncertain response. See [Wait for an external answer](external-input.md).

## Discover schemas and assignments

For manual history removal, use `manage_run_history` with `request.action:"preview"` before `"delete"`. Preview accepts root workflow and age filters, exact root IDs, and bounded pagination. Show the selected trees, sizes, blockers and irreversible loss, then obtain explicit user agreement. Delete accepts exact per-root confirmations and `acknowledgeHistoryLoss:true`; it rechecks the entire selection atomically. Active trees, unresolved resources and retained comparison/evaluation dependencies remain protected. Start-request tombstones, workflows and published versions survive. Removed JSON bytes do not imply a smaller database file. For opt-in scheduled cleanup, use the same tool with `settings`, `configure` and `status`. Configure requires the current scope revision and authorization for permanent age/count deletion. A workflow whole-policy override replaces library inheritance; null disables and `"inherit"` removes the override. See [history cleanup](history-cleanup.md) for bounds, count pools, scheduling, fields and recovery.

MCP `create_workflow.definition` and `update_workflow.draft` expose the workflow object schema, including node fields and edge handles. Incomplete routes remain saveable drafts. Publication validates graph routes and pinned dependencies. For small changes, `edit_workflow` avoids resending the full graph. `validate_workflow` reports read-only diagnostics for the stored draft or a candidate.

For node configuration and examples, see [author definitions through MCP](connect-harness.md#author-definitions-through-mcp), [workflow definitions and Batch scopes](architecture.md#workflow-definitions), [branch routing](switch.md), and [input and output bindings](node-data.md).

Set `timeoutMs` on a Script node to allow 100 to 3,600,000 milliseconds. Omission uses 60,000. Polling checks use a separate timeout with a 30,000-millisecond default and a 120,000-millisecond maximum. See [polling Waits](timers.md#polling-waits).

Scripts and polling Script checks can read `INTERLOCK_RUN_ID` directly from
their environment to inspect the current run. See [Script execution context](architecture.md#script-execution-context).

Script, Fetch and waited Workflow calls support `onFailure: "route"` with `default` and `failed` edges through these same tools. Failed receives the fixed `{input,error,output}` contract described in [failure routes](failure-routes.md). The operation stays failed while its run continues. Workflow failures add `error.child` run/version/execution references. Cancelled children and caller input/dispatch errors remain terminal; a handled child cannot be retried independently. Earlier-node bindings select completed outputs only; read the incoming envelope for recovery. Removing the policy through MCP requires explicitly removing its edge. No automatic retry is added, and completed recovery runs cannot be retried.

`start_run.input` and `submit_result.output` accept any JSON value matching the workflow or assignment contract, including objects, arrays, scalars, and null. Pass structured values directly. JSON-looking strings remain strings and are never implicitly parsed.

Agent `context.mode` accepts `current` or `fresh`. An executor satisfies `fresh` with a new session or an isolated subagent without inherited conversation history. `isolated` is not a mode value. Declare only tools, skills, and isolation that the executor provides.

`list_work` defaults to `fields: "summary"` for discovery. Summaries include assignment ID, run ID, node ID, label, status, context requirements, attempt counts, optional configured `leaseSeconds`, and any unclaimed deadline.

Work summaries also include `workflowId`, optional `parentRunId`, optional `parentMode: "detached"`, `rootRunId`, and `rootWorkflowId`. `workflowId` identifies the immediate run's workflow. `rootWorkflowId` identifies the outermost workflow so a dispatcher can select an executor without fetching run history. Root runs omit `parentRunId` and use their own run and workflow IDs as root IDs. Ancestry follows execution, independently of workflow ownership.

Work summaries omit prompts, inputs, output schemas, and execution instructions. `claim_work` returns the complete assignment. Use `fields: "full"` to inspect complete assignments before claiming. CLI callers can use `interlock work RUN_ID --summary`. The shared API exposes `work.summaries` and `work.list`.

## Manage an existing run's version

By default a run stays on its starting version. `start_run.versionPolicy: "latest-compatible"` opts into compatibility checks before each new execution. Use `manage_run_version` with `request.action: "read"` for the current version, policy revision, blocker, and bounded change history. Use `"policy"` with `expectedRevision` to change that run's policy. Policy updates do not replace available or claimed assignments.

For an explicit move, use `request.action: "preview"` with `runId` and an exact newer `version`, then `"apply"` with the same request, returned `confirmation`, and a reason. Preview is read-only; apply rejects stale state or blockers atomically. Available assignments, timers, input waits, active Batches, and waited calls are active executions rather than safe boundaries. Enable policy while they finish, or use a named pause to retain the next boundary for explicit apply.

Saved prompts stay captured unless preview and apply both explicitly set `recapturePrompts: true`. Recapture follows the target publication's prompt pins. Variables and model aliases retain captured revisions. Inspect [run version behavior](workflow-execution.md#move-a-run-to-a-newer-version) for Batch, child, chain, and cleanup rules. Execute the assignment you actually claimed, including its captured prompt and contracts.

## Continue with compact mutation responses

`start_run` and `submit_result` default to `detail: "summary"`. They return run status and continuation guidance without workflow definitions or accumulated execution payloads. Explicit `detail: "full"` includes the definition, execution history, input/output payloads, and assignments. `list_work` defaults to summaries; `claim_work` returns the complete assignment.

For example, start with `{"workflowId":"WORKFLOW_ID","input":{}}` using input that matches the workflow contract. After claiming an assignment, submit `{"workId":"WORK_ID","token":"CLAIM_TOKEN","output":{}}` using output that matches that assignment's contract.

Summary responses contain:

| Field                  | Meaning                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                   | The operation was accepted. Subsequent workflow execution can still fail.                                                                                                                                                              |
| `runId`, `runStatus`   | Continuation lifecycle and its current status.                                                                                                                                                                                         |
| `workId`, `workRunId`  | Submission only: accepted assignment and its immediate owning run.                                                                                                                                                                     |
| `cursor`               | Opaque continuation cursor for the returned `runId`.                                                                                                                                                                                   |
| `nextWork`             | `{items, total, truncated}` for available work in the continuation run and all descendants, including detached work. Items include ancestry, `lifecycleRunId`, context mode, required tools/skills, attempts and applicable deadlines. |
| `next`, `nextDeadline` | Suggested action and earliest active deadline, or null. Use a briefing for blockers and failure details.                                                                                                                               |
| `nextCall`             | Suggested read-only MCP call as `{tool, arguments}`, or null when `next` is `claim_work`.                                                                                                                                              |

At startup, `runId` is the new run. After submission, it is the outermost ordinary ancestor of `workRunId`, stopping at the nearest detached boundary. Completing a waited child or Batch item can therefore return work unlocked in its parent or siblings. Detached submissions continue their independent lifecycle. `rootRunId` in work items describes ancestry, not a cancellation boundary.

Use `wait_for_run_change` with `id` equal to the returned `runId` and the returned `cursor`. Status, available work, guidance and cursor come from one post-mutation snapshot. Empty `nextWork.items` does not prove completion. A completed parent may still have detached work; inspect `runStatus` and each item's `lifecycleRunId` before continuing independent work.

`limit` defaults to 20 and accepts integers 1 through 100. It bounds `nextWork.items` in summary mode; full mode ignores a valid limit. Totals remain exact. When `truncated` is true, call `list_work` with the continuation run ID and `fields: "summary"` for all available work. This bounds record counts, not arbitrary label or capability-name lengths. Definitions, execution history, prompts, context instructions, input/output values and claim tokens are absent from summary responses.

An identical submission can be retried with the same token. It does not repeat the transition, but returns current progress in the selected mode. Later work or a server restart can change the response and cursor. Different output under an accepted submission still rejects. Validation errors retain the existing MCP error shape.

Script nodes may opt into `executionMode: "background"`. `get_run` exposes `execution.background`; use MCP `manage_script` with `{request:{action:"inspect",runId,executionId}}` for bounded progress/state, or `action:"stop"` to cancel that run and request process-group termination. CLI `interlock script` accepts the inner request JSON, and the shared API uses `runs.script`. Inspect after cancellation to verify cleanup. Background work survives server shutdown and recovers its original result without replay. An `uncertain` outcome requires `action:"reconcile", stopped:true, reason:"..."` after inspecting original processes and effects. This permits a separate explicit `retry_run`; it never supplies success. Parent Workflow and Batch retries require reconciliation of every uncertain attached descendant they would resume. See [Script recovery boundaries](architecture.md#scripts-and-interruptions).

`get_run` provides full inspection of an existing run. Use read tools for inspection. An unkeyed repeated `start_run` creates another run; an identical keyed redelivery reads its original run without advancing it. See [safe start retries](idempotent-run-starts.md). `get_run_result` reads selected values. The shared API exposes `runs.startSummary` and `work.submitSummary`, accepting the corresponding mutation arguments and optional `limit`. These return runtime summaries; MCP adds `nextCall`. `runs.start`, `work.submit`, UI, and CLI return full responses. `start_run`, `submit_result`, and `list_work` advertise output field schemas over both MCP transports; mode-specific required fields are listed above. `fail_work`, `retry_run`, and `cancel_run` return full inspection.

`nextCall` suggests `get_run_result` for a completed result, `get_run_briefing` for failure, cancellation, or an external hold, or `wait_for_run_change` for claimed work and pending execution. Wait suggestions pair the snapshot's run ID and cursor and use the tool's finite wait default. Suggestions are read-only and do not execute automatically. The field is present on compact start/submission responses, not on briefing or wait responses.

When `nextCall` is null, choose an assignment from `nextWork` and call `claim_work` with your worker ID and actual capabilities. Fulfill fresh-context requirements in the executor that claims the work. If discovery is truncated, use `list_work` for the remaining assignments. A completed parent can still suggest continuing independent detached work; inspect each assignment's lifecycle before acting.

After completion, read the persisted output with `get_run_result` before reporting the workflow's answer. Downstream steps can transform the last submitted value. Result reads default to 64 KiB; if the value exceeds that limit, select a narrower `path` or an explicit `maxBytes` up to 256 KiB. Use the briefing's `next` field after a wait to choose between claiming work, waiting, inspecting failures, and reading results.

For consumers upgrading from 0.1, see [MCP response defaults in 0.2](upgrading.md#mcp-response-defaults-in-02).

## Discover workflows and read results

MCP `list_workflows` returns compact summaries by default, with `id`, `name`, `description`, `ownerWorkflowId`, `archived`, `latestVersion`, `draftRevision`, `createdAt`, `updatedAt`, and `draftMatchesLatest`. Node definitions, prompts, and contracts are omitted. Use `get_workflow` to read one complete draft or `list_workflows` with `includeDraft: true` for the previous full listing. Owner and archive filters apply to both shapes. Shared HTTP API `workflows.list`, CLI `interlock workflows`, and the editor retain full drafts.

Successful MCP tools return `structuredContent` alongside the existing JSON text. Object results such as `get_workflow`, `export_workflow`, and `get_run` appear directly in `structuredContent`. Array results such as `list_workflows`, `list_prompts`, and `list_work` use `structuredContent.items`; scalar or null results use `structuredContent.value`. These values match the parsed JSON text. Error responses retain `isError` and their text message without success data. No output wrapper changes the JSON text payload.

## Inspect draft publication state

`list_workflows` and `get_workflow`, through shared API `workflows.list` and `workflows.get`, include `draftMatchesLatest`. It is `true` when the draft structurally equals the latest published definition, `false` when it differs, and `null` when there is no published version. Object key order does not affect equality; array order does. A manually reverted draft can match again. Metadata edits such as renaming do not change definition equality.

`draftRevision` counts draft saves and `latestVersion` counts publications. Comparing these numbers does not indicate unpublished changes. The field is derived on read without changing stored records, versions, or exports. The editor's publication comparison remains available; a persistent draft-state marker in the editor is a follow-up.

## Edit a draft atomically

Read `get_workflow` for the current `draftRevision`, then call `edit_workflow` with at most 100 ordered edits. The shared API is `workflows.edit`. All edits apply to a copy before the final draft is validated and saved in one transaction. Stale revisions and save errors reject the whole list. Neither editing nor validation publishes or starts a run.

```json
{
  "id": "WORKFLOW_ID",
  "draftRevision": 3,
  "edits": [
    {
      "op": "update_node",
      "id": "research",
      "set": { "prompt": "Research the protocol and cite primary sources." }
    },
    {
      "op": "add_node",
      "node": {
        "id": "check",
        "kind": "agent",
        "label": "Check research",
        "prompt": "Check the research against the requested contract.",
        "inputBindings": {
          "research": { "source": "node", "nodeId": "research", "path": "" }
        }
      }
    },
    {
      "op": "update_edge",
      "id": "research-next",
      "set": { "target": "check" }
    },
    {
      "op": "add_edge",
      "edge": { "id": "check-next", "source": "check", "target": "finish" }
    }
  ]
}
```

This example assumes an existing `research` node, `research-next` edge, and `finish` node. IDs identify stored objects, independently of labels and array positions.

For new graphs or structural changes, add top-level `layout: "tidy"` to `create_workflow`, `update_workflow`, or `edit_workflow`. It applies the editor's Dagre layout in the same save. Use `layout: "preserve"` for content-only replacements that must retain saved positions; omit it to accept supplied positions. Updates require the current `draftRevision`, including layout-only updates without a replacement draft. Edit responses include moved nodes in `changes`; layout-only changes preserve the content revision and workflow timestamp. See [authoring layout](authoring-layout.md) for shared API and CLI examples.

| Operation         | Fields                                 | Behavior                                                                                                                                     |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_node`        | `node`                                 | Add a definition-format node with a new ID. Added scripts default to `language: "javascript"`.                                               |
| `update_node`     | `id`, optional `set`, optional `unset` | Shallowly replace named fields and remove named fields. ID and kind cannot change.                                                           |
| `remove_node`     | `id`                                   | Remove the node, all nested Batch members, and incident edges.                                                                               |
| `add_edge`        | `edge`                                 | Add a definition-format edge with a new ID. Omitted port defaults to `default`.                                                              |
| `update_edge`     | `id`, optional `set`, optional `unset` | Replace or remove named edge fields. ID cannot change.                                                                                       |
| `remove_edge`     | `id`                                   | Remove one edge.                                                                                                                             |
| `update_settings` | optional `set`, optional `unset`       | Edit workflow contracts, limits, stall policies, Agent defaults, recovery policies, `sessionNameTemplate`, `cwd`, and `pinPromptsAtPublish`. |

`set` replaces the entire named field, including nested objects such as `context` or `inputBindings`. `unset` is an array of field names. A field cannot appear in both. Unsetting a required field fails unless the definition schema supplies a default. Unsetting an absent field also fails. Unknown operation, node, edge, or settings fields fail instead of disappearing. JSON Schema contract contents remain unrestricted. Existing scripts with omitted language retain Bash; explicitly unsetting language restores legacy Bash behavior. Defaulted fields, such as maxSteps, reset to their schema default when unset.

Removing a node preserves bindings in surviving nodes. Those bindings become publication blockers until explicitly repaired. Removing or renaming a source port preserves its edges, so reconnect or remove them in the same edit list, or save and repair the incomplete draft later. Batch membership remains explicit through `batchId`; existing publication scope checks apply. Workflow ownership is not editable through draft edits; use the [dedicated ownership operation](#change-workflow-ownership). Saved references still obey owned-child rules.

The result contains `applied`, `draftRevision`, `changes`, and `diagnostics`. `changes.nodes` and `changes.edges` each contain added, updated, and removed IDs; `changes.settings` lists changed fields. Content changes increment the draft revision once. Position-only changes save layout separately. Empty or equivalent edits preserve both revision and timestamp. Equality ignores object key order. Rejected edits return `applied: false`, the current revision, empty changes, and diagnostics. Invalid edits identify their zero-based `operationIndex`. A stale revision has code `stale_revision`; reload before retrying.

## Validate without saving

Pass `diagnostics: "summary"` to `edit_workflow` to return every error and every new or changed warning across the graph, plus up to five samples of unchanged warnings. `diagnosticSummary` reports `total`, `returned`, `omitted`, `unchangedWarnings`, and `counts` grouped by severity and code. Counts include every error and deduplicate only exact warnings. Distinct node, edge, and field locations remain distinct. Stable node/edge identity prevents index shifts from making warnings appear new. Whole-graph validation still runs. Omitting the option, or passing `all`, returns the full diagnostic list. The sample limit does not cap arbitrary message lengths or the number of new warnings and errors.

Call `validate_workflow` with an `id` to inspect its stored draft, or include a candidate `definition`. The shared API is `workflows.validate`. The result contains the stored `draftRevision`, `saveable`, `publishable`, and diagnostics. Candidate validation never saves the candidate. These calls do not create a version or a run. Full replacement remains available through `update_workflow`.

Validation requests have a 2 MiB UTF-8 body limit, including the transport envelope. The shared client sends validation queries in POST bodies so large candidates do not exceed HTTP URL limits. Existing GET callers remain supported. Oversized requests report the body limit without saving anything. Reduce the request size, or omit `definition` to validate an already saved draft.

Each diagnostic has `severity`, `category`, stable `code`, property `path`, and `message`, plus relevant `nodeId`, `edgeId`, or `operationIndex`. Paths use definition array positions and field names, while IDs locate the graph object. Contract-warning paths describe the expected value beneath its contract field; literal property names with dots, empty strings, or other special characters use brackets and JSON quotes. Binding source paths retain their documented dot-separated syntax. Categories have separate consequences:

- `save` errors reject edits, including invalid structure, unknown fields, and child ownership conflicts.
- `publication` errors permit saving, but block publication. Examples include missing routes, invalid contracts, scopes or bindings, and unavailable workflow pins.
- `contract` warnings describe a conservative preflight subset. They do not block saving or publication.

Common codes include `invalid_edit`, `invalid_edit_list`, `invalid_definition`, `unknown_field`, `workflow_ownership`, `duplicate_id`, `incomplete_routes`, `invalid_port`, `invalid_binding_source`, `binding_scope`, `batch_scope`, `invalid_contract`, `unresolved_version`, and `missing_workflow_version`. `publication_invalid` reports remaining rules from the authoritative publication validator. The collector reports independent problems where practical; some graph scope checks retain their first-error behavior.

Contract warnings identify ordinary primitive type conflicts through `contract_type_conflict`, required fields excluded by closed object schemas through `contract_missing_path`, and excluded binding paths through `binding_missing_path`. Checks follow declared object properties, array items, binding projections, pass-through steps, Batch item inputs, and Agent timeout inputs. Explicit input contracts do not hide upstream conflicts.

`contract_unknown` and `binding_unknown` report unsupported schemas, unknown source contracts, ambiguous merges, or bounded recursive inference. Complex keywords such as `anyOf`, references, enums, and numeric constraints are outside the compatibility subset, as are type unions and schemas containing only annotations. Selecting an entire object or array with unknown nested shapes reports uncertainty; selecting a separately known field still supports type and missing-path diagnostics. Root input contracts are unknown because a workflow can be invoked as a child. Preflight does not prove complete JSON Schema compatibility, field presence in open objects, array-index existence, or availability of an earlier node's completed output. Runtime value validation remains authoritative. `publishable: true` means publication checks pass, not that every possible run succeeds.

## Resume a run with a briefing

Call `get_run_briefing` with `{id: RUN_ID}` when resuming an existing run. The shared API is `runs.briefing`. This read does not pump the engine, claim work, or change timers.

The response contains these fields:

| Field                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                       | Requested identity, workflow/version, status, ancestry, current execution ID, and result reference. No input, output, or definition.                                                                                                                                                                                                                                                                                                                        |
| `progress.requested`        | Run status counts for the requested run and ordinary descendants, excluding detached trees.                                                                                                                                                                                                                                                                                                                                                                 |
| `progress.independent`      | Run status counts across detached trees within the requested ancestry.                                                                                                                                                                                                                                                                                                                                                                                      |
| `progress.executions`       | Execution-visit status counts in the requested lifecycle, including earlier attempts and loop visits.                                                                                                                                                                                                                                                                                                                                                       |
| `descendants`, `detached`   | Run summaries and detached boundary references. `lifecycleRunId` is the requested ID for ordinary descendants, and the nearest detached ancestor's ID for independent trees. A directly detached run identifies itself.                                                                                                                                                                                                                                     |
| `available`, `claimed`      | Assignment identity, execution reference, ancestry, lifecycle, context mode, tool/skill requirements, attempts, worker, and applicable deadline. Prompts, instructions, schemas, inputs, outputs, and tokens are omitted.                                                                                                                                                                                                                                   |
| `held`                      | Compact work/run/lifecycle references, category, heldAt, attempt and holdRevision for externally held assignments; reasons and checkpoint contents are omitted.                                                                                                                                                                                                                                                                                             |
| `blockers`                  | `external_hold`, `budget_blocked`, `available_work`, `claimed_work`, `wait`, `external_input`, `children`, `executing`, or `failure`, with run/execution/work references. Wait blockers include `resumeAt`; polling also includes `nextCheckAt`, optional `timeoutAt`, and `check` metadata (`count`, `at`, optional `error`) without output. External input blockers include `waitingSince`, `revision`, and optional `heldByRunId` under `externalInput`. |
| `failures`                  | Currently failed run references and errors. Collected Batch item failures and handled Workflow child failures can appear while their parent remains waiting or completes.                                                                                                                                                                                                                                                                                   |
| `batches`                   | Per-execution total, dispatched and queued item counts, plus dispatched item status counts. Terminal status distinguishes undispatched items from work still pending.                                                                                                                                                                                                                                                                                       |
| `deadlines`, `nextDeadline` | Sorted active deadlines: `wait` for duration/timestamp Waits, `poll_check` for the next probe, `poll_timeout` for the polling deadline, `unclaimed`, and `claim_lease`. Earliest deadline or null.                                                                                                                                                                                                                                                          |
| `recentResults`             | Recent completed execution references, labels, kinds, selected ports, timestamps, and output availability. No result values.                                                                                                                                                                                                                                                                                                                                |
| `next`                      | Suggested action: `claim_work`, `adjust_budget`, `inspect_hold`, `wait_for_worker`, `wait_for_change`, `inspect_failure`, or `inspect_result`. Inspect requested status and lifecycle IDs before acting on independent work.                                                                                                                                                                                                                                |
| `cursor`, `revision`        | Continuation cursor and monotonically increasing scoped revision. These differ from the graph-node `cursor` inside `run`.                                                                                                                                                                                                                                                                                                                                   |

Each list has `{items, total, truncated}`. `limit` defaults to 20, accepts 1 through 100, and applies independently to every list. Totals, status counts, and the earliest deadline remain complete. Limits bound record counts, not the size of stored labels, capability names, or error text. Large trees still require metadata aggregation. Use `list_work` for all available assignments or `list_runs` to find individual descendants when a list truncates.

Briefing scope includes all descendants. Requested completion is independent of detached progress. Operate a detached lifecycle with its own run ID. `rootRunId` and `rootWorkflowId` continue to describe ancestry and do not define cancellation or waiting boundaries. A completed parent never establishes that a dispatched child completed.

Call `claim_work` for the full assignment. For one persisted value, call `get_run_result`, shared API `runs.result`:

```json
{
  "id": "RUN_ID",
  "executionId": "EXECUTION_ID",
  "field": "output",
  "path": "recommendation.title"
}
```

Omit `executionId` for run data. `field` is `input` or `output`, defaulting to `output`. Blank `path` selects the whole field; dot-separated paths select object keys or array indices. JSON null is a value. Missing runs, foreign execution IDs, unavailable outputs, missing paths, and unsafe property paths return errors. `maxBytes` limits the selected value's UTF-8 JSON encoding, defaults to 65536, and accepts 1 through 262144. Oversized values return an error with their size; select a narrower path. It limits the value, not the complete response envelope. `get_run` remains full inspection, including execution errors and resolved Fetch requests.

## Wait for a scoped change

Call `wait_for_run_change`, shared API `runs.wait`, with `{id, cursor}` from the last briefing or wait. `limit` has the same bounds as briefing. `timeoutMs` defaults to 30000, accepts 0 through 60000, and zero checks immediately. Configure the client request timeout above the selected duration.

Each response is a fresh bounded briefing plus `changed`, `timedOut`, and `reset`. Current cursors wait until a relevant change or timeout. On timeout, `changed:false`, `timedOut:true`, and `reset:false` accompany the current snapshot. No historical prompts, results, or events are replayed. Save the returned cursor for the next call.

Run and assignment changes throughout the requested ancestry wake the wait, including claims, lease renewal, completion, retries, cancellation, timer advancement, and detached descendants. Timestamp-only run writes, unrelated runs, and workflow edits do not wake it. The timer pump continues independently; the read does not advance timers. Writes rolled back in a transaction do not advance the visible cursor.

SQLite stores one latest revision per retained run and one global sequence. Revisions advance transactionally and do not depend on timestamp uniqueness or event retention. Run deletion removes its revision record; events remain governed by existing history/deletion behavior. The opaque cursor includes the server incarnation and requested ID. Do not construct or compare cursor strings for ordering. Compare numeric revisions within an incarnation.

Restart, malformed, foreign-run, and future cursors return a fresh snapshot immediately with `changed:true`, `reset:true`, and `timedOut:false`. Continue with that cursor. Reset does not mean completion. A valid older cursor in the same incarnation returns a changed snapshot without reset. Missing or deleted runs error.

Concurrent waiters are independent. Subscription precedes snapshot generation, so an intervening change cannot be lost. No database transaction stays open while waiting. Request cancellation, disconnect, and engine shutdown release listeners and timers. Shared API clients can pass an AbortSignal; Stdio MCP request cancellation releases the proxied wait. HTTP MCP releases waits when the actual HTTP request is aborted or disconnected. Some MCP clients cancel only their local promise and send a separate notification while leaving the POST active. The stateless endpoint cannot safely correlate that notification across clients; such waits end at their finite deadline. The stdio bridge gives each wait its own HTTP request, so another operation can complete or be cancelled independently. HTTP MCP remains stateless JSON request/response, with no transport session or standalone notification stream.

## Drive a run from the CLI

The CLI uses the same running server as MCP. Set `INTERLOCK_URL` when the server is not at `http://127.0.0.1:4310`. Start once, retain its `runId`, and continue that run:

```sh
interlock start WORKFLOW_ID @input.json --summary
interlock work RUN_ID --summary
interlock claim WORK_ID worker-name --lease 1800
# Execute the returned prompt and input; save the JSON result in result.json.
interlock renew WORK_ID TOKEN
interlock submit WORK_ID TOKEN @result.json --summary
```

Repeat discovery, claim, execution, and submission for subsequent assignments. Renew before the claim deadline during long work. Inspect each summary's `runStatus` and `nextWork`; an empty list alone does not mean completion. For pending work, rediscover the existing run later. Use `interlock run RUN_ID` when full inspection or final output is needed. Detached descendants can remain active after the requested lifecycle finishes; inspect their own run IDs.

Start accepts an optional positional version before or after `--summary`. Submit and start omit definitions and historical payloads only when `--summary` is present. Their summaries include the same `nextCall` suggestions as MCP; these are MCP tool names and arguments, not executed shell commands.

Use `claim WORK_ID worker-name --fresh` only from a fresh session or isolated executor. The flag attests isolation; it does not create it. Claim also accepts an options JSON object or `@file` after the worker ID, including `tools`, `skills`, `freshContext`, and `leaseSeconds`. Explicit `--fresh` and `--lease` flags override the corresponding JSON values. Lease seconds must be an integer from 10 through 3600.

## Model tier preference

Optional Agent `context.tier` is visible before claims in work discovery, briefings, and compact continuation. It applies to current and fresh context without changing admission or session rules. Claim options also accept `modelSelection` with optional `tier`, `provider`, and `model` fields. Declare at least one known value when supplying the object. Inspect declarations separately from measured models with `get_run_usage` and `groupBy:"attempt"`. See [model tiers](model-tiers.md).

## Renew claims

Claims follow the [duration precedence](#claim-duration-and-expiry). Renew before `leaseUntil` expires. Renewal sets the deadline to the current time plus the requested duration.

Omitting `leaseSeconds` reuses the duration established by the current claim, persisted as `claimLeaseSeconds`. Claims without that field use 300 seconds. An explicit override applies only to that renewal and can shorten the remaining lease. A new claim establishes a new duration. Expired, cancelled, or completed claims cannot be renewed.

```sh
interlock claim WORK_ID executor '{"leaseSeconds":3600}'
interlock renew WORK_ID TOKEN
interlock renew WORK_ID TOKEN '{"leaseSeconds":600}'
```

The CLI accepts options JSON or `@filename` as the third `renew` argument. MCP `renew_claim` and the shared API `work.renew` use the same optional `leaseSeconds` field.

Pass `leaseSeconds: 300` explicitly when a renewal should grant five minutes regardless of the original claim duration. An abandoned long claim takes longer to become available again.

## Find runs

MCP `list_runs` and the shared API `runs.find` return summaries in descending creation order. The default limit is 50, with a maximum of 1000. Equal timestamps use descending insertion order.

Available filters include `requestId`, `externalTask:{system,id}`, `workflowId`, `status`, `rootOnly`, `chainRootRunId`, `tags`, and `inputMatch: {path, equals}`. Optional `startRequestId`, `externalTask`, and `tags` appear in summaries and inspection. Status accepts `queued`, `running`, `waiting`, `completed`, `failed`, or `cancelled`. `rootOnly` defaults to false, which includes nested Workflow and Batch item runs. A summary includes IDs, workflow name, version, status, timestamps, cursor, input, `parentRunId`, optional `parentMode: "detached"`, `rootRunId`, `rootWorkflowId`, and `batchNodeId`. Root IDs follow the same rules as work summaries. Use `get_run` for execution details.

Paths use dot-separated object keys or array indices. A blank path selects the complete input. Equality compares JSON structure, including object values independently of key order. Missing paths do not match, even when `equals` is null. Workflow, status, and creation ordering have database indexes. Tag filters use indexed exact key/value pairs and require every supplied pair. See [tag bounds and inheritance](idempotent-run-starts.md#tag-and-filter-runs). Arbitrary input-path matching scans the selected candidates until the limit is reached.

```sh
interlock runs --workflow WORKFLOW_ID --status waiting --root-only --limit 20
interlock runs --tag repo=dgca/interlock --tag batch=factory-7
interlock runs --input-path thread_ts --equals '"1787334538.500319"' --limit 10
```

Without flags, `interlock runs` retains its full history dump. The shared `runs.list` endpoint also retains its original response.

Use `start_run.requestId` for atomic redelivery safety. External-task lookup does not reserve a task: distinct keys can create concurrent attempts. Use an atomic `onActiveExternalTask` start policy when one active task owner is required. See [start identity and retention](idempotent-run-starts.md).

## Coordinate shared Agent resources

Set Agent `resources` to up to eight existing value bindings, each resolving to a distinct bounded non-secret name. Claims reserve the complete set atomically; conflicts spend no attempt or budget and appear in `resourceBlocked` rather than available work. Resource blocking pauses the unclaimed deadline alongside budget gates and holds. Stop resource use and subprocesses before submitting success or reporting failure. Expiry, cancellation and claimed holds require explicit reconciliation if the old worker might still be active. Inspect `resourceReservations` and `next:inspect_resources`, then use `manage_work_resources` or CLI `work-resources` after confirming the exact old attempt stopped. Script, Fetch, and polling Wait nodes also accept declarations. Deterministic blockers identify executionId; inspect or release their exact owner through manage_work_resources with runId plus executionId. Resource queueing excludes operation timeout and polling deadline time. These declarations cover cooperating operations in one library. See [authoring, lifecycle and recovery](work-resources.md).

## Bind original input into later steps

Optional `inputBindings` constructs a replacement input object before the node's input contract is checked. Each output field selects a `source` and a dot-separated `path`. Omitted or blank paths select the entire source. A missing path fails unless the binding supplies a path default. Omitting `inputBindings` retains the previous node's complete output as input. An explicit empty binding object produces an empty object.

| Source      | Value                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `input`     | Previous node output before these bindings                                         |
| `runInput`  | Original input of the enclosing workflow invocation, skipping Batch item ancestors |
| `rootInput` | Original input of the outermost run                                                |
| `itemInput` | Original input of the current Batch item run, available only inside a Batch        |
| `node`      | Latest completed output of `nodeId` in the current run                             |
| `execution` | Engine-verified execution provenance of `nodeId` in the current run                |

For example, an Agent may return a proposed action while the following Script reads `dryRun` from the original workflow input:

```json
{
  "inputBindings": {
    "proposal": { "source": "input", "path": "" },
    "dryRun": { "source": "runInput", "path": "dryRun" },
    "item": { "source": "itemInput", "path": "" }
  }
}
```

The Agent's result cannot replace `runInput`, `rootInput`, or `itemInput`. Those values come from persisted run records. A referenced Workflow creates a new `runInput` scope; nested Batches retain their enclosing workflow scope. Resolved node inputs are persisted for inspection. Retries resolve bindings from the same original run inputs and the failed step's incoming value. Entry and Exit cannot use bindings.

Use `source: "node"` to retain an earlier result across intervening steps, such as a child workflow that returns only a posting receipt:

```json
{
  "inputBindings": {
    "decision": { "source": "node", "nodeId": "triage", "path": "" },
    "posted": { "source": "input", "path": "posted" },
    "dryRun": { "source": "runInput", "path": "dryRun" }
  }
}
```

Node bindings read persisted executions of the current run. Inside a Batch, they read only the current item's executions, including inside nested Batches. Unlike `runInput`, they do not walk up to the enclosing workflow. A parent cannot address nodes inside a referenced workflow, and sibling items cannot read each other's results. Publication requires an existing node in the same Batch group or main workflow scope, excluding Entry and Exit. Drafts may retain unresolved references.

In a workflow loop, the latest completed visit wins. Failed, cancelled, waiting, and running executions are ignored. Retries resolve from the same persisted execution history and incoming value. Resolved inputs remain visible in execution history.

To initialize a loop counter, bind the `count` input of a step with ID `count` to its own previous output. Have the step return the incremented count in its `count` output field.

```json
{
  "inputBindings": {
    "count": {
      "source": "node",
      "nodeId": "count",
      "path": "count",
      "sourceDefault": 0
    }
  }
}
```

The first visit receives `{"count": 0}`. Later visits read `count` from the last completed output. The same setting covers a source skipped by a branch. To supply a fallback for a missing field in a completed output, set `default` separately.

### Execution provenance and loop visitCount

Workflows implementing review gates, model verification, or repair loops can count loop visits directly and inspect execution metadata without relying on agent-reported outputs:

- **Direct loop counting**: Use `source: "execution"` with `path: "visitCount"` to obtain the 1-based completed execution count of `nodeId` in the current run and Batch scope. Alternatively, configure a Branch condition or Switch path directly as `execution.<nodeId>.visitCount` (evaluating to `0` before the node completes its first execution).
- **Model verification gates**: Inspect `execution.<nodeId>.actualModel` or `execution.<nodeId>.provider` to ensure high-assurance tasks were executed by an authorized model before allowing downstream deployment branches.
- **Anti-spoofing**: Provenance is recorded directly by the engine and executor manager upon node completion. Fields like `profileId`, `harness`, `sessionId`, `requestedModel`, `actualModel`, `provider`, `effort`, `attempt`, `visitCount`, and `usage` cannot be spoofed or overwritten by worker outputs.
- **Script provenance file**: Script steps have access to prior node execution records through `INTERLOCK_EXECUTION_PROVENANCE_FILE`, containing `{ [nodeId]: { visitCount, latest, history } }`.

In node settings, the **Input** section groups data selection and validation. **Source** defaults to **Previous step output**. Select **Choose fields** to reveal the field editor. Opening settings or choosing this mode alone leaves input unchanged. **Expected format** edits the input contract, which validates the selected data before execution. **Add input field** adds a named field with **Previous step output** selected by default. Choose **Node output** to select a node by its label and ID in the same execution scope. **Default if no completed output** sets `sourceDefault` for the selected node. **Original Batch item** is available inside Batch item paths. Paths select nested fields or array indices. A blank path selects the whole value.

When a node has no explicit input contract, the editor suggests a shape from its incoming output contract. It can also describe the object built by input bindings. The suggestion supplies field paths in Condition, Switch, Wait, Batch, Fetch, and binding settings, and guides new Switch case values. You can still type any path. **Use as expected format** copies the suggested shape into the node's input contract if you want runtime validation. The editor does not save inferred contracts automatically. If incoming routes disagree or an incoming source has no declared shape, it does not guess a single incoming shape. Binding fields with unknown sources remain `any`. A timeout route from an Agent carries that Agent's input, not its normal output.

Nodes with node-output bindings show a **Reads from [label]** indicator for each distinct source. In the workflow editor, clicking an indicator selects and focuses that source. Unavailable references remain visible in drafts and block publication until fixed. Renaming a node updates the indicator without changing its stored ID.

**Advanced JSON**, Raw, CLI import, and MCP accept the same bindings. An explicit `{}` supplies an empty input object. Remove the last field or set **Source** to **Previous step output** to remove bindings and restore normal input flow. Scripts still have the service's OS permissions; input bindings are a data-flow contract, not script sandboxing.

## Export and import portable bundles

Use `read_variables` for bounded metadata and dependencies and `manage_variables`
for revision-protected management. Fetch header references and Script environment
entries, including polling checks, pin protected revisions at run startup. Values
are never added implicitly to Agent assignments. Secret read-back is unavailable;
prefer the local UI or CLI stdin for entry. See [workflow variables](variables.md).

For formats 4 through 10, supply a `variableBindings` entry for every required ID, with
`{action:"bind",variableId:"LOCAL_ID"}` or `{action:"provision",name:"local_name"}`.
Bindings are instance-wide and same-kind; name matching never attaches credentials.
Provisioning creates an unset value. Missing values block runs. Imports cannot
redirect existing bindings or rewrite published definitions. After provisioning
and setting a value, a later import must explicitly select that existing local
value. CLI import accepts the same choices through `--variable-bindings json|@file`.

`interlock export WORKFLOW_ID`, MCP `export_workflow`, and the library and Workflow settings export the same `interlock-workflows` bundle. The highest required format wins: authored alias identities use format 10, exact published prompt snapshots use format 9, lifecycle-event configuration uses format 8, model-alias requirements use format 6, schedule configuration uses format 5, variable requirements use format 4, deleted-version identities use format 3, saved prompts use format 2, and other bundles use format 1. Older readers reject unsupported newer formats. Workflow settings includes local draft edits without saving them.

A bundle contains the root workflow, its owned children, owners, and transitive dependencies from drafts and retained published versions. Event triggers with workflow scope also include their referenced source workflows. Each record includes stable identity, metadata, ownership, draft, source draft revision and retained published definitions with their original numbers. Formats 3 through 10 can include `deletedVersions` identity hashes. Formats 2 through 10 can include current saved prompt records. Formats 4 through 10 carry safe required-variable metadata, never Config or Secret values, and require deliberate `variableBindings` on import. Format 5 and later can include schedule configuration with `enabled:false`, without fire history or activation/failure state. Format 6 and later can include model-alias requirements without local candidate overrides. Format 8 adds `eventTriggers` configuration with `enabled:false` and source workflow dependencies, without event payloads, delivery logs, dedupe receipts or causal chains. Missing referenced workflows or prompts block export. Format 10 adds an optional alias `reference` for authored identities that differ from the portable name. Imports retain requirements; configure a matching local alias name before starting. Format 9 adds `promptRevisions`, a deduplicated pool of exact snapshots required by retained published pins. Runs, claim tokens, archive flags, unrelated prompt history and historical run captures are excluded. Exporting an owned child includes its owner and siblings to preserve ownership.

```sh
interlock export WORKFLOW_ID > workflow.json
interlock import @workflow.json
```

Import creates missing workflows with their bundle IDs and imports their exact published pins in one transaction. Identical workflow definitions remain unchanged. Every included schedule or event trigger is disabled, including identical or forced reimports. Its revision advances, and automatic pause and consecutive failures clear. Schedules also reset their next slot, interval anchor, and last measured lag at import time. Event imports reset visible delivery history, pending events and last-dispatch links while retaining durable event dedupe receipts. Schedule history, schedule prior-run links, existing runs, archive flags, and published versions remain intact. Triggers absent from the bundle remain unchanged. Inspect with `read_workflow_triggers` before explicitly enabling an imported trigger. See [event trigger selection and teardown](events.md). Legacy single-definition import documents still create a new workflow each time. MCP `create_workflow` also retains creation semantics; use `import_workflows` for bundles.

To replace an existing draft, inspect the target with `get_workflow`, then pass `draftRevisions` keyed by target workflow ID to `import_workflows`. CLI `--revisions` accepts that JSON map. Source draft revisions in the bundle are informational; each engine has its own revision sequence.

```sh
interlock import @workflow.json --revisions '{"WORKFLOW_ID":3}'
interlock import @workflow.json --force
```

`force` allows draft and metadata replacement. It cannot change ownership, overwrite an existing published version with different content, or replace divergent shared prompt content. If the two engines independently published different definitions under the same ID and version, import rejects the entire bundle. Resolve that divergence explicitly before deploying. Any invalid graph, missing workflow or prompt dependency, stale draft, prompt conflict, or version conflict rolls back all bundle changes. Existing identical current prompt content reuses the local ID and revision; different current content under that ID rejects import, even with `force`. Pinned snapshots retain their exact historical IDs and revisions independently of the current prompt. Conflicting historical content or unavailable pins roll back the import. Older bundle formats remain accepted when their pins are supplied by current snapshots or retained local history. Resolve it through an explicit prompt edit before importing. Names are never used to match or merge prompt identities. Imported drafts can remain incomplete; imported published versions must pass publication validation.

UI import accepts local bundles and legacy files, or direct JSON files discovered from a public GitHub folder URL. GitHub discovery pins the branch or commit to a commit SHA and displays one choice per bundle root with its dependencies. `workflows.discoverGithub` reads and validates files without changing library data. `workflows.importGithub` re-fetches the selected direct files at that SHA and imports the entire selection atomically with no draft replacement options. A late conflict rejects all selected workflows and prompts. GitHub import never starts runs. Existing CLI and MCP bundle import remains a separate operation with its explicit replacement options. Replacements that need a revision map or `force` use CLI or MCP. The shared API exposes `workflows.export`, `workflows.exportDraft` for unsaved editor content, and `workflows.import`.

GitHub metadata uses the public API; file contents use raw GitHub URLs at the pinned commit. The discovery and selection input/output contracts are unchanged. A `workflows.importGithub` server rejection starts with `Nothing imported:` and confirms that the selected set made no changes. If the response is lost without that confirmation, inspect the library before retrying, especially for legacy imports that create new workflows. A UI refresh error after a successful import does not roll back the operation. These GitHub operations are separate from CLI and MCP bundle import; their existing revision and force controls are unchanged.

## Change workflow ownership

Use `preview_workflow_ownership` with an existing `id` and proposed `ownerWorkflowId`. Set the proposed owner to a library workflow ID for adoption or reparenting, or explicit `null` to release a child to the library. The shared API operations are `workflows.previewOwnership` and `workflows.setOwner`. UI move controls and CLI move commands are not provided.

Preview returns `id`, `name`, `currentOwnerWorkflowId`, proposed `ownerWorkflowId`, `unchanged`, `canSetOwner`, and `blockers`. Each blocker includes `kind`, `workflowId`, `name` and `reason`; references also include `nodeId`, `nodeLabel`, and either `draft: true` or `version` with `latest`. All drafts and retained published versions are checked, including archived callers, unresolved draft pins, self-references and Workflow nodes inside Batch. Only the proposed owner may reference an owned child.

A new owner must be an unarchived library workflow different from the target. A workflow with children cannot itself become a child. Archived targets retain their archive flag. Setting the existing owner is a no-op, including an archived existing parent. Release to the library permits future reuse by other callers.

If the preview permits the move, call `set_workflow_owner` with the same target/proposed owner and `expectedOwnerWorkflowId` from that preview. Explicit null is required when the current workflow is in the library. For example:

```json
{
  "id": "CHILD_ID",
  "ownerWorkflowId": "PARENT_ID",
  "expectedOwnerWorkflowId": null
}
```

The mutation rechecks the expected owner and current reference rules inside one transaction. Stale ownership or new blockers reject without changes; preview again before retrying. The response contains `applied` and the workflow record. Effective moves update only `ownerWorkflowId` and `updatedAt`; no-op preserves the timestamp. IDs, drafts, revisions, version numbers, cleanup identities, run history, work, events, and execution ancestry are preserved. Ownership changes do not publish or execute workflows.

Remove foreign current references through draft editing and publication. Historical references remain blockers until the person explicitly selects obsolete caller versions for [version cleanup](version-cleanup.md), including its history-loss acknowledgment. Ownership changes never delete or rewrite those callers. Restoring a deleted foreign caller after adoption fails the usual ownership checks, even when its definition is original.

Export carries the resulting ownership and includes owners/children as usual. Fresh import preserves it. Generic updates, Raw definitions, and imports cannot change an existing workflow's ownership; `force` does not bypass that restriction. Use the dedicated move operation on the destination library when needed.

## Archive, restore, or delete

MCP `update_workflow` accepts `archived: true` or `false`. CLI provides `archive ID` and `restore ID`. Archive retains history and does not cancel active runs. New direct starts require an active workflow and owner; accepted keyed replays can inspect retained runs after archive. Minimal start receipts remain after deletion to prevent old requests from recreating work; existing published invocations retain their pins.

`list_workflows` includes archived workflows by default. Pass `includeArchived: false` to hide archived workflows and children of archived owners. The owner filter remains independent.

MCP `delete_workflow` and `interlock delete ID --yes` permanently remove the workflow and its published versions, every run of that workflow, and all descendants of those runs. Descendants include Batch item runs and waited or detached Workflow runs, even when they execute another workflow. Their assignments and events are removed too; other workflow records and published versions remain.

If a run of the workflow has a parent run from another workflow, deletion is blocked. This includes invocation directly, inside a Batch, or in detached mode. Nothing is removed: ancestor runs, child runs, assignments, and events remain intact. External draft or published references, owned children, and active affected runs also block deletion, including active detached descendants of completed parents. Archive is available when references or run ancestry prevent deletion.

Reference errors identify every blocking workflow by name and ID, list the referencing draft and published version numbers, and state when the latest version does not reference the target. Retained historical versions still block deletion after the draft and latest stop using the target. [Explicit version cleanup](version-cleanup.md) can remove obsolete caller versions after informed agreement. Published references cannot be edited; archive the target when you want to preserve definitions and history. Owned children follow the same reference rules.

## Dispatch independent workflows

Set a Workflow node to `mode: "detached"` to start its pinned workflow and continue with `{runId, workflowId, version}`. Omit mode or use `wait` to await its result. Input validation precedes dispatch; later child failure does not change the launching step. See [Workflow execution](workflow-execution.md) for the fixed output contract and lifecycle.

`list_work` includes detached descendants, even when their parent is terminal. Root IDs describe ancestry. To operate independent work, use its own run ID. `list_runs` with `rootOnly: true` excludes detached runs, so omit that filter when finding active independent work. Ordinary `cancel_run` stops at detached relationships. Use the read-only `preview_run_cancellation` and then `cancel_run_tree` with `includeDetached: true` and a reason to cancel the selected tree, including independent descendants. See [tree cancellation and stop reconciliation](workflow-execution.md#cancel-a-run-tree). Retry failed detached runs directly; retrying a later parent step does not duplicate dispatches.

## Context continuity

Agent definitions can set `context.continuityGroup` with current context. Grouped assignment summaries, full assignments, briefings, and compact mutation `nextWork` items expose `continuity`: the run-local group, revision, expected executor/session identity (or null before first claim), and optional checkpoint reference. `claim_work` accepts `session: {executorId, sessionId}`; grouped claims require it. `renew_claim`, `submit_result`, and `fail_work` retain their token-based contracts. Failure, expiry, and `retry_run` preserve the group binding.

Use `get_context_group` for bounded claim/handoff history and `handoff_context_group` for revision-checked replacement. CLI equivalents are `context-group` and `handoff-context`; shared API operations are `runs.contextGroup` and `runs.handoffContext`. Workflow authoring, edits, and imports preserve the optional field; publication rejects fresh context combined with a group. Ungrouped definitions and responses retain their existing behavior. See [context continuity](context-continuity.md) for complete scope, bounds, and examples.

Agent executors can [check candidate results before submission](result-preflight.md) without renewing claims or advancing runs. Submission rechecks live state and returns bounded correction diagnostics when a result is rejected.

[Assignment size diagnostics](assignment-size.md) show UTF-8 byte contributions and advisory warnings before claims. Agent previews accept sample inputs and upstream outputs, with unresolved values marked unknown. Payload values are omitted from reports.

Use [fixture simulation](workflow-simulation.md) to check contracts and routes before spending model tokens on supported flat graphs. `workflow_simulation` groups run/get/list/capture/cancel actions. Simulation results are separate evidence from live runs and do not assess prompt or implementation quality.

## Resume externally blocked assignments

[External holds](work-holds.md) suspend one Agent assignment without consuming its failure or expiry allowance. Held work is absent from `list_work`. Briefings expose a bounded `held` list with work/run/lifecycle IDs, category, server timestamp, attempt and hold revision; `blockers` use `external_hold`. Reasons, checkpoints, payloads and claim tokens are omitted. When holds need attention, `next` is `inspect_hold`. Available work, budget gates and active claims can take precedence.

Compact mutation responses add `heldWork` only when needed. Their existing `nextCall` suggests a briefing for `inspect_hold`. Full inspection includes current blocker details and up to twenty recent historical intervals per affected assignment. Use `manage_work_hold` with `action:history` for older intervals, default twenty and maximum one hundred per page. Holds on detached runs retain their independent lifecycle IDs.

## Continue recurring work as new

A standalone workflow can opt into [continue as new](continue-as-new.md) on Exit with `continueAsNew:{maxRuns:100}`. The Exit checkpoint must match workflow inputSchema. Successors inherit the predecessor's current version, policy, and prompt capture, with fresh step history and run-local input/session scopes. Pinned chains retain their original version by default. All budget scopes count the chain; a later policy cannot reset earlier consumption.

Briefings and compact mutations include chain links. On `next:continue_as_new`, follow `nextCall` to `chain.nextRunId` instead of treating the completed predecessor as a final result. Its Exit execution stores the checkpoint; final run output is available only from a normal Exit. Existing briefings and finite waits remain scoped to one run and its children.

Use `list_runs` with `chainRootRunId` for bounded discovery, `get_run` for latest chain state, `get_run_usage` with `includeChain:true` for chain usage, and `cancel_run` with `scope:"chain"` to stop it from any member. Default `cancel_run` cancellation remains per run. Detached descendants keep running independently. For explicit whole-tree cancellation, `preview_run_cancellation` and `cancel_run_tree` follow forward chain links and can include detached descendants.

## Manage local executors

Optional workflow `executor` selects a local profile reference. Agent `executor` overrides it, `null` keeps connected-agent execution, and omission inherits the workflow. Optional workflow `agentPermissions` overrides managed harness defaults with `read-only`, `standard` or `full-access`; omission inherits each selected profile. The captured override is exposed as `executorPermissions` on managed work. Existing definitions remain connected by default. Use `manage_executors` for bounded discovery, revision-checked saves and exact execution inspection. Pending native permission/questions and interruption recovery appear as `next:inspect_executor`, with a read-only `nextCall`. Human answers and stop confirmations must be explicit. See [operations and limits](managed-executors.md).

Library/workflow pauses use `manage_pause` for bounded discovery, independent creation and exact-ID release. Paused assignments are excluded from work lists and compact next work. Inspect `waiting.kind:pause` and use `workflowId` with the pause list to see all applicable records. Already claimed work can renew and submit; subsequent boundaries stay paused. Input submissions/revisions remain accepted, while acceptance waits. See [pause operations](work-holds.md).

## Inspect queued starts

Workflow `maxActiveRuns` and `excludeStages` control admission. `start_run` also accepts `priority`, `after`, and `onActiveExternalTask`. A successful response can have `runStatus:"queued"`, no assignments, and `waiting.kind:"admission_queue"` with position, priority, and blockers. Resume that run with a briefing or change wait. Failed or cancelled dependencies keep it queued until you cancel it and choose a new attempt. `list_runs` accepts `status:"queued"`; `cancel_run` stops waiting starts. See [start admission and task policy](idempotent-run-starts.md).
