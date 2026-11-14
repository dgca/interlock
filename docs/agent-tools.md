# Agent tool calls

A tool edge connects an Agent node to a Script or Fetch node. During its turn, the agent can call that step as a tool. Interlock runs the step with its declared command or request, timeout, working directory, resources and variables, records the call, and returns the step's output to the agent, which keeps working.

Use a tool edge when an agent needs a deterministic action several times inside one turn, such as running a project's checks, and you want each run recorded and limited to an approved command. Use ordinary routes when the step should run once, before or after the agent.

Child Workflow targets are not supported.

## Define a tool edge

A tool edge is an edge with `"kind": "tool"`. It is never followed as a route.

```json
{
  "id": "implement-run-checks",
  "source": "implement",
  "target": "run-checks",
  "kind": "tool",
  "maxCallsPerAttempt": 5,
  "maxCallsPerExecution": 20
}
```

- The tool's name comes from the target's label in lowercase with `_` between words: a Script labelled `Run checks` is the tool `run_checks`. Names must start with a letter, use at most 64 letters, digits and `_`, and be unique for each Agent node.
- The target's input contract is the tool's input schema. Calls whose arguments do not match are rejected before anything runs.
- `maxCallsPerAttempt` limits calls during one claim attempt (default 10, at most 100). `maxCallsPerExecution` limits calls across every attempt of one Agent execution (default 30, at most 1000). A call over a limit is rejected with an error that names the limit, and nothing runs.

Publication rejects a tool edge when:

- its source is not an Agent node, or its target is not a Script or Fetch node;
- the target is also connected by routes, uses result routing, or has a Failed route (a tool step runs only through calls);
- the target is a background Script;
- the target's timeout is longer than the Agent's claim lease (`leaseSeconds`, 300 seconds by default), because a call blocks the agent's turn;
- the target is in a different Batch or Parallel scope from the Agent;
- the target names an exclusive resource the Agent also declares, since the Agent holds it during the call.

Drafts with these problems still save and report diagnostics. Workflows without tool edges behave as before.

## Call a tool

An assignment whose Agent has tool edges lists them in `tools`, with each tool's `name`, `description`, `inputSchema` and call limits, and its `executionInstructions` explain how to call them. An Agent can have at most 20 tools.

Connected agents call MCP `call_work_tool` (shared API `work.callTool`) with the assignment's `workId`, their claim `token`, the tool `name` and `arguments`:

```json
{
  "workId": "…",
  "token": "…",
  "name": "run_checks",
  "arguments": { "target": "all" }
}
```

Only the current claim on that Agent execution can call its tools. Another worker's token, an expired claim, or the name of a tool on a different node is rejected. The response has `callId`, `runId`, `executionId`, `status`, the step's `output` (or `outputBytes` when it is larger than 64 KiB; read it with `get_run_result`), `error`, `blockedBy` (`pause`, `resource` or `approval`) and the call counts so far.

The call waits up to `waitMs` (default 50 seconds, at most 10 minutes), and never longer than the claim's remaining lease minus 5 seconds, so the agent can renew in time. Waiting does not renew the claim. If `status` is still `running` or `waiting`, call again with the returned `callId` to keep waiting for the same call. A repeated `callId` never starts a second call.

Managed sessions (Claude Code, Codex and others that Interlock launches) use the same MCP tool. Their assignment prompt lists the tools and gives the session the assignment ID and claim token for `call_work_tool` only; the host still renews and submits, and recorded transcripts redact the token. The harness needs the Interlock MCP server configured, as in [Connect a harness](connect-harness.md); without it, a managed session cannot call tools.

## How a call runs

Each call is a child run of the Agent's run, linked to the calling execution and claim attempt in its `toolCall` field (`workId`, `executionId`, `attempt`, `edgeId`, `name`, `callId`). The child run executes the one target step in the same published version as the Agent and ends with the step's result. It follows the same rules as a routed Script or Fetch:

- exclusive resources, pause holds and imported-Script approval: a call waits at the same boundaries, and a Script from an import or an agent-written draft waits for a person's approval before it runs;
- workflow variables, the Script environment and the working directory;
- input bindings, which read the Agent's run (its input, earlier node outputs and Batch item input);
- inspection: the call appears in the Agent execution's child runs, in run events (`tool.called`), in the run inspector and in reports, even if the agent's attempt later fails.

Tool calls are not route steps and do not count toward `maxSteps`; the per-edge limits bound them. They report no model usage of their own. The agent's own usage still covers its turn, and the call's run appears in reports alongside Batch item and Parallel branch runs.

## In-flight calls

- **Claim lost** (expiry, reported failure, external hold): a call that has not started its operation is cancelled with the reason `calling claim ended before the tool started`. A call that has started finishes and is recorded, but no worker receives its result. A later claim attempt cannot read an earlier attempt's call through `callId`. When the Agent execution fails with no attempts left, its unfinished calls are cancelled with it. Submitting a result does not stop a running call; it finishes and is recorded.
- **Run cancelled**: the call is cancelled with its run tree, like any attached child. A running Script is stopped; a Fetch already sent may still complete remotely.
- **Paused**: a call that is already running finishes. A new call waits until every applicable pause hold is released; the response reports `blockedBy: "pause"`.
- **Server restart**: a running Script or Fetch fails as `Service interrupted during … execution`, the same as a routed step. A call that had not started resumes when its claim is still active.
- A call blocked by a resource its own Agent holds fails instead of waiting.
