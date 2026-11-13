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

## Protocol support

Interlock serves the MCP `2025-11-25` revision and the older revisions its SDK accepts (`2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`). It does not yet serve the stateless `2026-07-28` revision. Clients that support both revisions fall back to the `initialize` handshake over HTTP and stdio, and the transport tests check this with a current client. Clients that support only `2026-07-28` cannot connect.

The HTTP endpoint keeps no sessions: it answers `POST` requests without an `Mcp-Session-Id` and rejects `GET` with `405`. Interlock uses none of the features that `2026-07-28` deprecates or removes: Roots, Sampling, Logging, resource subscriptions, server-initiated requests, tasks, or the HTTP+SSE transport. Missing resources return `-32602`, as the new revision requires.

These `2026-07-28` requirements are not yet met. Each needs a `2026-07-28` server implementation, which the `@modelcontextprotocol/sdk` 1.x package used by Interlock does not provide. Adding them keeps the `initialize` handshake for older clients:

- `server/discover` returns `-32601` (method not found) instead of the supported versions, capabilities and server identity.
- Requests that declare `2026-07-28` in `MCP-Protocol-Version` or `_meta` receive an `HTTP 400` naming the supported versions, not an `UnsupportedProtocolVersionError` (`-32022`).
- Results omit `resultType` and the `io.modelcontextprotocol/serverInfo` identity in `_meta`.
- `tools/list`, `resources/list`, `resources/read` and `resources/templates/list` omit `ttlMs` and `cacheScope`.
- HTTP requests are not checked for the `Mcp-Method` and `Mcp-Name` headers.
- `subscriptions/listen` is not served. The tool and resource lists of a running server do not change, so clients do not need change notifications.
