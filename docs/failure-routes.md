# Handle failed operations

Script, Fetch and waited Workflow nodes stop their run on failure by default. Set `onFailure: "route"` and connect both `default` and `failed` edges to handle an operation failure inside the workflow. In the editor, enable **Route on failure** and connect **Failed** to a recovery step. No additional MCP tool is needed.

```json
{
  "id": "request",
  "kind": "script",
  "label": "Request data",
  "language": "javascript",
  "command": "throw new Error('Service unavailable');",
  "onFailure": "route"
}
```

The default route receives the ordinary successful output. For Script and Fetch, Failed receives this fixed envelope:

```json
{
  "input": { "topic": "demo" },
  "error": {
    "nodeId": "request",
    "executionId": "execution-id",
    "kind": "script",
    "category": "execution",
    "message": "Script exited 1: Error: Service unavailable"
  },
  "output": null
}
```

`input` is the resolved input used by the failed operation, after any input bindings. `output` is its returned JSON value, or null when no result is available. Fetch HTTP rejection retains the response with status, headers, and body here. Output-contract failures retain the rejected value. `message` is diagnostic text and can include process stderr; branch on `category` rather than parsing it. Each execution ID identifies one operation. There are no automatic attempts for Fetch or Workflow nodes. A foreground Script can opt into [automatic retry](#automatic-retry-for-foreground-scripts); without it, one non-zero exit is final.

| Category    | Routed failures                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `execution` | Script process errors, timeout, invalid JSON or output size limits; Fetch network errors, timeout, response size limits or invalid declared JSON |
| `http`      | Fetch receives a non-2xx status while `failOnHttpError` is true                                                                                  |
| `output`    | Returned data violates the node's success output contract                                                                                        |

`onFailure: "fail"` and omission retain terminal behavior. `failOnHttpError: false` still accepts non-2xx responses through the default route, subject to its output contract.

The success output contract does not apply to the failure envelope. The destination validates its own input, or selects fields with ordinary input bindings, such as `error.message`. A destination contract mismatch fails that step. The editor suggests the fixed envelope when it is the only incoming shape. Original workflow and Batch item input remain accessible through their existing bindings.

The operation stays `failed` in history, with its error, available raw output, completion time, and `port: "failed"`. The run can continue and finish `completed`. Run inspection identifies the Failed route, and the testbench can check a recorded failed route. Earlier-node bindings select only completed executions, so recovery should read the incoming envelope. A completed recovery run cannot be explicitly retried.

Input-contract errors, missing input bindings, invalid Fetch request resolution, step limits, and graph errors remain terminal. Cancellation never follows recovery. A Fetch with declared resources also stays terminal if a timeout or transport failure leaves its dispatched request without a fully observed response. It retains uncertain ownership until remote-stop reconciliation. Fully observed HTTP and JSON errors retain their normal failure route. A server interruption still fails pending foreground Script and Fetch operations with an instruction to inspect external effects before explicitly retrying. An operation timeout can leave uncertain external effects too; recovery is not proof that an external write did not happen. The engine never automatically replays an interrupted operation or an engine-side timeout.

Inside a Batch, both routes must stay in the item scope and reach End. Routing directly to that Batch's End returns the envelope as the item's successful result. Unhandled item failures retain the Batch's `all` or `collect` policy. Recovery loops outside Batch item paths count against the existing step limit.

Incomplete routes remain saveable but block publication. Disabling the editor switch removes its Failed connection when settings are applied. With Raw JSON or MCP edits, remove the `failed` edge explicitly when removing `onFailure: "route"`. Publish a new version to change future runs; existing versions retain their behavior.

## Automatic retry for foreground Scripts

A Script node may opt into automatic retry with `transientRetry`. Omission, `transientRetry: { "maxRetries": 0 }`, and background execution keep the single-attempt behavior.

```json
{
  "id": "request",
  "kind": "script",
  "label": "Request data",
  "language": "javascript",
  "command": "return fetchDependency();",
  "transientRetry": { "maxRetries": 3, "initialBackoffMs": 1000 }
}
```

`maxRetries` (0 to 10, default 0), `windowMs` (0 to 86,400,000, default 300,000), and `initialBackoffMs` (0 to 60,000, default 1,000) are the same fields Agents use. `maxRetries` bounds one visit's retries; `windowMs` counts them by pause-excluded age; the delay is `initialBackoffMs * 2^recentRetries`. This is opt-in per Script node. A workflow-level Agent `transientRetry` does not apply to Scripts, and background Scripts and polling checks reject it.

Only an observed non-zero exit is eligible. Each failure is judged in three layers:

1. **The Script asks.** Exit code 75 (`EX_TEMPFAIL`), or a JSON object on the complete stdout value or the final stderr line with `retryable: true` or `transient: true`, and an optional `reason`. An exit 0 result never asks, even when it carries those fields.
2. **Shared error text.** Network failures, request timeouts the Script reports, HTTP 429, 500/502/503/504, overload, and narrow lock contention (`SQLITE_BUSY`, `database is locked`) retry. Authentication, HTTP 400/401/403, invalid requests, quota, and content-policy text stop immediately.
3. **One probe.** An unclassified exit gets one retry when budget allows. If the next failure repeats the same exit code and the same normalized stderr, retrying stops, so an unknown deterministic failure cannot loop. This early stop never applies to an explicit or recognized transient failure.

An engine timeout, signal, cancellation, spawn error, output limit, or invalid JSON is never retried. Output-contract and result-routing failures happen after a successful exit and are never retried.

A retry stays one execution: the pinned definition, resolved input, step budget, and `INTERLOCK_EXECUTION_ID` stay the same, while `INTERLOCK_ATTEMPT` increases with each subprocess launch. The engine commits the retry deadline before launching, and releases declared resources during backoff, reacquiring them through ordinary admission. Bounded retry receipts on the execution record the attempt, decision, layer, reason, and delay.

A restart or cancellation during a live attempt keeps the existing interruption behavior: the step fails and is never replayed automatically. A restart between attempts resumes the committed backoff when it is due. Cancellation during backoff stops without launching again. Pause holds extend both the backoff and the rolling window by their paused time.

The final failure, after the budget is spent or the judgment stops, is the only one that fails the step or follows `failed` from `onFailure: "route"`. Intermediate retries emit `node.retry_scheduled` and never route. A Script whose external effects are not safe to repeat should leave retry off.

## Waited Workflow calls

Workflow nodes with `mode:"wait"`, or with mode omitted, can use the same `onFailure:"route"` setting and `default` and `failed` edges:

```json
{
  "id": "research",
  "kind": "workflow",
  "label": "Research",
  "workflowId": "CHILD_WORKFLOW_ID",
  "version": 1,
  "onFailure": "route"
}
```

A failed child follows Failed with category `child`. A child that completes but returns a value rejected by the calling node's output contract follows Failed with category `output`. The child's own status and history remain unchanged. The failure value adds references to the retained child:

```json
{
  "input": { "topic": "demo" },
  "error": {
    "nodeId": "research",
    "executionId": "caller-execution-id",
    "kind": "workflow",
    "category": "child",
    "message": "Child run child-run-id: research failed",
    "child": {
      "runId": "child-run-id",
      "workflowId": "CHILD_WORKFLOW_ID",
      "version": 1,
      "executionId": "child-execution-id"
    }
  },
  "output": null
}
```

`input` is the resolved original call input after bindings. `error.child.executionId` is the child's last execution ID, or null if unavailable. Use `get_run` or targeted result reads to inspect that child; above 64 KiB `get_run` truncates long errors and drops large fields, so pass `full: true` for the complete child. History, prompts and work tokens are not copied into the failure value. For category `output`, `output` contains the rejected successful child result, which is also retained on the caller execution. For category `child`, it is null.

Caller input or binding errors, invalid target workflow input, invalid pins/configuration, caller step limits and persistence errors stay terminal. Target input is validated before allocating a route-enabled child. After valid dispatch, a failed child is a routable outcome regardless of its internal cause, including its own contract/step-limit failure or a Script/Fetch interruption recorded at restart. Handling that outcome never replays the child's external effects.

Parent cancellation and independently cancelled children never follow Failed. Detached calls cannot enable failure routing; a route flag blocks publication. The editor clears the policy and Failed connection when applying detached mode. Switching back before Apply restores the waited policy. Raw/API edits must remove the obsolete flag and edge explicitly.

A child whose failure was handled cannot be retried independently, even while its parent waits for a recovery Agent. Its inspection includes `handledFailure:{runId,executionId}` identifying the caller; the UI links its parent and omits the invalid retry action. Retry the current failed recovery step through its owning run. That retry retains the handled child and does not invoke it again. A deliberate later loop visit creates a separate child, and still consumes the caller's step budget. Failed routes inside Batch item paths stay within the group and may return through End; recovered items count as completed under both `all` and `collect`.

Route-enabled allocation and caller links commit together, and routing uses a savepoint. A persistence failure rolls back allocation or recovery and stops the caller. An engine restart observes committed child outcomes and does not route an already-handled call again.

Agent attempts and claim correction, detached runs, and polling Wait checks retain their existing behavior. The foreground Script opt-in above is the only automatic retry in this path; executor fallback remains outside this feature.

With [result routing](node-data.md), connect every configured success branch and the independent `failed` port. Result-routing or output-mapping errors stay terminal; they do not represent a failed operation and do not take Failed. Failure envelopes bypass success-result routing and mapping.

Background Scripts recover authenticated durable outcomes after restart. Their operation errors, offline timeouts and output-contract failures use the same Failed envelope. Cancellation and uncertain recovery evidence stay terminal. Use [explicit Script recovery](architecture.md#scripts-and-interruptions) before retrying uncertainty.
