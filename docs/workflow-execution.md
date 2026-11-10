# Workflow execution

A Workflow node invokes a pinned published version of another workflow. **Execution** in its settings controls when the next step starts.

| Setting                | Next step starts                    | Step output                    |
| ---------------------- | ----------------------------------- | ------------------------------ |
| **Wait for result**    | When the invoked workflow completes | Its final result               |
| **Start and continue** | When the new run is durably created | `{runId, workflowId, version}` |

Wait for result is the default, including for older definitions that omit `mode`. Start and continue is stored as `mode: "detached"`:

```json
{
  "id": "investigate",
  "kind": "workflow",
  "label": "Start investigation",
  "workflowId": "INVESTIGATION_WORKFLOW_ID",
  "version": 3,
  "mode": "detached"
}
```

Replace the workflow ID and version with an existing published version. Connect the node's ordinary Out handle to its next step. Input bindings, ownership rules, pinned-version selection, portable bundles, and cascade publication work in both modes.

## Move a run to a newer version

Runs use `versionPolicy: "pinned"` by default. Publishing a fix leaves those runs unchanged. Set `versionPolicy: "latest-compatible"` when starting a run, or update the policy on an existing run, to check for a newer version before each new node execution.

A move uses the latest published version only when that version contains the next node in the same Batch scope and accepts its resolved input. A missing node, incompatible contract, changed Batch ancestry, exhausted target step allowance, or missing captured dependency leaves the run on its current version. Inspection exposes the blocker; the old path can still continue and try again at its next boundary. There is no fallback search through intermediate versions.

An available Agent assignment already belongs to an active execution. Available work, claims, Scripts, Fetch calls, Waits, input waits, active Batches, and waited child calls finish with the definition they started on. Their prompts, contracts, result routing, and output mappings stay unchanged. The run can move only before the next execution is created. Enabling a policy does not replace existing work.

For an explicit move, preview an exact newer retained version, review its blockers, then apply with the returned confirmation and an operator reason. Apply rechecks the same state in one transaction. A stale preview, blocker, or failed write changes nothing. To keep a boundary available for an operator move, add a named workflow pause before the in-flight execution finishes, then remove that exact pause after applying. A pause does not make an active execution eligible for replacement.

Version inspection returns the current policy and revision, the latest compatibility blocker, and paged change history. Each change records its original version, target version, time, and reason. Every new execution records its own `version`; executions created before this field existed use their run's original version. Policy writes require the revision returned by inspection.

### Operate through CLI, MCP, and API

The inspector's **Run version** dialog shows the policy, **Preview move**, blockers, and **Apply version N**. New-run controls also offer **Version policy**.

CLI uses one JSON request with an `action`:

```sh
interlock start WORKFLOW_ID '{}' --version-policy latest-compatible
interlock run-version '{"action":"read","runId":"RUN_ID","limit":20}'
interlock run-version '{"action":"policy","runId":"RUN_ID","expectedRevision":0,"policy":"latest-compatible"}'
interlock run-version '{"action":"preview","runId":"RUN_ID","version":3}'
interlock run-version '{"action":"apply","runId":"RUN_ID","version":3,"confirmation":"PREVIEW_CONFIRMATION","reason":"Apply published fix"}'
```

Use the revision from `read` for policy writes and the confirmation from the exact `preview` for apply. Add `"recapturePrompts":true` to both preview and apply only when you intend to replace the saved prompt capture. Do not repeat start to inspect an existing run.

MCP `manage_run_version` accepts those same actions inside `request`. MCP `start_run` accepts `versionPolicy`. The shared API exposes `runs.versionPolicy`, `runs.setVersionPolicy`, `runs.previewVersionMove`, and `runs.applyVersionMove`. Read history defaults to 20 entries and accepts a maximum of 100 with an offset; bodies and full prior definitions are omitted.

### Captures and execution scope

A move preserves the run's saved prompt capture, protected variable revisions, model-alias captures, budget history, and continuity bindings. A new version that needs a prompt, variable, or alias absent from that capture is blocked. Explicit `recapturePrompts: true` selects the target version's publish-pinned prompt revisions, or current revisions when that version has no pins. It does not recapture variables or model aliases. Existing work is never rewritten.

A Batch parent cannot move during its active Batch execution. Item dispatch uses that execution's graph and inherits its captures and current policy. Item runs have independent version bindings and may accept a compatible upgrade at their own valid boundaries, including before their first step, while retaining their Batch identity. Future Batches created after a parent move use its new version.

