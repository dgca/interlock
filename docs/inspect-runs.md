---
title: Inspect and manage runs
description: Follow progress, inspect step data, and resolve waiting or failed work.
---

# Inspect and manage runs

Open **Runs** and select a run to see its progress. **Active** contains unfinished runs. **History** contains completed, failed, and cancelled runs. You can also open a workflow's **Runs** tab to focus on that workflow.

## Follow the work

The run inspector shows the executed path and current status. Select a step execution to inspect its input, output, and any error. A repeated step can have several executions, so check which visit you are reading.

Read the waiting reason before taking action. A run may need an agent, an external answer, a timer, or a resource another step holds. Waiting does not always mean something is wrong.

For automatically launched agents, **Runs → Needs attention** brings together permission requests, questions, model selection, recovery checks, and runs stopped by their [budget](run-budgets.md). Open the affected run and resolve the displayed request. See [Run agents](agents.md).

## Inspect a managed Agent

Select the Agent step and use **Conversation** to read captured messages and tool activity. The history controls stay visible at the bottom of the conversation. Use the attempt selector to inspect earlier attempts. **Details** contains session information, prompt/context, execution data, and transcript storage limits.

For a supported active session, enter guidance in **Message agent**. Accepted delivery means the harness received the message. Unknown delivery requires a status check and is never resent automatically. Guidance does not approve a pending permission request or answer a question.

Transcripts have automatic capacity and age limits, independently of run-history retention. See [transcripts and operator messages](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md#transcripts-and-operator-messages) for supported harnesses, storage safeguards, and CLI/MCP operations.

## Pause, cancel, or retry

Pause a workflow to stop new work at execution boundaries. Work already running can finish. Resuming a workflow clears its workflow-scoped pauses. Library-wide pauses can still block it.

**Cancel run** stops the run and its attached children. Independently started child runs continue. Use **Cancel run tree** and explicitly include detached descendants when those runs must stop too.

For a failed run, inspect the error before choosing **Retry failed step**. Retrying can repeat file changes or service calls. Confirm any uncertain external process has stopped before retrying.

Continue with [Troubleshooting](troubleshooting.md) for recovery guidance or [Reports](reports.md) to compare behavior across runs.
