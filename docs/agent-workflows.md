# Author and operate workflows

## Manage run budgets

Optional [run budgets](run-budgets.md) stop new Agent claims when limits are reached. Use `get_run_budget` to inspect policy and usage, and `set_run_budget` for an authorized adjustment. `next:adjust_budget` and budget blockers identify recoverable gates; already claimed work can finish. Keep detached scope and incomplete-report policy explicit.

## Report usage

For executor-supplied or observer-supplied token counts and costs, use `report_usage` and `get_run_usage`. [Usage reporting](usage-reporting.md) defines cumulative snapshots, attempt identity, delayed reports, descendant scope, and coverage. A successful assignment does not imply complete usage data.

## Compare published workflow behavior

Use the [workflow testbench](workflow-testbench.md) to save representative cases, preview exact run counts/pins/current prompt revisions, and execute paired published versions. Resume a comparison through its ID and existing work claims; reuse the same start request ID after uncertain delivery. Keep execution errors, pass/fail/unknown checks and declared quality judgments distinct. Reports are bounded and link ordinary run inspection. Comparison cancellation preserves detached independence unless explicitly selected otherwise. In-flight comparison pins block cleanup/deletion; portable bundles exclude local cases and comparison records.

## Claim duration and expiry

Agent nodes can set `leaseSeconds` to a whole number from 10 through 3600. A claim uses the caller's explicit `leaseSeconds`, otherwise the node setting from the run's published version, otherwise 300 seconds. For example, an Agent with `"leaseSeconds": 1800` gives workers a 30-minute claim when they omit an override. Longer leases delay recovery when a worker disappears.

`list_work` and continuation summaries include the optional configured `leaseSeconds`. `claim_work` returns the effective `claimLeaseSeconds` and ISO `leaseUntil`. Renew before that deadline. Omitting `leaseSeconds` from `renew_claim` reuses the original effective duration; an explicit renewal override applies only once. Claims without `claimLeaseSeconds` use 300 seconds for omitted renewals. Renewal does not impose a total execution deadline.

Each expired claim records `work.lease_expired` with its assignment ID, deadline, counts, and recovery guidance. By default, reported failures and expiries share `maxAttempts`. To separate them, set Agent `maxLeaseExpiries` to an integer from 1 through 10, or enable **Separate lease expiry budget** in Agent settings. With that setting, `maxAttempts` limits explicit failures and `maxLeaseExpiries` limits expiries. Reaching either count fails the run. For example, `maxAttempts: 2, maxLeaseExpiries: 3` permits recovery after two expiries but fails on the third, or on the second explicit failure.

`attempt` counts successful claims and never decreases. Claims released by an external hold increment optional `heldClaimCount`; subtract that count when interpreting the legacy combined failure/expiry allowance. Run claim budgets still count every successful claim. Separate-policy assignments expose `failureCount`, `leaseExpiryCount`, and `maxLeaseExpiries` in claims, discovery, and continuation summaries. Policy and counters persist across restarts. Policy comes from the run's published definition; editing a draft does not change active work. An unclaimed timeout remains a separate deadline to pick up work.

Expired tokens cannot renew or submit results. Recognized expired-token errors distinguish an available assignment, a later claim, terminal work, and exhausted budgets. When the assignment is available, call `claim_work` with your actual context and capabilities, then use its new token. Availability can change before that call. Preserve code and evidence saved outside Interlock, and check whether the assignment and result are still applicable before resubmitting. Reclaiming does not make repeated external side effects safe. Inspect the run before explicitly retrying an exhausted failed step. Unknown tokens and tokens whose expiry history was not recorded return an invalid-token error.

## Request compact authoring responses

Pass `detail: "summary"` to `create_workflow`, `update_workflow`, and `publish_workflow` to receive `ok`, `id`, `draftRevision`, `latestVersion`, `draftMatchesLatest`, and `archived` without the definition. Use the returned revision for the next edit. `draftMatchesLatest` is null before first publication. Publication returns the committed version number; cascade summaries describe the requested workflow. Archive and restore use `update_workflow.archived` with the same detail option.

