---
title: Run agents
description: Choose between an existing agent conversation and automatic local execution.
---

# Run agents

An Agent step creates an assignment with instructions, input, and an expected result. An executor claims that assignment, performs the work, and submits a JSON result. Interlock validates the result before moving the run forward.

Choose how you want that work to run:

- **An existing conversation.** [Connect with MCP](connect-mcp.md) to use Interlock from Codex, Claude Code, or another MCP client. You direct the agent and ask it to start or continue runs. Starting a run makes assignments available; it does not launch a connected agent session.
- **Automatic execution.** [Connect your harness](harness-setup.md) so Interlock launches an installed local agent when work becomes ready. No open conversation is required, but Interlock must remain running.

You can choose a default executor for a workflow and override individual Agent steps. Both modes use the same workflow contracts and recorded run history.

For unfinished work, continue the existing run. Read its waiting reason before starting another. See [Troubleshooting](troubleshooting.md) if progress stops.
