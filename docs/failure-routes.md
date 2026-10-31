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

`input` is the resolved input used by the failed operation, after any input bindings. `output` is its returned JSON value, or null when no result is available. Fetch HTTP rejection retains the response with status, headers, and body here. Output-contract failures retain the rejected value. `message` is diagnostic text and can include process stderr; branch on `category` rather than parsing it. Each execution ID identifies one operation. There are no automatic attempts or child references for these node kinds.

| Category    | Routed failures                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `execution` | Script process errors, timeout, invalid JSON or output size limits; Fetch network errors, timeout, response size limits or invalid declared JSON |
| `http`      | Fetch receives a non-2xx status while `failOnHttpError` is true                                                                                  |
| `output`    | Returned data violates the node's success output contract                                                                                        |

`onFailure: "fail"` and omission retain terminal behavior. `failOnHttpError: false` still accepts non-2xx responses through the default route, subject to its output contract.

The success output contract does not apply to the failure envelope. The destination validates its own input, or selects fields with ordinary input bindings, such as `error.message`. A destination contract mismatch fails that step. The editor suggests the fixed envelope when it is the only incoming shape. Original workflow and Batch item input remain accessible through their existing bindings.

The operation stays `failed` in history, with its error, available raw output, completion time, and `port: "failed"`. The run can continue and finish `completed`. Run inspection identifies the Failed route, and the testbench can check a recorded failed route. Earlier-node bindings select only completed executions, so recovery should read the incoming envelope. A completed recovery run cannot be explicitly retried.

Input-contract errors, missing input bindings, invalid Fetch request resolution, step limits, and graph errors remain terminal. Cancellation never follows recovery. A server interruption still fails pending Script and Fetch operations with an instruction to inspect external effects before explicitly retrying. An operation timeout can leave uncertain external effects too; recovery is not proof that an external write did not happen. The engine never automatically replays it.

Inside a Batch, both routes must stay in the item scope and reach End. Routing directly to that Batch's End returns the envelope as the item's successful result. Unhandled item failures retain the Batch's `all` or `collect` policy. Recovery loops outside Batch item paths count against the existing step limit.

Incomplete routes remain saveable but block publication. Disabling the editor switch removes its Failed connection when settings are applied. With Raw JSON or MCP edits, remove the `failed` edge explicitly when removing `onFailure: "route"`. Publish a new version to change future runs; existing versions retain their behavior.

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

`input` is the resolved original call input after bindings. `error.child.executionId` is the child's last execution ID, or null if unavailable. Use `get_run` or targeted result reads to inspect that child. History, prompts and work tokens are not copied into the failure value. For category `output`, `output` contains the rejected successful child result, which is also retained on the caller execution. For category `child`, it is null.

Caller input or binding errors, invalid target workflow input, invalid pins/configuration, caller step limits and persistence errors stay terminal. Target input is validated before allocating a route-enabled child. After valid dispatch, a failed child is a routable outcome regardless of its internal cause, including its own contract/step-limit failure or a Script/Fetch interruption recorded at restart. Handling that outcome never replays the child's external effects.

Parent cancellation and independently cancelled children never follow Failed. Detached calls cannot enable failure routing; a route flag blocks publication. The editor clears the policy and Failed connection when applying detached mode. Switching back before Apply restores the waited policy. Raw/API edits must remove the obsolete flag and edge explicitly.

A child whose failure was handled cannot be retried independently, even while its parent waits for a recovery Agent. Its inspection includes `handledFailure:{runId,executionId}` identifying the caller; the UI links its parent and omits the invalid retry action. Retry the current failed recovery step through its owning run. That retry retains the handled child and does not invoke it again. A deliberate later loop visit creates a separate child, and still consumes the caller's step budget. Failed routes inside Batch item paths stay within the group and may return through End; recovered items count as completed under both `all` and `collect`.

Route-enabled allocation and caller links commit together, and routing uses a savepoint. A persistence failure rolls back allocation or recovery and stops the caller. An engine restart observes committed child outcomes and does not route an already-handled call again.

Agent attempts and claim correction, detached runs, and polling Wait checks retain their existing behavior. Automatic retry, backoff, and executor fallback remain outside this feature.

With [result routing](node-data.md), connect every configured success branch and the independent `failed` port. Result-routing or output-mapping errors stay terminal; they do not represent a failed operation and do not take Failed. Failure envelopes bypass success-result routing and mapping.
