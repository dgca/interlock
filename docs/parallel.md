---
title: Parallel steps
description: Run different paths at the same time from one input and join their results.
---

# Run different steps in parallel

A **Parallel** group runs several paths from the same input at the same time, then joins their results. Use it when the next step needs results from independent work, such as two reviews. To repeat one path over a list, use [Batch](https://github.com/dgca/interlock/blob/main/docs/architecture.md#batch-handles-and-graph-scopes) instead.

## Add a Parallel group

1. In the workflow editor, choose **Add node**, then **Parallel**.
2. Name each branch. The names become keys in the joined result.
3. Set **Branches at a time** to limit how many paths run at once.
4. Choose **Add node** in a lane header to add a step to that lane.
5. Connect the incoming step to **In**, and **Out** to the next step.
6. Save the draft. Publish when every path is connected.

The editor connects a lane's first node to the lane's start. It appends new nodes when the lane has one ordinary end. For other layouts, connect the steps yourself. Unconnected success outputs return to the group automatically. Connect any failure or timeout routes inside the lane.

### Example

Send a change to two independent reviewers. Name the branches `specReview` and `codeReview`, and configure each reviewer. When both succeed, the next step receives:

```json
{ "specReview": { "approved": true }, "codeReview": { "approved": true } }
```

A group output contract checks this whole object. Each step inside a branch still checks its own contracts.

## Continue before every branch finishes

By default the group waits for every branch. To continue sooner:

1. Open the group's settings.
2. Set **Continue after** to **Any branch succeeds** or **A number of branches succeed**.
3. For a number, enter 1 up to the branch count.

When enough branches succeed, Interlock cancels the branches that are still running or have not started. Cancelled branches and steps record a reason that names the group, for example `Reviews join satisfied after 1 of 3 branches`.

Cancellation works as it does for a cancelled run:

- Claims are revoked. A revoked claim keeps its [exclusive resources](https://github.com/dgca/interlock/blob/main/docs/work-resources.md) until you confirm the agent stopped.
- Managed sessions and Scripts are stopped.
- Waited child workflows are cancelled. Detached child runs keep running.

### When a branch fails

**When a branch fails** decides what a failure does:

- **Fail and stop other branches** fails the group. This is the default.
- **Continue while enough branches can succeed** keeps waiting while the remaining branches can still reach the number. The group fails once they cannot.

### Output of a partial join

A group that can continue early sends a different output. `results` holds the output of each branch that completed. `branches` gives each branch's outcome: `completed`, `failed` or `cancelled`. For a group of three that continues after the first success:

```json
{
  "results": { "specReview": { "approved": true } },
  "branches": {
    "specReview": "completed",
    "codeReview": "cancelled",
    "securityReview": "cancelled"
  }
}
```

- Branches that complete in the same step as the winning branch are kept. `results` can hold more branches than the number required.
- A group that waits for every branch keeps the original output. That includes a number equal to the branch count, or an explicit **Fail and stop other branches**.
- Publication rejects an output contract, a binding or the next step's input contract that reads a branch key at the top level of a partial join's output.
- If the joined output fails the group's output contract, the group fails. The cancelled branches record that the group failed.

## Inspect and retry

In the run inspector:

- Select a Parallel execution in the timeline to expand its paths and their statuses.
- Select a step on the canvas or in the expanded timeline to see its input, output and attempts.
- Use the group link in the details pane to return to the joined output.
- Select an earlier execution of the group to inspect that visit.
- Paths that never started stay visible if the group fails.

If a step invokes another workflow, open that workflow from the step details. The back button returns to the step that opened it.

When a branch fails, the group fails and cancels unfinished waited branches. Retry the failed parent run: successful results are kept and the remaining paths resume. If Interlock cannot confirm that old work stopped, inspect and reconcile that attempt first. See [exclusive step resources](https://github.com/dgca/interlock/blob/main/docs/work-resources.md) and [workflow execution](https://github.com/dgca/interlock/blob/main/docs/workflow-execution.md).

## Author through CLI or MCP

A group in a workflow definition:

- The group node has `kind: "parallel"`, `branches: [{id, key}]` and optional `concurrency`.
- Optional `joinAfter`, from 1 to the branch count, continues after that many successes. Omit it to wait for all.
- Optional `onBranchFailure: "continue"` keeps going after a failure while `joinAfter` can still be reached. It needs `joinAfter` below the branch count.
- Each member node has the group's `parallelId` and its `parallelBranchId`.
- An edge from source port `branch:<id>` starts each path.
- An edge with `targetHandle: "join"` returns a path to its group. The visual editor saves these returns for you and shows each at its lane's **End** dot.
- The group's `complete` port forwards the joined object.

Renaming a result key keeps the branch ID and its edges.

A branch can read its own completed node outputs and execution provenance. To share earlier parent values, pass them through the group's input. The step after the group can read the whole joined object. See [step data](https://github.com/dgca/interlock/blob/main/docs/node-data.md).

### Try the example

Import the [deterministic example](https://github.com/dgca/interlock/blob/main/workflows/parallel-checks.json) on a running Interlock server:

```sh
interlock import @workflows/parallel-checks.json
interlock publish WORKFLOW_ID
interlock start WORKFLOW_ID '{"checks":["lint","test"]}' --summary
interlock run RUN_ID
```

Use the IDs that import and start return. The completed run returns `{"count":2,"hasTests":true}`.

Through MCP, `get_run_briefing` gives bounded `parallels` counts and descendant references. `get_run_result` gives the joined output.

## Limits

| Item                          | Limit                                   |
| ----------------------------- | --------------------------------------- |
| Branches in a published group | 2–50                                    |
| Result key                    | Nonblank, unique, at most 64 characters |
| **Branches at a time**        | 1–50, default 5                         |
| Continue after a number       | 1 up to the branch count                |

- The executor's capacity and existing claim gates still apply.
- An outer loop can revisit a group. Each visit gets its own input and joins only that visit's results.
- Parallel groups belong at the main workflow scope. Batch and Parallel groups cannot be nested inline in a Parallel group. Use a waited Workflow call for a procedure that contains a group.
- Paths inside a branch must not loop.
- A detached Workflow call in a branch returns its run reference and keeps running on its own.
- To constrain the literal key `__proto__` in a group contract, use the pattern `^__proto__$` in `patternProperties`.

### Steps and budgets

- Branch steps count toward the owning run's `maxSteps`. The group counts once; the join does not spend another step.
- A retry does not refund earlier steps.
- Invoked workflows keep their own limits.
- Use a [lifecycle or tree budget](run-budgets.md) to govern Agent claims across branches.

### Simulation

[Fixture simulation](https://github.com/dgca/interlock/blob/main/docs/workflow-simulation.md) runs the branches one at a time in branch order and reports coverage per branch. With `joinAfter`, the first branches to succeed in branch order satisfy the join. Later branches are reported as cancelled without running.
