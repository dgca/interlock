# Detached Workflow nodes

Reviewed design for issue #48. See [Workflow execution](workflow-execution.md) for the implementation reference.

Issue: [#48](https://github.com/dgca/interlock/issues/48)

## Intended behavior

A Workflow node can start another workflow and continue as soon as the new run is durably created. A supervisor can dispatch an investigation, then accept another request or finish without waiting for the investigation's result.

Keep the existing Workflow node and pinned-version selection. Add an optional `mode` with two values: `wait` and `detached`. Omission means `wait`, preserving existing definitions and published runs.

## Editor

Below the workflow and version controls, show an **Execution** radio group:

- **Wait for result**. Continue when this workflow finishes. Use its result as this step's output.
- **Start and continue**. Return the new run's details immediately. It keeps running if this run finishes, fails, or is cancelled.

Wait for result is the default. Show a **Start and continue** label on detached canvas nodes so their behavior is visible without opening settings. Keep the ordinary In and Out connections.

In detached mode, the Output section shows a read-only **Started run** contract containing `runId`, `workflowId`, and `version`. Switching modes changes the output shape. Show that consequence beside the mode control. Preserve the previous wait-mode output contract while toggling within the dialog. Applying detached mode stores the intrinsic run-reference contract; switching back after saving starts from an unrestricted output contract, which the user can edit.

## Dispatch and output

Resolve input bindings, validate the node input and the referenced workflow's input contract, and verify the pinned version and nesting limit before dispatch. Failure here fails the launching step and creates no child run.

Successful dispatch creates exactly one child for that node execution and completes the launching step with:

```json
{
  "runId": "new-run-id",
  "workflowId": "investigation-workflow-id",
  "version": 3
}
```

The output confirms dispatch, not completion. It contains no live status or eventual result. A child can fail immediately afterward without changing the launching step's success. The child's own input, node, and final output contracts still apply.

Raw and API definitions use the same intrinsic run-reference output contract. Publication rejects conflicting output-contract overrides in detached mode. The runtime checks launch prerequisites before creating a child, including when reading older persisted definitions.

Persist child creation, its link to the launching execution, and launching-step completion atomically. Restart or retry must not create a second child for the same execution. A deliberate loop visit or new parent run is a new execution and can dispatch another child. This does not promise exactly-once external side effects inside the child.

## Lifecycle

Detached runs retain their parent link for inspection, but do not share their parent's completion or cancellation lifecycle.

| Event after dispatch                    | Result                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Parent completes or fails               | Child continues.                                                |
| Parent is cancelled                     | Child continues. Ordinary waiting children are still cancelled. |
| Child completes, fails, or is cancelled | Parent's state does not change.                                 |
| Failed detached child is retried        | Retry that child directly, even if the parent is terminal.      |
| Parent retries a later failed step      | Already dispatched children are neither retried nor recreated.  |
| Engine restarts                         | Both runs resume independently from persisted state.            |

Cancellation stops at each detached relationship. Cancelling a detached child cancels its ordinary descendants, but leaves work it detached running independently. Cancellation before dispatch creates no child; after the dispatch transaction commits, the child survives.

No new successful-stop status is needed. The parent still reaches Exit to complete successfully and validate its final result.

## Visibility and work discovery

The launching execution shows **Started run**, a link to the child, and the child's current status. Its own status remains completed if the child later fails. The child has a **Started by** link back to the parent execution.

Global Runs lists detached runs alongside root runs, including in Active after their parent has finished. Mark them **Started independently** and show their origin. Parent inspection still includes them, but detached work must not make the parent appear waiting or unfinished.

When a run has active detached descendants, its cancellation UI states that those runs will keep running and links to them.

Preserve `parentRunId`, `rootRunId`, and `rootWorkflowId` as ancestry. Persist a relationship marker, proposed as `parentMode: "detached"`, and expose it in run summaries and inspection. Missing markers retain existing behavior. Keep `rootOnly` literal: it still selects runs without parents. Detached runs remain discoverable through ordinary status-filtered queries.

Global assignment discovery continues to include detached work. Parent-scoped discovery keeps its current inclusion of all descendants. Worker instructions must distinguish ancestry from execution responsibility: fresh-session instructions for detached work should target the nearest detached run, not a completed ancestor. MCP guidance must explain that a terminal parent can still have active detached descendants.

Dispatch does not create an agent executor. Agent steps still require a connected harness or manual execution.

## Boundaries

- Keep workflow ownership rules, pinned versions, publication, import/export, and cascade publication behavior. Detachment changes run behavior, not ownership.
- Preserve input-binding scope. A detached child's `runInput` is its supplied input; `rootInput` still refers to the original ancestor's input. It cannot read arbitrary parent node outputs.
- Retain the ten-level ancestry limit, counting detached links. Detachment must not bypass recursion limits.
- Allow detached Workflow nodes inside Batch item paths. Batch output contains run references, and Batch concurrency limits dispatching item runs, not the lifetime of detached work. State this beside the mode choice inside a Batch. Existing item limits still apply.
- Block workflow deletion when the existing deletion set includes active detached runs, even if their parent finished. Do not silently delete or cancel independent work.

This increment adds no join node, completion callback, automatic parent notification, global detached-work concurrency limit, or cancel-all-descendants action. Existing run inspection and cancellation APIs can operate on the returned run ID.

## Acceptance checks

1. Old definitions still wait and return child results. Ownership and version validation remain unchanged.
2. A detached child waiting on an Agent does not block the parent's next step or Exit.
3. Invalid launch input or pins fail before creating a child. Failure after dispatch affects only the child.
4. Parent cancellation, child cancellation, direct child retry, and restart follow the lifecycle table, including nested detached boundaries.
5. Crash recovery and later parent retries do not duplicate dispatches. Loop visits dispatch once per visit.
6. Detached work remains visible and claimable after its parent completes. Progress, fresh-session instructions, and deletion checks respect the new relationship.
7. Both modes round-trip through UI, Raw, CLI, HTTP MCP, stdio MCP, and portable bundles.

## Decisions to review

The strongest recommendation is that detached work survives parent cancellation. This gives **Start and continue** one consistent meaning. If cancellation should propagate, that should be a separate future mode with its own name.

The other tradeoff is allowing Batch dispatch without a global concurrency cap on detached runs. The first increment makes that behavior explicit. A cap that governs the entire lifetime of detached work would need separate scheduling semantics.