Omitting `detail`, or passing `full`, returns the full workflow record and draft. Use `get_workflow` when you need the current definition. Imports already return compact IDs, revisions, and change lists. The shared API exposes `workflows.createSummary`, `updateSummary`, and `publishSummary`; the full operations keep their response shapes.

HTTP and stdio tool discovery includes object-root output schemas for these authoring mutations, `edit_workflow`, `claim_work`, `start_run`, `submit_result`, and `list_work`. A client may omit schemas in its own display; inspect raw `tools/list` when diagnosing discovery.

## Discover schemas and assignments

MCP `create_workflow.definition` and `update_workflow.draft` expose the workflow object schema, including node fields and edge handles. Incomplete routes remain saveable drafts. Publication validates graph routes and pinned dependencies. For small changes, `edit_workflow` avoids resending the full graph. `validate_workflow` reports read-only diagnostics for the stored draft or a candidate.

Script and Fetch support `onFailure: "route"` with `default` and `failed` edges through these same tools. Failed receives the fixed `{input,error,output}` contract described in [failure routes](failure-routes.md). The operation stays failed while its run continues. Earlier-node bindings select completed outputs only; read the incoming envelope for recovery. Removing the policy through MCP requires explicitly removing its edge. No automatic retry is added, and completed recovery runs cannot be retried.

`start_run.input` and `submit_result.output` accept any JSON value matching the workflow or assignment contract, including objects, arrays, scalars, and null. Pass structured values directly. JSON-looking strings remain strings and are never implicitly parsed.

Agent `context.mode` accepts `current` or `fresh`. An executor satisfies `fresh` with a new session or an isolated subagent without inherited conversation history. `isolated` is not a mode value. Declare only tools, skills, and isolation that the executor provides.

`list_work` defaults to `fields: "summary"` for discovery. Summaries include assignment ID, run ID, node ID, label, status, context requirements, attempt counts, optional configured `leaseSeconds`, and any unclaimed deadline.

Work summaries also include `workflowId`, optional `parentRunId`, optional `parentMode: "detached"`, `rootRunId`, and `rootWorkflowId`. `workflowId` identifies the immediate run's workflow. `rootWorkflowId` identifies the outermost workflow so a dispatcher can select an executor without fetching run history. Root runs omit `parentRunId` and use their own run and workflow IDs as root IDs. Ancestry follows execution, independently of workflow ownership.

Work summaries omit prompts, inputs, output schemas, and execution instructions. `claim_work` returns the complete assignment. Use `fields: "full"` to inspect complete assignments before claiming. CLI callers can use `interlock work RUN_ID --summary`. The shared API exposes `work.summaries` and `work.list`.

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

`get_run` provides full inspection of an existing run. Do not repeat `start_run` to inspect it: that creates another run. `get_run_result` reads selected values. The shared API exposes `runs.startSummary` and `work.submitSummary`, accepting the corresponding mutation arguments and optional `limit`. These return runtime summaries; MCP adds `nextCall`. `runs.start`, `work.submit`, UI, and CLI return full responses. `start_run`, `submit_result`, and `list_work` advertise output field schemas over both MCP transports; mode-specific required fields are listed above. `fail_work`, `retry_run`, and `cancel_run` return full inspection.

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

For new graphs or structural changes, add top-level `layout: "tidy"` to `create_workflow`, `update_workflow`, or `edit_workflow`. It applies the editor's Dagre layout in the same save. Omit it to preserve positions, especially for text-only edits. Updates require the current `draftRevision`, including layout-only updates without a replacement draft. Edit responses include moved nodes in `changes`; unchanged edits and layout preserve the revision. See [authoring layout](authoring-layout.md) for shared API and CLI examples.

