---
title: Connect with MCP
description: Use Interlock from an existing Codex, Claude Code, or other MCP client session.
---

# Connect with MCP

[Start Interlock](installation.md), then open **Connect with MCP** in its sidebar. The dialog provides configuration for the running server. Use its address if you selected a custom port.

The default endpoint is `http://127.0.0.1:4310/mcp`, using **Streamable HTTP**. These instructions connect a client on the same computer as Interlock.

## Codex

Add this entry to `~/.codex/config.toml`:

```toml
[mcp_servers.interlock]
url = "http://127.0.0.1:4310/mcp"
```

When replacing a stdio entry, remove its `command`, `args`, and bridge environment settings. Codex's [MCP documentation](https://developers.openai.com/codex/mcp/) describes the client configuration.

## Claude Code

Run:

```sh
claude mcp add --transport http --scope user interlock http://127.0.0.1:4310/mcp
```

If that user-scoped entry already exists, remove it first with `claude mcp remove --scope user interlock`. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for client options.

## Run work from your conversation

Restart or reconnect your client after configuration and enable Interlock's tools in its approval settings. For example, ask:

```text
Find the Interlock workflow "Repository review" and inspect its input contract.
Ask me for the required input, then execute it through Interlock.
Complete its assignments and pause if you need a human decision.
```

Replace the workflow name with one in your library.

For a run already waiting, use **Copy instructions for agent** in the inspector and paste those instructions into your conversation. They identify the existing run. Connecting alone does not claim assignments. The agent must complete the work and submit a result before the run can advance.

Keep Interlock running and continue the same run until it completes or reports a blocker. See [Troubleshooting](troubleshooting.md) if the client cannot connect or work remains waiting.

## Clients that require stdio

Choose **Legacy stdio** in the connection dialog. For a global installation, the command is `interlock` with arguments `["mcp"]`. This bridge still needs the running engine. Copy the dialog's absolute-path configuration if your client cannot find the executable.

To launch agents automatically instead, [connect your harness](harness-setup.md).