Invoked waited and detached workflows start independently with their own pinned policy and captures. A parent move does not change an existing child. Calls created after the move use the child version pinned by the new parent definition. Cancellation and detached lifetime boundaries retain their existing meaning.

Continue-as-new successors inherit the predecessor's current version, policy, and captures. Upgrading a run cannot introduce, remove, or change its chain configuration or reset its cap. Earlier budget consumption still applies. Continuity groups remain local to each run. Comparison runs cannot move to another version.

See [continue as new](continue-as-new.md) and [version cleanup](version-cleanup.md) for chain and retention behavior.

## Recover a waited failure

Wait for result can opt into `onFailure:"route"` with its configured success edges and a failed edge. A failed child or a successful result rejected by the caller's output contract sends `{input,error,output}` through Failed, including `error.child` run/version/execution references. The child remains inspectable. Cancellation, caller input/dispatch errors and persistence failures stay terminal. Defaults remain unchanged; detached calls cannot route failures. See [Workflow failure routes](failure-routes.md#waited-workflow-calls).

An already-handled failed child cannot be retried independently while recovery proceeds. Retry a later failed recovery step through its owning run. That retry does not replay the child.

## Started run output

Start and continue returns the new run's identity:

```json
{
  "runId": "NEW_RUN_ID",
  "workflowId": "INVESTIGATION_WORKFLOW_ID",
  "version": 3
}
```

This output confirms dispatch, not completion. It contains no live status or eventual result. The Output section shows a read-only **Started run** contract. Changing execution mode changes what downstream steps receive. The editor preserves the previous wait-mode contract when toggling before Apply changes, while the workflow reference and pinned version stay the same. After reopening a saved detached node, switching back restores the output contract from that pinned published version. If no version is selected or retained, the editor explains that waiting starts with Any output. A failed contract read leaves the mode unchanged and offers Retry.

Raw and API definitions may omit `outputSchema` or use `{}` to select the intrinsic contract. An explicit override must match this contract; conflicting overrides block publication:

```json
{
  "type": "object",
  "properties": {
    "runId": { "type": "string" },
    "workflowId": { "type": "string" },
    "version": { "type": "integer", "minimum": 1 }
  },
  "required": ["runId", "workflowId", "version"],
  "additionalProperties": false
}
```

Input bindings, the launching node's input contract, the target workflow's input contract, the pinned version, and the nesting limit are checked before dispatch. Failure creates no child run. After dispatch, the child's node and final output contracts apply independently. Even an immediate child failure does not change the completed launching step.

## Independent lifecycle