| Operation         | Fields                                 | Behavior                                                                                       |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `add_node`        | `node`                                 | Add a definition-format node with a new ID. Added scripts default to `language: "javascript"`. |
| `update_node`     | `id`, optional `set`, optional `unset` | Shallowly replace named fields and remove named fields. ID and kind cannot change.             |
| `remove_node`     | `id`                                   | Remove the node, all nested Batch members, and incident edges.                                 |
| `add_edge`        | `edge`                                 | Add a definition-format edge with a new ID. Omitted port defaults to `default`.                |
| `update_edge`     | `id`, optional `set`, optional `unset` | Replace or remove named edge fields. ID cannot change.                                         |
| `remove_edge`     | `id`                                   | Remove one edge.                                                                               |
| `update_settings` | optional `set`, optional `unset`       | Edit `inputSchema`, `outputSchema`, or `maxSteps`.                                             |

`set` replaces the entire named field, including nested objects such as `context` or `inputBindings`. `unset` is an array of field names. A field cannot appear in both. Unsetting a required field fails unless the definition schema supplies a default. Unsetting an absent field also fails. Unknown operation, node, edge, or settings fields fail instead of disappearing. JSON Schema contract contents remain unrestricted. Existing scripts with omitted language retain Bash; explicitly unsetting language restores legacy Bash behavior. Defaulted fields, such as maxSteps, reset to their schema default when unset.

