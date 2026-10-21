# Simulate workflow contracts and routes

Use fixture simulation to check a workflow's control flow without model calls, shell commands or network requests. Each saved case supplies ordered Agent results and Script/Fetch outcomes. Interlock runs the published graph in an isolated, in-memory engine with the normal input/output contracts, bindings, routes, retry policy and step limit.

A passed simulation means the supplied outcomes took the expected routes and satisfied the case assertions. It does not establish prompt quality, script correctness, real API behavior, context isolation or implementation quality. Simulations are separate from [live comparisons](workflow-testbench.md) and never become live baselines.

## Save fixtures

Add `fixtures` to a case through `save_test_suite`, the shared suite API, or `interlock test-suite`. For example, this case expects an Agent to return an object with a numeric `answer`. It first exercises rejection of an invalid value, then corrects the result using the same claim:

```json
{
  "action": "create",
  "workflowId": "WORKFLOW_ID",
  "content": {
    "name": "Contract checks",
    "cases": [
      {
        "id": "correct-result",
        "name": "Correct a rejected result",
        "input": {},
        "fixtures": [
          {
            "nodeId": "agent",
            "kind": "agent",
            "output": { "answer": "wrong" },
            "expectRejection": true
          },
          {
            "nodeId": "agent",
            "kind": "agent",
            "output": { "answer": 42 }
          }
        ],
        "assertions": [
          {
            "kind": "output",
            "path": "answer",
            "operator": "equals",
            "expected": 42
          }
        ]
      }
    ]
  }
}
```

Save this JSON as `suite.json` and run `interlock test-suite @suite.json`. MCP `save_test_suite` wraps the same object in `request`. `test-suite` also accepts `update`, `get` and `list` actions using the existing suite contracts. The workflow and named node must exist; its published output contract must actually reject the first fixture.

Every fixture supplies `nodeId`, `kind` and exactly one of `output` or `error`. Output may be JSON null. `error` is a nonempty string of at most 512 characters. Use `expectRejection: true` only with an Agent output. An unexpectedly accepted candidate fails the simulation before submission. An unexpected rejection fails the simulation with bounded contract diagnostics. Explicit Agent errors use the published failure/retry budget.

Script output is arbitrary JSON subject to the node's contract. Fetch output must be `{status, headers, body}`, with an integer HTTP status from 100 through 599, a string-valued headers object and a JSON body. HTTP status checks and Script/Fetch failure routes still apply. Error fixtures represent executor failures. These fixtures replace both JavaScript and legacy Bash scripts, including scripts believed to be read-only.

Fixtures form one ordered sequence across all nodes. Repeated visits, rejected candidates and retries each consume another entry. A missing fixture, wrong order or unused entries fails the simulation. A nonexistent node or mismatched kind is reported before execution. Fixtures are optional in saved cases and are ignored by live comparisons, which still use real executors and external actions.

## Run and inspect

Use `workflow_simulation` with this MCP request:

```json
{
  "request": {
    "action": "run",
    "suiteId": "SUITE_ID",
    "suiteRevision": 1,
    "caseId": "correct-result",
    "version": 1,
    "requestId": "contract-check-001"
  }
}
```

The shared API is `testbench.simulation`. CLI `interlock simulation @request.json` takes the inner `request` object. All actions use this shared operation. `run` returns immediately. Reusing identical arguments and `requestId` returns the existing report, including after suite edits or restart. Conflicting reuse rejects. Use a new request ID for a new attempt.

Poll `{"action":"get","id":"contract-check-001"}` until `state` is terminal. Reports use `mode: "simulation"` and states `running`, `passed`, `failed`, `unsupported`, `cancelled` or `interrupted`. Reports include substitution receipts, compact execution traces, assertion results and unsupported reasons. Each collection has its own exact total, `nextOffset` and `truncated` flag; `offset` and `limit` apply to all four collections. Default limit is 20, maximum 100. Continue at each non-null offset to read the remaining entries. Trace node IDs and ports longer than 256 characters are truncated and flagged; execution IDs link traces to substitution receipts. Fixture values, arbitrary inputs/outputs, prompt bodies and claim tokens are omitted.

Use `{"action":"capture","id":"contract-check-001"}` to read the immutable definition, case, current saved prompts and final output. This explicit read can contain sensitive values. The capture pins the published workflow version and saved case revision. Saved prompts reflect the library at simulation start, not publication time. Later suite edits, draft changes or version cleanup do not alter the report.

Use `{"action":"list","workflowId":"WORKFLOW_ID"}` for paginated summaries, or `{"action":"cancel","id":"contract-check-001"}` to stop a running simulation. Cancellation is terminal; it does not resume later. Shutdown or service restart marks unfinished simulations interrupted. Start a new request to rerun them. Simulations create no live runs, work requests or executor usage records in the application database. Deleting the workflow removes simulation history after active simulation cleanup finishes. Portable workflow bundles exclude suites and simulations.

## Supported scope and bounds

The initial version supports flat graphs with Entry, Exit, Agent, Script, Fetch, Condition and Switch nodes. It rejects all Workflow invocations, including detached calls, Batch nodes, Wait nodes and Agent unclaimed timeouts before executing anything, even if an unsupported node would not be visited. It never falls back to live execution. Use ordinary testbench comparisons to test those behaviors.

The published `maxSteps` limit applies, with its existing maximum of 1,000. Each case permits at most 1,000 fixtures within the existing 1 MiB suite limit. Input remains limited to 64 KiB. Current saved prompts are limited to 64 entries and 1 MiB. At most four simulations may be active, and each simulation has a 10,000-turn driver limit. Synthetic capabilities and sessions satisfy claims internally; simulations do not test whether a real executor meets those requirements. No UI suite editor or simulation dashboard is included.