A detached run retains its parent link for inspection but continues after the parent completes, fails, or is cancelled. Its own failure or cancellation does not change the parent. Cancel the detached run directly to stop it, or explicitly include it in [tree cancellation](#cancel-a-run-tree). Ordinary `cancel_run` includes active ordinary descendants and stops at each detached relationship.

A failed detached run can be retried directly, even after its parent ends. Completed and cancelled runs cannot be retried. Retrying a later parent step does not recreate or retry earlier detached work.

Child creation, the execution link, and dispatch completion commit atomically. A failed dispatch write rolls back child creation. Engine restart retains committed dispatches without creating duplicates. Each deliberate loop visit or new parent run can dispatch another child. External side effects inside a child retain the ordinary retry rules.

## Find and operate independent runs

Global **Runs** includes detached runs under **Active** or **History**, marked **Started independently** with their origin. They remain visible after their parent finishes. The launching execution shows a **Started run** link and its live status. The child's **Started by** button opens the launching execution.

Parent inspection includes detached descendants, but their progress does not make a completed parent appear unfinished. While detached descendants are active, the parent inspector links to them and explains that ordinary cancellation leaves them running. **Cancel run tree** can explicitly include them.

Use existing CLI commands with the returned `runId`:

```sh
interlock run RUN_ID
interlock work RUN_ID --summary
interlock cancel RUN_ID
interlock retry RUN_ID
```

The MCP equivalents are `get_run`, `list_work`, `cancel_run`, and `retry_run`. For continuation, prefer `get_run_briefing` to distinguish requested completion from active independent trees. Use `get_run_result` for selected values and `wait_for_run_change` for finite waits scoped to the requested ancestry. See [continuation scope and bounds](agent-workflows.md#resume-a-run-with-a-briefing). A detached run carries `parentMode: "detached"` and `parentExecutionId`, alongside `parentRunId`. Run and work summaries expose `parentMode` for the immediate run. `rootRunId` and `rootWorkflowId` still identify the original ancestor. `rootOnly: true` excludes detached runs because they have parents; omit that filter to find independent work.

Parent-scoped assignment discovery still includes all descendants, including detached work after the parent ends. A terminal parent does not mean its detached descendants finished. Use each independent run's ID to continue its work. Fresh-session assignment instructions target the nearest detached ancestor, or the original root when no detached boundary exists.

Agent steps use the invoked workflow’s own executor settings. Configured [managed profiles](managed-executors.md) launch automatically; other steps require a connected harness or manual completion. The server continues to advance automatic steps and timers.

## Batch and resource limits

Inside a Batch, a detached Workflow step returns a run reference for each item. Batch concurrency limits item dispatch, not how many detached workflows remain active. Existing item limits and the ten-level ancestry limit still apply, including detached relationships.

A detached workflow creates a new `runInput` scope. Its `rootInput` remains the original ancestor's input. It cannot read arbitrary parent node outputs through bindings.

Deleting a workflow remains blocked if its deletion set includes active detached descendants. Archive it to preserve ongoing work and history.

There is no join node, completion callback, automatic parent notification, or global detached-work concurrency limit. Inspect the returned run ID for status and results.

Waited nodes may [route and map their accepted result](node-data.md). Start and continue returns the intrinsic run reference and cannot configure result routing or output mappings. The editor restores pending waited-result settings if you switch back before applying.

## Cancel a run tree

Use **Cancel run tree** in the run inspector to preview active runs before cancellation. The action remains available on a terminal parent with active descendants. Enable **Include detached descendants** to include independent work, enter a cancellation reason, and confirm. The ordinary **Cancel run** action keeps its existing detached boundaries.

CLI supports the same preview and cancellation:

```sh
interlock cancel-tree RUN_ID --include-detached --preview
interlock cancel-tree RUN_ID --include-detached --reason 'Stop runaway batch'
```

MCP separates the read-only preview from the mutation:

```json
{
  "name": "preview_run_cancellation",
  "arguments": {
    "id": "RUN_ID",
    "includeDetached": true,
    "limit": 20,
    "offset": 0
  }
}
```

```json
{
  "name": "cancel_run_tree",
  "arguments": {
    "id": "RUN_ID",
    "includeDetached": true,
    "reason": "Stop runaway batch"
  }
}
```

The shared API exposes `runs.previewCancellation` as a query and `runs.cancelTree` as a mutation with those arguments. `includeDetached` defaults to `false`. The reason is required for cancellation and accepts 1 through 1,000 characters after trimming. Preview accepts `limit` from 1 through 100, default 20, and a nonnegative `offset`. CLI uses `--limit` and preview-only `--offset`.

Preview returns compact run references in `items`, exact `total`, `offset`, `nextOffset`, and `truncated`. It excludes inputs, prompts, outputs, and claim tokens. No work is advanced, claimed, or stopped. Cancellation recomputes the live selection, so a preview is advisory. Its bounded `cancelled.items` list and exact `cancelled.total` describe the runs changed by that action. Mutation `limit` bounds returned references, not cancellation scope.

Discovery follows the selected run's descendants and forward continue-as-new links, including active work below completed or failed intermediate parents. Selecting a child does not select its parent or siblings. Without `includeDetached: true`, traversal stops at every detached edge. Terminal run outcomes remain unchanged. Selected chains are stopped to prevent continuation or retry.

Cancellation state, claim invalidation, hold closure, usage endings, reasons, and lifecycle events commit in one transaction. A failed write rolls back the whole action. After commit, Interlock requests native process stops and aborts local operations through their existing execution paths. Cancelled timers and Batch parents create no later work. Lifecycle handlers retain their own normal trigger behavior.

A successful cancellation response confirms logical cancellation, not external quiescence. Revoked claims and operations that may still be active retain uncertain ownership. Confirmed completion or exact-attempt stopped reconciliation releases that ownership. Inspect background Scripts with `manage_script`, managed sessions with `manage_executors`, and uncertain owners with `manage_work_resources` before releasing them. See [resource recovery](work-resources.md#reconcile-an-uncertain-stop) and [quiescent teardown](events.md#quiescent-teardown).