Removing a node preserves bindings in surviving nodes. Those bindings become publication blockers until explicitly repaired. Removing or renaming a source port preserves its edges, so reconnect or remove them in the same edit list, or save and repair the incomplete draft later. Batch membership remains explicit through `batchId`; existing publication scope checks apply. Workflow ownership is not editable through draft edits; use the [dedicated ownership operation](#change-workflow-ownership). Saved references still obey owned-child rules.

The result contains `applied`, `draftRevision`, `changes`, and `diagnostics`. `changes.nodes` and `changes.edges` each contain added, updated, and removed IDs; `changes.settings` lists changed fields. Effective changes increment the draft revision once. Empty or equivalent edits preserve both revision and timestamp. Equality ignores object key order. Rejected edits return `applied: false`, the current revision, empty changes, and diagnostics. Invalid edits identify their zero-based `operationIndex`. A stale revision has code `stale_revision`; reload before retrying.

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

| Field                       | Meaning                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                       | Requested identity, workflow/version, status, ancestry, current execution ID, and result reference. No input, output, or definition.                                                                                                                                                                                        |
| `progress.requested`        | Run status counts for the requested run and ordinary descendants, excluding detached trees.                                                                                                                                                                                                                                 |
| `progress.independent`      | Run status counts across detached trees within the requested ancestry.                                                                                                                                                                                                                                                      |
| `progress.executions`       | Execution-visit status counts in the requested lifecycle, including earlier attempts and loop visits.                                                                                                                                                                                                                       |
| `descendants`, `detached`   | Run summaries and detached boundary references. `lifecycleRunId` is the requested ID for ordinary descendants, and the nearest detached ancestor's ID for independent trees. A directly detached run identifies itself.                                                                                                     |
| `available`, `claimed`      | Assignment identity, execution reference, ancestry, lifecycle, context mode, tool/skill requirements, attempts, worker, and applicable deadline. Prompts, instructions, schemas, inputs, outputs, and tokens are omitted.                                                                                                   |
| `held`                      | Compact work/run/lifecycle references, category, heldAt, attempt and holdRevision for externally held assignments; reasons and checkpoint contents are omitted.                                                                                                                                                             |
| `blockers`                  | `external_hold`, `budget_blocked`, `available_work`, `claimed_work`, `wait`, `children`, `executing`, or `failure`, with run/execution/work references. Wait blockers include `resumeAt`; polling also includes `nextCheckAt`, optional `timeoutAt`, and `check` metadata (`count`, `at`, optional `error`) without output. |
| `failures`                  | Currently failed run references and errors. Collected Batch item failures can appear while their parent remains waiting or completes.                                                                                                                                                                                       |
| `batches`                   | Per-execution total, dispatched and queued item counts, plus dispatched item status counts. Terminal status distinguishes undispatched items from work still pending.                                                                                                                                                       |
| `deadlines`, `nextDeadline` | Sorted active deadlines: `wait` for duration/timestamp Waits, `poll_check` for the next probe, `poll_timeout` for the polling deadline, `unclaimed`, and `claim_lease`. Earliest deadline or null.                                                                                                                          |
| `recentResults`             | Recent completed execution references, labels, kinds, selected ports, timestamps, and output availability. No result values.                                                                                                                                                                                                |
| `next`                      | Suggested action: `claim_work`, `adjust_budget`, `inspect_hold`, `wait_for_worker`, `wait_for_change`, `inspect_failure`, or `inspect_result`. Inspect requested status and lifecycle IDs before acting on independent work.                                                                                                |
| `cursor`, `revision`        | Continuation cursor and monotonically increasing scoped revision. These differ from the graph-node `cursor` inside `run`.                                                                                                                                                                                                   |

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

Available filters are `workflowId`, `status`, `rootOnly`, and `inputMatch: {path, equals}`. Status accepts `running`, `waiting`, `completed`, `failed`, or `cancelled`. `rootOnly` defaults to false, which includes nested Workflow and Batch item runs. A summary includes IDs, workflow name, version, status, timestamps, cursor, input, `parentRunId`, optional `parentMode: "detached"`, `rootRunId`, `rootWorkflowId`, and `batchNodeId`. Root IDs follow the same rules as work summaries. Use `get_run` for execution details.

Paths use dot-separated object keys or array indices. A blank path selects the complete input. Equality compares JSON structure, including object values independently of key order. Missing paths do not match, even when `equals` is null. Workflow, status, and creation ordering have database indexes. Arbitrary input-path matching scans the selected candidates until the limit is reached.

```sh
interlock runs --workflow WORKFLOW_ID --status waiting --root-only --limit 20
interlock runs --input-path thread_ts --equals '"1787334538.500319"' --limit 10
```

Without flags, `interlock runs` retains its full history dump. The shared `runs.list` endpoint also retains its original response.

Listing before starting a run is not atomic deduplication. A dispatcher that requires one active run per key must serialize starts or maintain its own atomic reservation.

## Bind original input into later steps

Optional `inputBindings` constructs a replacement input object before the node's input contract is checked. Each output field selects a `source` and a dot-separated `path`. Omitted or blank paths select the entire source. Missing paths fail that node. Omitting `inputBindings` retains the previous node's complete output as input. An explicit empty binding object produces an empty object.

| Source      | Value                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `input`     | Previous node output before these bindings                                         |
| `runInput`  | Original input of the enclosing workflow invocation, skipping Batch item ancestors |
| `rootInput` | Original input of the outermost run                                                |
| `itemInput` | Original input of the current Batch item run, available only inside a Batch        |
| `node`      | Latest completed output of `nodeId` in the current run                             |

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

In a workflow loop, the latest completed visit wins. Failed, cancelled, waiting, and running executions are ignored. If no completed visit exists, or its output lacks the selected path, the consuming node fails. JSON `null` is a valid completed output. Retries resolve from the same persisted execution history and incoming value. Resolved inputs remain visible in execution history.

In node settings, the **Input** section groups data selection and validation. **Source** defaults to **Previous step output**. Select **Choose fields** to reveal the field editor. Opening settings or choosing this mode alone leaves input unchanged. **Expected format** edits the input contract, which validates the selected data before execution. **Add input field** adds a named field with **Previous step output** selected by default. Choose **Node output** to select a node by its label and ID in the same execution scope. **Original Batch item** is available inside Batch item paths. Paths select nested fields or array indices; blank selects the whole value.

When a node has no explicit input contract, the editor suggests a shape from its incoming output contract. It can also describe the object built by input bindings. The suggestion supplies field paths in Condition, Switch, Wait, Batch, Fetch, and binding settings, and guides new Switch case values. You can still type any path. **Use as expected format** copies the suggested shape into the node's input contract if you want runtime validation. The editor does not save inferred contracts automatically. If incoming routes disagree or an incoming source has no declared shape, it does not guess a single incoming shape. Binding fields with unknown sources remain `any`. A timeout route from an Agent carries that Agent's input, not its normal output.

Nodes with node-output bindings show a **Reads from [label]** indicator for each distinct source. In the workflow editor, clicking an indicator selects and focuses that source. Unavailable references remain visible in drafts and block publication until fixed. Renaming a node updates the indicator without changing its stored ID.

**Advanced JSON**, Raw, CLI import, and MCP accept the same bindings. An explicit `{}` supplies an empty input object. Remove the last field or set **Source** to **Previous step output** to remove bindings and restore normal input flow. Scripts still have the service's OS permissions; input bindings are a data-flow contract, not script sandboxing.

## Export and import portable bundles

`interlock export WORKFLOW_ID` and MCP `export_workflow` export an `interlock-workflows` bundle with `formatVersion: 1` when no saved prompts are referenced, or `formatVersion: 2` when prompts are included. Exports with deleted-version identity hashes use `formatVersion: 3`, with prompts when needed. Older readers reject format 3. Prompt-bearing bundles require an Interlock version with Prompts support; earlier readers reject version 2. The library and Workflow settings export the same bundle format. Workflow settings includes local draft edits without saving them.

A bundle contains the root workflow, its owned children, owners, and transitive dependencies from drafts and retained published versions. Each record includes a stable ID, name, description, ownership, draft, source draft revision, and retained published versions with original numbers, which may have gaps. Format-3 records also include `deletedVersions` with version numbers, definition hashes, and deletion timestamps. Missing referenced workflows or saved prompts block export. Prompt-bearing format-2 and format-3 bundles include one current prompt record per referenced ID, with name, description, revision, and Markdown content. References in all exported drafts and published versions are included. Prompt revision history and historical run captures are excluded. Runs, claim tokens, and archive flags are excluded. Exporting an owned child includes its owner and siblings to preserve ownership.

```sh
interlock export WORKFLOW_ID > workflow.json
interlock import @workflow.json
```

Import creates missing workflows with their bundle IDs and imports their exact published pins in one transaction. Reimporting an identical bundle is a no-op. Existing archive flags, runs, and published versions remain intact. Legacy single-definition import documents still create a new workflow each time. MCP `create_workflow` also retains creation semantics; use `import_workflows` for bundles.

To replace an existing draft, inspect the target with `get_workflow`, then pass `draftRevisions` keyed by target workflow ID to `import_workflows`. CLI `--revisions` accepts that JSON map. Source draft revisions in the bundle are informational; each engine has its own revision sequence.

```sh
interlock import @workflow.json --revisions '{"WORKFLOW_ID":3}'
interlock import @workflow.json --force
```

`force` allows draft and metadata replacement. It cannot change ownership, overwrite an existing published version with different content, or replace divergent shared prompt content. If the two engines independently published different definitions under the same ID and version, import rejects the entire bundle. Resolve that divergence explicitly before deploying. Any invalid graph, missing workflow or prompt dependency, stale draft, prompt conflict, or version conflict rolls back all bundle changes. Existing identical prompt content reuses the local ID and revision; different content under that ID rejects import, even with `force`. Resolve it through an explicit prompt edit before importing. Names are never used to match or merge prompt identities. Imported drafts can remain incomplete; imported published versions must pass publication validation.

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

MCP `update_workflow` accepts `archived: true` or `false`. CLI provides `archive ID` and `restore ID`. Archive retains history and does not cancel active runs. New direct starts require an active workflow and owner; existing published invocations retain their pins.

`list_workflows` includes archived workflows by default. Pass `includeArchived: false` to hide archived workflows and children of archived owners. The owner filter remains independent.

MCP `delete_workflow` and `interlock delete ID --yes` permanently remove the workflow and its published versions, every run of that workflow, and all descendants of those runs. Descendants include Batch item runs and waited or detached Workflow runs, even when they execute another workflow. Their assignments and events are removed too; other workflow records and published versions remain.

If a run of the workflow has a parent run from another workflow, deletion is blocked. This includes invocation directly, inside a Batch, or in detached mode. Nothing is removed: ancestor runs, child runs, assignments, and events remain intact. External draft or published references, owned children, and active affected runs also block deletion, including active detached descendants of completed parents. Archive is available when references or run ancestry prevent deletion.

Reference errors identify every blocking workflow by name and ID, list the referencing draft and published version numbers, and state when the latest version does not reference the target. Retained historical versions still block deletion after the draft and latest stop using the target. [Explicit version cleanup](version-cleanup.md) can remove obsolete caller versions after informed agreement. Published references cannot be edited; archive the target when you want to preserve definitions and history. Owned children follow the same reference rules.

## Dispatch independent workflows

Set a Workflow node to `mode: "detached"` to start its pinned workflow and continue with `{runId, workflowId, version}`. Omit mode or use `wait` to await its result. Input validation precedes dispatch; later child failure does not change the launching step. See [Workflow execution](workflow-execution.md) for the fixed output contract and lifecycle.

`list_work` includes detached descendants, even when their parent is terminal. Root IDs describe ancestry. To operate independent work, use its own run ID. `list_runs` with `rootOnly: true` excludes detached runs, so omit that filter when finding active independent work. Cancellation stops at detached relationships. Retry failed detached runs directly; retrying a later parent step does not duplicate dispatches.

## Context continuity

Agent definitions can set `context.continuityGroup` with current context. Grouped assignment summaries, full assignments, briefings, and compact mutation `nextWork` items expose `continuity`: the run-local group, revision, expected executor/session identity (or null before first claim), and optional checkpoint reference. `claim_work` accepts `session: {executorId, sessionId}`; grouped claims require it. `renew_claim`, `submit_result`, and `fail_work` retain their token-based contracts. Failure, expiry, and `retry_run` preserve the group binding.

Use `get_context_group` for bounded claim/handoff history and `handoff_context_group` for revision-checked replacement. CLI equivalents are `context-group` and `handoff-context`; shared API operations are `runs.contextGroup` and `runs.handoffContext`. Workflow authoring, edits, and imports preserve the optional field; publication rejects fresh context combined with a group. Ungrouped definitions and responses retain their existing behavior. See [context continuity](context-continuity.md) for complete scope, bounds, and examples.

Agent executors can [check candidate results before submission](result-preflight.md) without renewing claims or advancing runs. Submission rechecks live state and returns bounded correction diagnostics when a result is rejected.

[Assignment size diagnostics](assignment-size.md) show UTF-8 byte contributions and advisory warnings before claims. Agent previews accept sample inputs and upstream outputs, with unresolved values marked unknown. Payload values are omitted from reports.

Use [fixture simulation](workflow-simulation.md) to check contracts and routes before spending model tokens on supported flat graphs. `workflow_simulation` groups run/get/list/capture/cancel actions. Simulation results are separate evidence from live runs and do not assess prompt or implementation quality.

## Resume externally blocked assignments

[External holds](work-holds.md) suspend one Agent assignment without consuming its failure or expiry allowance. Held work is absent from `list_work`. Briefings expose a bounded `held` list with work/run/lifecycle IDs, category, server timestamp, attempt and hold revision; `blockers` use `external_hold`. Reasons, checkpoints, payloads and claim tokens are omitted. When holds need attention, `next` is `inspect_hold`. Available work, budget gates and active claims can take precedence.

Compact mutation responses add `heldWork` only when needed. Their existing `nextCall` suggests a briefing for `inspect_hold`. Full inspection includes current blocker details and up to twenty recent historical intervals per affected assignment. Use `manage_work_hold` with `action:history` for older intervals, default twenty and maximum one hundred per page. Holds on detached runs retain their independent lifecycle IDs.
