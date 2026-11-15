---
title: Tools for agents
description: Let an Agent step call a Script or Fetch step as a tool during its turn.
---

# Agent tool calls

A tool edge lets an Agent step call a Script or Fetch step as a tool during its turn. Use it when an agent needs a fixed action several times in one turn, such as running the project's checks, and you want each call recorded and limited to an approved command.

Use an ordinary route instead when the step should run once, before or after the agent. Workflow steps cannot be tools.

## Connect a tool in the editor

1. Drag from the Agent's **Tools** handle, at the bottom of its card, to the **Tool** handle at the top of a Script or Fetch card. Or open the Agent's settings and pick the step under **Add a tool** in **Assignment**.
2. In the Agent's settings, **Tools** lists its tools. Set **Calls per attempt** and **Calls per execution**, or leave them blank for the defaults.
3. Save and publish.

**Add a tool** lists only Script and Fetch steps in the Agent's Batch or Parallel scope that have no routes. Tool edges are dashed. A step connected as a tool hides its route ports, because it runs only when called.

## See the calls in a run

In the run inspector, the Agent step lists its **Tool calls** with each call's attempt, start time and status. Select a call to see the step's input, output and error. The tool step's card shows how many calls finished or failed.

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

- **Name**: the target's label in lowercase, with `_` between words. A Script labelled `Run checks` becomes the tool `run_checks`.
- **Input schema**: the target's input contract. Calls whose arguments do not match are rejected before anything runs.
- **Call limits**: see [Limits](#limits). A call over a limit is rejected with an error that names the limit, and nothing runs.

Drafts with a problem still save and show diagnostics; publication rejects them. See [Publication rules](#publication-rules). Workflows without tool edges behave as before.

## Call a tool

The assignment lists the Agent's tools in `tools`, with each tool's `name`, `description`, `inputSchema` and call limits. Its `executionInstructions` explain how to call them.

Connected agents call MCP `call_work_tool` (shared API `work.callTool`) with the assignment's `workId`, their claim `token`, the tool `name` and `arguments`:

```json
{
  "workId": "…",
  "token": "…",
  "name": "run_checks",
  "arguments": { "target": "all" }
}
```

Only the current claim on that Agent execution can call its tools. Interlock rejects another worker's token, an expired claim, or the name of a tool on a different node.

### The response

| Field         | Meaning                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `callId`      | The call's ID. Pass it again to keep waiting for the same call.                                                                        |
| `runId`       | The call's child run.                                                                                                                  |
| `executionId` | The tool step's execution.                                                                                                             |
| `status`      | The call's status. `running` or `waiting` means it has not finished.                                                                   |
| `output`      | The step's output. Above 64 KiB you get `outputBytes` instead; read the output with `get_run_result`.                                  |
| `error`       | The step's error, if it failed.                                                                                                        |
| `blockedBy`   | `pause`, `resource` or `approval` when the call is waiting on one of them.                                                             |
| `calls`       | Calls so far in this claim attempt (`inAttempt`) and this Agent execution (`inExecution`), with `maxPerAttempt` and `maxPerExecution`. |

### Waiting for a call

The call waits up to `waitMs` for the step to finish. It never waits past the claim's remaining lease minus 5 seconds, so the agent can renew in time. Waiting does not renew the claim.

If `status` is still `running` or `waiting`, call again with the returned `callId`. A repeated `callId` never starts a second call.

### Managed sessions

Claude Code, Codex and Pi sessions that Interlock launches get their own `call_workflow_tool` tool instead of `call_work_tool`. It takes `name`, `arguments` and an optional `callId`, and returns the same response. Interlock handles each call against the claim it holds for the session, so the session needs no Interlock MCP server and never sees a claim token or other credential. Calls work without network access from the session.

- The prompt lists the tools and explains `call_workflow_tool` only when the tool is attached.
- Sessions at **Read only** get no tool, and their prompt does not list the tools.
- Under **Standard** and **Full access** the tool runs without an approval prompt. `call_workflow_tool` runs the Script or Fetch steps that the workflow's author attached to that Agent as tools. A Script runs in the Agent's checkout, with its own [server environment](https://github.com/dgca/interlock/blob/main/docs/architecture.md#scripts-and-interruptions) mode and no sandbox, using arguments the Agent chooses within the tool's input schema. Attaching a tool is the author's grant: under **Standard** there is no prompt per call, as for connected agents calling `call_work_tool`. This is the one way an Agent at **Standard** runs code without being asked. Imported Scripts still wait for their one-time approval. The tool step still waits for resources and pause holds.
- Claude Code sees them as `mcp__interlock_assignment__save_memory_note` and `mcp__interlock_assignment__call_workflow_tool`; Codex and Pi as `interlock_save_memory_note` and `interlock_call_workflow_tool`.
- The call limits apply as for `call_work_tool`.

A Codex session gets the tool only when its Codex supports dynamic tools and the thread is new; otherwise it runs as before and its prompt does not list the tools. See [Interlock's own tools](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md#interlocks-own-tools). Custom integrations receive the claim token in `$INTERLOCK_CLAIM_TOKEN` and can call `call_work_tool` over MCP with it.

Earlier releases gave managed sessions a tool-only credential in their prompt and in `INTERLOCK_WORK_ID` and `INTERLOCK_TOOL_TOKEN`. Built-in harnesses no longer receive it. `call_work_tool` still accepts it, and the stdio MCP bridge still fills in `workId` and `token` from those variables when a call omits them.

## How a call runs

Each call is a child run of the Agent's run. Its `toolCall` field links it to the calling execution and attempt: `workId`, `executionId`, `attempt`, `edgeId`, `name` and `callId`. The child run executes the one target step, in the same published version as the Agent, and ends with that step's result.

A call follows the same rules as a routed Script or Fetch:

- **Gates**: it waits at exclusive resources, pause holds and Script approval. A Script from an import or an agent-written draft waits for a person's approval before it runs.
- **Configuration**: workflow variables, the Script environment and input bindings apply. Bindings read the Agent's run: its input, earlier node outputs and Batch item input.
- **Working directory**: a call runs in the calling run's managed workspace, so it sees the Agent's uncommitted edits. It never creates a worktree of its own.
- **Records**: the call appears in the Agent execution's child runs, in run events (`tool.called`) and in the run inspector, even if the agent's attempt later fails.

Run lists, counts and reports do not count calls as runs. The tool step's executions appear in the report's step statistics.

Calls are not route steps and do not count toward `maxSteps`; the per-edge limits bound them. They report no model usage of their own; the agent's usage covers its turn.

## In-flight calls

| Event              | What happens to calls                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim attempt ends | Submission, reported failure, expiry or an external hold cancels the attempt's unfinished calls, including running ones. No call outlives the Agent's result. A later attempt cannot read an earlier attempt's call by `callId`. |
| Run cancelled      | The call is cancelled with its run tree, like any attached child. A running Script is stopped. A Fetch already sent may still complete remotely.                                                                                 |
| Paused             | A running call finishes. A new call waits until every applicable pause hold is released, and reports `blockedBy: "pause"`.                                                                                                       |
| Server restart     | A running Script or Fetch fails as `Service interrupted during … execution`, like a routed step. A call that had not started resumes if its claim is still active.                                                               |
| Resource conflict  | A call blocked by a resource its own Agent holds fails instead of waiting.                                                                                                                                                       |

## Simulate tool calls

In a [simulation](https://github.com/dgca/interlock/blob/main/docs/workflow-simulation.md) fixture, an Agent fixture can list the calls it makes:

```json
{
  "nodeId": "implement",
  "kind": "agent",
  "toolCalls": [{ "name": "run_checks", "arguments": { "target": "all" } }],
  "output": { "summary": "Done" }
}
```

- The simulated agent makes the calls in order, then returns its `output` or `error`.
- Each call takes the next unused `script` or `fetch` fixture for the tool's node, like a step inside a Batch item.
- A rejected call, for example over a limit or with invalid arguments, fails the simulation.
- Route coverage ignores tool edges. `coverage.tools` reports how many of the workflow's tools the case called and lists the uncalled edge IDs.

## Reference

### Limits

| Limit                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `maxCallsPerAttempt`      | Calls in one claim attempt. Default 10, at most 100.                         |
| `maxCallsPerExecution`    | Calls across every attempt of one Agent execution. Default 30, at most 1000. |
| Tools per Agent           | 20                                                                           |
| One tool's input contract | 8 KiB of JSON                                                                |
| The whole tool list       | 32 KiB of JSON                                                               |
| Tool name                 | Starts with a letter; at most 64 letters, digits and `_`; unique per Agent   |
| `waitMs`                  | Default 50 seconds, at most 10 minutes                                       |
| Inline `output`           | 64 KiB                                                                       |

`inspect_assignment_size` reports the tool list as the `tools` component.

### Publication rules

Publication rejects a tool edge when:

- its source is not an Agent, or its target is not a Script or Fetch;
- the target also has routes, uses result routing, or has a Failed route;
- the target is a background Script;
- the target's timeout is longer than the Agent's claim lease (`leaseSeconds`, 300 seconds by default), because a call blocks the agent's turn;
- the target is in a different Batch or Parallel scope from the Agent;
- the target names an exclusive resource the Agent also declares, since the Agent holds it during the call.
