# Agent tool calls

A tool edge connects an Agent node to a Script or Fetch node. During its turn, the agent can call that step as a tool. Interlock runs the step with its declared command or request, timeout, working directory, resources and variables, records the call, and returns the step's output to the agent, which keeps working.

Use a tool edge when an agent needs a deterministic action several times inside one turn, such as running a project's checks, and you want each run recorded and limited to an approved command. Use ordinary routes when the step should run once, before or after the agent.

Child Workflow targets are not supported.

## Connect a tool in the editor

Drag from an Agent's **Tools** handle, at the bottom of its card, to the **Tool** handle at the top of a Script or Fetch card, or open the Agent's settings and choose the step under **Add a tool** in **Assignment**. Only Script and Fetch steps in the Agent's Batch or Parallel scope that have no routes are listed. Tool edges are dashed. A step connected as a tool hides its route ports, because it runs only through calls. **Tools** in the Agent's settings lists its tools with **Calls per attempt** and **Calls per execution**; leave a limit blank to use the default.

In the run inspector, the Agent step lists its **Tool calls** with each call's attempt, start time and status. Select one to inspect the step's input, output and error. The tool step's card shows how many calls finished or failed.

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

An assignment whose Agent has tool edges lists them in `tools`, with each tool's `name`, `description`, `inputSchema` and call limits, and its `executionInstructions` explain how to call them. An Agent can have at most 20 tools; each tool's input contract can be at most 8 KiB of JSON and the whole list at most 32 KiB. `inspect_assignment_size` reports the list as the `tools` component.

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

Managed sessions (Claude Code, Codex and others that Interlock launches) never receive the claim token. Each claim attempt has a tool-only credential derived from its claim: `call_work_tool` accepts it as `token`, every other operation (submit, fail, renew, hold) rejects it, and it stops working when the attempt ends. Interlock sets `INTERLOCK_WORK_ID` and `INTERLOCK_TOOL_TOKEN` in the Claude Code and Codex session environment, and the stdio MCP bridge (`interlock mcp`) fills in `workId` and `token` from them when a call omits them. Sessions connected over HTTP MCP cannot read that environment, so the assignment prompt also gives the work ID and the tool-only credential; Interlock redacts the credential from its transcripts. The harness needs the Interlock MCP server configured, as in [Connect a harness](connect-harness.md); without it, a managed session cannot call tools.

## How a call runs

Each call is a child run of the Agent's run, linked to the calling execution and claim attempt in its `toolCall` field (`workId`, `executionId`, `attempt`, `edgeId`, `name`, `callId`). The child run executes the one target step in the same published version as the Agent and ends with the step's result. It follows the same rules as a routed Script or Fetch:

- exclusive resources, pause holds and imported-Script approval: a call waits at the same boundaries, and a Script from an import or an agent-written draft waits for a person's approval before it runs;
- workflow variables, the Script environment and the working directory;
- input bindings, which read the Agent's run (its input, earlier node outputs and Batch item input);
- the working directory: a call runs in the calling run's managed workspace, so it sees the Agent's uncommitted edits; it never creates a worktree of its own;
- inspection: the call appears in the Agent execution's child runs, in run events (`tool.called`) and in the run inspector, even if the agent's attempt later fails. Run lists, counts and reports do not count calls as runs; the tool step's executions appear in the report's step statistics.

Tool calls are not route steps and do not count toward `maxSteps`; the per-edge limits bound them. They report no model usage of their own. The agent's own usage covers its turn.

## In-flight calls

- **Claim attempt ends** (submission, reported failure, expiry, external hold): the attempt's unfinished calls are cancelled, including a call whose Script or Fetch is running, so no call outlives the Agent's result. A later claim attempt cannot read an earlier attempt's call through `callId`.
- **Run cancelled**: the call is cancelled with its run tree, like any attached child. A running Script is stopped; a Fetch already sent may still complete remotely.
- **Paused**: a call that is already running finishes. A new call waits until every applicable pause hold is released; the response reports `blockedBy: "pause"`.
- **Server restart**: a running Script or Fetch fails as `Service interrupted during … execution`, the same as a routed step. A call that had not started resumes when its claim is still active.
- A call blocked by a resource its own Agent holds fails instead of waiting.

## Simulate tool calls

In a [simulation](workflow-simulation.md) fixture, an Agent fixture can list `toolCalls: [{"name": "run_checks", "arguments": {...}}]`. The simulated agent makes those calls in order before it returns its `output` or `error`. Each call takes the next unused `script` or `fetch` fixture for the tool's node, like a step inside a Batch item. A call that is rejected, for example over a limit or with invalid arguments, fails the simulation. Route coverage ignores tool edges; `coverage.tools` reports how many of the workflow's tools the case called and lists the uncalled edge IDs.
