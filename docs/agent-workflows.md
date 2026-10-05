# Author and operate workflows

## Discover schemas and assignments

MCP `create_workflow.definition` and `update_workflow.draft` expose the workflow object schema, including node fields and edge handles. Incomplete routes remain saveable drafts. Publication validates graph routes and pinned dependencies. For small changes, `edit_workflow` avoids resending the full graph. `validate_workflow` reports read-only diagnostics for the stored draft or a candidate.

`start_run.input` and `submit_result.output` accept any JSON value matching the workflow or assignment contract, including objects, arrays, scalars, and null. Pass structured values directly. JSON-looking strings remain strings and are never implicitly parsed.

Agent `context.mode` accepts `current` or `fresh`. An executor satisfies `fresh` with a new session or an isolated subagent without inherited conversation history. `isolated` is not a mode value. Declare only tools, skills, and isolation that the executor provides.

For polling, call `list_work` with `fields: "summary"`. Summaries include assignment ID, run ID, node ID, label, status, context requirements, attempt counts, and any unclaimed deadline.

Work summaries also include `workflowId`, optional `parentRunId`, optional `parentMode: "detached"`, `rootRunId`, and `rootWorkflowId`. `workflowId` identifies the immediate run's workflow. `rootWorkflowId` identifies the outermost workflow so a dispatcher can select an executor without fetching run history. Root runs omit `parentRunId` and use their own run and workflow IDs as root IDs. Ancestry follows execution, independently of workflow ownership.

Work summaries omit prompts, inputs, output schemas, and execution instructions. `claim_work` returns the complete assignment. The default `fields: "full"` preserves the existing response. CLI callers can use `interlock work RUN_ID --summary`. The shared API exposes `work.summaries` and `work.list`.

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

Removing a node preserves bindings in surviving nodes. Those bindings become publication blockers until explicitly repaired. Removing or renaming a source port preserves its edges, so reconnect or remove them in the same edit list, or save and repair the incomplete draft later. Batch membership remains explicit through `batchId`; existing publication scope checks apply. Workflow ownership is not editable, and saved references still obey owned-child rules.

The result contains `applied`, `draftRevision`, `changes`, and `diagnostics`. `changes.nodes` and `changes.edges` each contain added, updated, and removed IDs; `changes.settings` lists changed fields. Effective changes increment the draft revision once. Empty or equivalent edits preserve both revision and timestamp. Equality ignores object key order. Rejected edits return `applied: false`, the current revision, empty changes, and diagnostics. Invalid edits identify their zero-based `operationIndex`. A stale revision has code `stale_revision`; reload before retrying.

## Validate without saving

Call `validate_workflow` with an `id` to inspect its stored draft, or include a candidate `definition`. The shared API is `workflows.validate`. The result contains the stored `draftRevision`, `saveable`, `publishable`, and diagnostics. Candidate validation never saves the candidate. These calls do not create a version or a run. Full replacement remains available through `update_workflow`.

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

| Field                       | Meaning                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                       | Requested identity, workflow/version, status, ancestry, current execution ID, and result reference. No input, output, or definition.                                                                                      |
| `progress.requested`        | Run status counts for the requested run and ordinary descendants, excluding detached trees.                                                                                                                               |
| `progress.independent`      | Run status counts across detached trees within the requested ancestry.                                                                                                                                                    |
| `progress.executions`       | Execution-visit status counts in the requested lifecycle, including earlier attempts and loop visits.                                                                                                                     |
| `descendants`, `detached`   | Run summaries and detached boundary references. `lifecycleRunId` is the requested ID for ordinary descendants, and the nearest detached ancestor's ID for independent trees. A directly detached run identifies itself.   |
| `available`, `claimed`      | Assignment identity, execution reference, ancestry, lifecycle, context mode, tool/skill requirements, attempts, worker, and applicable deadline. Prompts, instructions, schemas, inputs, outputs, and tokens are omitted. |
| `blockers`                  | `available_work`, `claimed_work`, `wait`, `children`, `executing`, or `failure`, with run/execution/work references.                                                                                                      |
| `failures`                  | Currently failed run references and errors. Collected Batch item failures can appear while their parent remains waiting or completes.                                                                                     |
| `batches`                   | Per-execution total, dispatched and queued item counts, plus dispatched item status counts. Terminal status distinguishes undispatched items from work still pending.                                                     |
| `deadlines`, `nextDeadline` | Sorted active Wait, unclaimed timeout, and claim lease deadlines. Earliest deadline or null.                                                                                                                              |
| `recentResults`             | Recent completed execution references, labels, kinds, selected ports, timestamps, and output availability. No result values.                                                                                              |
| `next`                      | Suggested action: `claim_work`, `wait_for_worker`, `wait_for_change`, `inspect_failure`, or `inspect_result`. Inspect requested status and lifecycle IDs before acting on independent work.                               |
| `cursor`, `revision`        | Continuation cursor and monotonically increasing scoped revision. These differ from the graph-node `cursor` inside `run`.                                                                                                 |

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

