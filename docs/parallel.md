# Run different steps in parallel

Use a **Parallel** group when several paths can start from the same input and the next step needs every result. Use [Batch](architecture.md#batch-handles-and-graph-scopes) to repeat one path over a list.

## Add a Parallel group

1. In the workflow editor, choose **Add node**, then **Parallel**.
2. Name each branch. The names become keys in the joined result. Set **Branches at a time** to bound active paths.
3. Add steps from each named branch. The first step connects to its start. Connect every terminal route in the branch to **Join**.
4. Connect the incoming step to **In**. Connect **Out** to the next step. Save the draft and publish when all paths are connected.

For example, send a change to independent specification and code reviewers. Name the branches `specReview` and `codeReview`. Configure each reviewer separately. After both succeed, the continuation receives `{"specReview":{...},"codeReview":{...}}`. A group output contract checks this whole object. Each branch step still checks its own contracts.

To constrain the literal key `__proto__` in a group contract, use the pattern `^__proto__$` in `patternProperties`.

Published groups have 2–50 branches. Result keys are nonblank, unique, and at most 64 characters. Concurrency accepts 1–50 and defaults to 5. The executor's capacity and existing claim gates still apply. An outer loop can revisit a group. Each visit receives its own input and joins only that visit's results.

Parallel groups belong at main workflow scope. Batch and Parallel groups cannot be nested inline with Parallel. Use a waited Workflow call for a procedure that contains a group. Paths inside a Parallel branch must be acyclic. A detached Workflow call returns its run reference and keeps running independently.

## Inspect and retry

Select a Parallel execution in the timeline to expand its named paths and see their statuses. Select a step on the canvas or in the expanded timeline to inspect its input, output, and attempts in the parent run. Use the group link in the details pane to return to the joined output. Select an earlier group execution to inspect that visit. Unstarted paths stay visible if the group fails.

If a path step invokes another workflow, open that workflow from the step details. The back button returns to the exact step that opened it.

When a branch fails, the group fails and cancels unfinished waited branches. Retry the failed parent run to keep successful results and resume the remaining paths. If Interlock cannot confirm old work stopped, inspect and reconcile the exact attempt first. See [exclusive step resources](work-resources.md) and [workflow execution](workflow-execution.md).

Parallel branch steps count toward the owning workflow run's `maxSteps`. The group counts once; Join does not spend another step. A retry does not refund earlier steps. Invoked workflows keep their own limits. Use a [lifecycle or tree budget](run-budgets.md) to govern Agent claims across branches.

## Author through CLI or MCP

A definition uses `kind: "parallel"` with `branches: [{id, key}]` and optional `concurrency`. Give each member the owning `parallelId` and its `parallelBranchId`. Use a source port `branch:<id>` to start each path. Return a path to its group with `targetHandle: "join"`. The group's `complete` port forwards the collected object. Renaming a result key leaves the branch ID and edges intact.

A branch can read its own completed node output or execution provenance. To share earlier parent values, pass them through the group's input. The parent's continuation can read the whole joined object. See [step data](node-data.md).

Try the [deterministic example](../workflows/parallel-checks.json) on a running Interlock server:

```sh
interlock import @workflows/parallel-checks.json
interlock publish WORKFLOW_ID
interlock start WORKFLOW_ID '{"checks":["lint","test"]}' --summary
interlock run RUN_ID
```

Replace the IDs with the ones returned by import and start. The completed run returns `{"count":2,"hasTests":true}`. Inspect the same workflow through MCP with `get_run_briefing` for bounded `parallels` counts and descendant references, then `get_run_result` for the joined output. Fixture simulation rejects Parallel definitions before executing them. Use an ordinary run or a live comparison to exercise the group.
