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

## Started run output

Start and continue returns the new run's identity:

```json
{
  "runId": "NEW_RUN_ID",
  "workflowId": "INVESTIGATION_WORKFLOW_ID",
  "version": 3
}
```

This output confirms dispatch, not completion. It contains no live status or eventual result. The Output section shows a read-only **Started run** contract. Changing execution mode changes what downstream steps receive. The editor preserves the previous wait-mode contract when toggling before Apply changes. After saving detached mode, switching back starts with an unrestricted output contract.

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

A detached run retains its parent link for inspection but continues after the parent completes, fails, or is cancelled. Its own failure or cancellation does not change the parent. Cancel the detached run directly to stop it. Cancellation includes ordinary descendants and stops at each detached relationship.

A failed detached run can be retried directly, even after its parent ends. Completed and cancelled runs cannot be retried. Retrying a later parent step does not recreate or retry earlier detached work.

Child creation, the execution link, and dispatch completion commit atomically. A failed dispatch write rolls back child creation. Engine restart retains committed dispatches without creating duplicates. Each deliberate loop visit or new parent run can dispatch another child. External side effects inside a child retain the ordinary retry rules.

## Find and operate independent runs

Global **Runs** includes detached runs under **Active** or **History**, marked **Started independently** with their origin. They remain visible after their parent finishes. The launching execution shows a **Started run** link and its live status. The child's **Started by** button opens the launching execution.

Parent inspection includes detached descendants, but their progress does not make a completed parent appear unfinished. While detached descendants are active, the parent inspector links to them and explains that cancelling the parent leaves them running.

Use existing CLI commands with the returned `runId`:

```sh
interlock run RUN_ID
interlock work RUN_ID --summary
interlock cancel RUN_ID
interlock retry RUN_ID
```

The MCP equivalents are `get_run`, `list_work`, `cancel_run`, and `retry_run`. A detached run carries `parentMode: "detached"` and `parentExecutionId`, alongside `parentRunId`. Run and work summaries expose `parentMode` for the immediate run. `rootRunId` and `rootWorkflowId` still identify the original ancestor. `rootOnly: true` excludes detached runs because they have parents; omit that filter to find independent work.

Parent-scoped assignment discovery still includes all descendants, including detached work after the parent ends. A terminal parent does not mean its detached descendants finished. Use each independent run's ID to continue its work. Fresh-session assignment instructions target the nearest detached ancestor, or the original root when no detached boundary exists.

Dispatch does not start an agent executor. Agent steps still require a connected harness or manual completion. The server continues to advance automatic steps and timers.

## Batch and resource limits

Inside a Batch, a detached Workflow step returns a run reference for each item. Batch concurrency limits item dispatch, not how many detached workflows remain active. Existing item limits and the ten-level ancestry limit still apply, including detached relationships.

A detached workflow creates a new `runInput` scope. Its `rootInput` remains the original ancestor's input. It cannot read arbitrary parent node outputs through bindings.

Deleting a workflow remains blocked if its deletion set includes active detached descendants. Archive it to preserve ongoing work and history.

There is no join node, completion callback, automatic parent notification, cancel-all-descendants action, or global detached-work concurrency limit. Inspect the returned run ID for status and results.
