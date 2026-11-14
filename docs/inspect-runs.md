---
title: Inspect and manage runs
description: Follow progress, inspect step data, and resolve waiting or failed work.
---

# Inspect and manage runs

The run inspector shows what a run did, what it is waiting for, and what each step received and returned. Use it to follow progress and to decide what to do when a run stops.

Open **Runs** and select a run. **Active** lists unfinished runs. **History** lists completed, failed and cancelled runs. A workflow's **Runs** tab shows only that workflow's runs.

## Follow the work

The inspector shows the path the run took and its current status. Select a step execution to see its input, output and any error. A step that repeats has several executions, so check which visit you are reading.

Read the waiting reason before you act. A run may be waiting for an agent, an external answer, a timer, or a resource another step holds. Waiting does not always mean something is wrong.

For agents that Interlock launches, **Runs → Needs attention** collects the requests that need a person:

- permission requests and questions
- model selection
- recovery checks
- runs blocked by their [budget](run-budgets.md)

Open the affected run and resolve the request shown. See [Run agents](agents.md).

## Inspect a managed Agent

Select the Agent step and open **Conversation** to read the captured messages and tool activity. The history controls stay at the bottom of the conversation. Use the attempt selector to read earlier attempts.

**Details** shows the session, the prompt and context, execution data, and transcript storage limits.

To guide a supported active session, type in **Message agent**:

- Accepted delivery means the harness received the message.
- Unknown delivery needs a status check. Interlock never resends it automatically.
- Guidance does not approve a pending permission request or answer a question.

Transcripts have their own capacity and age limits, separate from run-history retention. See [transcripts and operator messages](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md#transcripts-and-operator-messages) for supported harnesses, storage safeguards, and CLI and MCP operations.

## Pause, cancel, or retry

- Pause a workflow to stop new work at execution boundaries. Work already running can finish. Resuming the workflow clears its workflow-scoped pauses; library-wide pauses can still block it.
- **Cancel run** stops the run and its attached children. Child runs started as independent (detached) runs keep going.
- **Cancel run tree** also stops detached descendants when you explicitly include them.
- **Retry failed step** runs a failed step again. Inspect the error first: a retry can repeat file changes or service calls. Confirm that any uncertain external process has stopped before you retry.

## Read a large run from the CLI or MCP

`interlock run RUN_ID` and MCP `get_run` return the full inspection while it is under 64 KiB. Above that, the response is shortened:

- The workflow definition and large fields are left out. IDs, status and timestamps always stay.
- Long errors are cut short, and child runs are listed as references.
- If it is still too large, only the most recent executions, events and descendants are kept.

`omitted` lists what was left out and how to read it, and `compacted` gives the full size. Read one step's input, output or result with MCP `get_run_result`. For the complete response, add `--full` to the CLI command or `full: true` to `get_run`:

```sh
interlock run RUN_ID --full
```

The run page in the browser always loads everything.

## Next

- [Troubleshooting](troubleshooting.md) for recovery guidance.
- [Reports](reports.md) to compare behavior across runs.
