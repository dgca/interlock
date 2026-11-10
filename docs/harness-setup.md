---
title: Connect your harness
description: Configure Interlock to launch installed local agents automatically.
---

# Connect your harness

A harness configuration lets Interlock launch assignments through installed Claude Code, Codex, Pi, or a custom harness. Install and authenticate it through its native setup first. Interlock does not manage its account credentials.

## Configure automatic execution

Open **AI Settings → Harnesses**. Choose **Configure** on a detected configuration, or **Add configuration** for another one. Detection checks the executable and its version; it does not verify authentication or model access.

Set the working directory for the project and choose a default model, or retain **Use CLI default**. Select **Read only**, **Standard**, or **Full access** permissions as appropriate. Full access allows file changes and commands without routine approval stops. Save and enable the configuration. New configurations start disabled.

In the workflow's settings, select the configuration as **Default Agent executor**. An individual Agent step can inherit that choice or use another executor. Save the draft and publish before starting a new run.

## Follow the work

Interlock launches ready assignments while its engine is running. Open the run inspector to follow progress and results. No open agent conversation is required.

Permission requests, questions, replacement-model requests, and recovery checks appear in **Runs → Needs attention**. Open the relevant assignment and resolve its displayed request. If a session was interrupted, confirm its external work stopped before retrying.

Harness tools, skills, and provider access come from its local setup. Agent permission settings do not restrict Script or Fetch steps.

To work from a conversation you already control, [connect with MCP](connect-mcp.md) instead. See [Troubleshooting](troubleshooting.md) for waiting assignments.