## Renew claims

Claims accept `leaseSeconds` from 10 through 3600, defaulting to 300. Renew before `leaseUntil` expires. Renewal sets the deadline to the current time plus the requested duration.

Omitting `leaseSeconds` reuses the duration established by the current claim, persisted as `claimLeaseSeconds`. Older stored claims without that field retain the 300-second fallback. An explicit override applies only to that renewal and can shorten the remaining lease. A new claim establishes a new duration. Expired, cancelled, or completed claims cannot be renewed.

```sh
interlock claim WORK_ID executor '{"leaseSeconds":3600}'
interlock renew WORK_ID TOKEN
interlock renew WORK_ID TOKEN '{"leaseSeconds":600}'
```

The CLI accepts options JSON or `@filename` as the third `renew` argument. MCP `renew_claim` and the shared API `work.renew` use the same optional `leaseSeconds` field.

Compatibility: omitted renewals previously reset every claim to 300 seconds. Callers that depend on that behavior must now pass `leaseSeconds: 300` explicitly. An abandoned long claim can therefore take longer to become available again.

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

`interlock export WORKFLOW_ID` and MCP `export_workflow` export an `interlock-workflows` bundle with `formatVersion: 1`. The library and Workflow settings export the same bundle format. Workflow settings includes local draft edits without saving them.

A bundle contains the root workflow, its owned children, owners, and transitive dependencies from drafts and all published versions. Each record includes a stable ID, name, description, ownership, draft, source draft revision, and consecutive published versions. Missing referenced workflows block export. Runs, claim tokens, and archive flags are excluded. Exporting an owned child includes its owner and siblings to preserve ownership.

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

`force` allows draft and metadata replacement. It cannot change ownership or overwrite an existing published version with different content. If the two engines independently published different definitions under the same ID and version, import rejects the entire bundle. Resolve that divergence explicitly before deploying. Any invalid graph, missing published dependency, stale draft, or version conflict rolls back all bundle changes. Imported drafts can remain incomplete; imported published versions must pass publication validation.

UI import accepts bundles and legacy files. Replacements that need a revision map or `force` use CLI or MCP. The shared API exposes `workflows.export`, `workflows.exportDraft` for unsaved editor content, and `workflows.import`.

## Archive, restore, or delete

MCP `update_workflow` accepts `archived: true` or `false`. CLI provides `archive ID` and `restore ID`. Archive retains history and does not cancel active runs. New direct starts require an active workflow and owner; existing published invocations retain their pins.

`list_workflows` includes archived workflows by default. Pass `includeArchived: false` to hide archived workflows and children of archived owners. The owner filter remains independent.

MCP `delete_workflow` and `interlock delete ID --yes` permanently remove the workflow, its versions, and associated run trees, assignments, and events. Active runs, external draft or published references, and owned children block deletion. Archive is available when referenced versions must remain accessible.

## Dispatch independent workflows

Set a Workflow node to `mode: "detached"` to start its pinned workflow and continue with `{runId, workflowId, version}`. Omit mode or use `wait` to await its result. Input validation precedes dispatch; later child failure does not change the launching step. See [Workflow execution](workflow-execution.md) for the fixed output contract and lifecycle.

`list_work` includes detached descendants, even when their parent is terminal. Root IDs describe ancestry. To operate independent work, use its own run ID. `list_runs` with `rootOnly: true` excludes detached runs, so omit that filter when finding active independent work. Cancellation stops at detached relationships. Retry failed detached runs directly; retrying a later parent step does not duplicate dispatches.
