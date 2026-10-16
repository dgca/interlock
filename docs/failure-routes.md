# Script and Fetch failure routes

Script and Fetch nodes stop their run on failure by default. Set `onFailure: "route"` and connect both `default` and `failed` edges to handle an operation failure inside the workflow. In the editor, enable **Route on failure** and connect **Failed** to a recovery step. No additional MCP tool is needed.

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

The default route receives the ordinary successful output. Failed receives this fixed envelope:

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

This option applies only to Script and Fetch nodes. Agent attempts and claim correction, Workflow calls, detached runs, and polling Wait checks retain their existing behavior. Automatic retry, backoff, and broader failure-route support remain outside this increment.
