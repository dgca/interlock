---
title: Connect your harness
description: Configure Interlock to launch installed local agents automatically.
---

# Connect your harness

A harness configuration lets Interlock launch assignments through installed Claude Code, Codex, Pi, or a custom harness. Install and authenticate it through its native setup first. Interlock does not manage its account credentials.

## Configure automatic execution

Open **AI Settings → Harnesses**. Choose **Edit defaults** to expand a harness row. Set the default model, thinking effort, and permissions. In **Advanced settings**, set the working directory or executable path if needed. Save the defaults, then enable the harness once it is detected. Detection checks the executable and its version. Authentication and model access are checked when the harness runs.

Choose the harness in **Workflow settings → Default Agent executor** or in an Agent node's **Execution → Executor**. Use **Add integration** for a custom harness. For reusable model settings or ordered fallbacks, [create an Agent preset](managed-executors.md#model-aliases). Save the draft and publish before starting a new run.

## Follow the work

Interlock launches ready assignments while its engine is running. Open the run inspector to follow progress and results. No open agent conversation is required.

Permission requests, questions, replacement-model requests, and recovery checks appear in **Runs → Needs attention**. Open the relevant assignment and resolve its displayed request. If a session was interrupted, confirm its external work stopped before retrying.

Harness tools, skills, and provider access come from its local setup. Agent permission settings do not restrict Script or Fetch steps.

To work from a conversation you already control, [connect with MCP](connect-mcp.md) instead. See [Troubleshooting](troubleshooting.md) for waiting assignments.
