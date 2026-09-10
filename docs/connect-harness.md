# Connect a harness

## Start Interlock

```sh
npm install -g @type_of/interlock
interlock
```

Or run without a global installation:

```sh
npx -y @type_of/interlock@latest
```

Keep this process running and open [Interlock](http://127.0.0.1:4310). **Connect with MCP**, also available through **Connect an agent** in a run, provides the endpoint URL and client configuration.

Use Streamable HTTP at `http://127.0.0.1:4310/mcp`. The UI, engine, and MCP tools run in the same process and package version. After upgrading, restart Interlock at the same address and reconnect your client if needed. Keep the existing URL configuration; no separate bridge installation is needed.

For a custom port, copy the URL from the connection dialog. These instructions apply to clients running on the same computer as Interlock. The service listens on loopback without authentication and must not be exposed through a public tunnel.

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.interlock]
url = "http://127.0.0.1:4310/mcp"
```

If replacing a stdio entry, remove its `command`, `args`, and bridge environment settings. See the [Codex MCP guide](https://developers.openai.com/codex/mcp).

## Claude Code

Run:

```sh
claude mcp add --transport http --scope user interlock http://127.0.0.1:4310/mcp
```

If an `interlock` entry already exists, remove it with `claude mcp remove --scope user interlock` before adding the HTTP entry. See the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

For Claude Desktop, use the [stdio fallback](#stdio-fallback).

## OpenCode

Merge this into `opencode.json`, replacing any existing local Interlock entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "interlock": {
      "type": "remote",
      "url": "http://127.0.0.1:4310/mcp",
      "enabled": true,
      "oauth": false
    }
  }
}
```

See the [OpenCode MCP guide](https://opencode.ai/docs/mcp-servers/).

## Other clients

Choose **Streamable HTTP** and enter `http://127.0.0.1:4310/mcp`. No command, arguments, or authentication are required. The endpoint returns JSON responses; it does not provide a standalone SSE notification stream or retain transport sessions.

Restart or reconnect your harness after changing configuration. Enable Interlock's tools in its approval settings. Interlock does not modify harness configuration for you.

## Stdio fallback

Existing stdio configurations remain supported. Select **Use legacy stdio transport** in the connection dialog for client-specific snippets. For globally installed copies, the command is `interlock` with arguments `["mcp"]`. The harness launches this bridge, which connects to the running engine.

For Claude Desktop, merge this into its MCP configuration:

```json
{
  "mcpServers": {
    "interlock": { "command": "interlock", "args": ["mcp"] }
  }
}
```

If your client cannot find the global command, select **Use absolute paths** in the dialog. For a server launched through npx, this fallback points to its cached installation. Regenerate stdio configuration when those paths change. Prefer HTTP for clients that support it.

Set the bridge environment variable `INTERLOCK_URL` when using another port. This value is the engine address, such as `http://127.0.0.1:4400`, without `/mcp`. The connection dialog includes the correct environment settings.

## Development configuration

A server started with `pnpm dev` or `pnpm start` exposes the same `/mcp` endpoint. Use its engine port, normally 4310, rather than the Vite UI port 5173. HTTP configuration has no checkout or Node paths.

The development stdio fallback uses absolute paths to the current Node installation, TypeScript loader, and checkout. Regenerate that fallback if you move the checkout or change Node installations.

## Complete a run

Ask the harness to find a workflow by name or description with `list_workflows`, inspect it with `get_workflow`, and use its ID and input contract. If several workflows match, identify the intended one before starting a run.

With the workflow selected, ask it to complete the run through Interlock:

```text
Start Interlock workflow WORKFLOW_ID with the supplied input.
Use list_work for the root run, including its child runs.
Claim assignments with your actual capabilities.
Perform each assignment using its prompt, input, and context policy.
Submit JSON matching its output schema.
Continue until the root run completes or fails.
```

Starting a run in the UI does not launch an agent. When assignments are available, the run inspector shows **Waiting for an agent**, including work inside Batches and nested workflows. Use **Copy instructions for agent** and paste the instructions into your connected agent conversation. The instructions include the existing run ID. **Connect an agent** opens the connection configuration; connecting alone does not pick up assignments.

`start_run` returns a persisted run. `list_work` includes descendants of the requested run, including Agent assignments in Batch item paths and nested Batches. Item run inspection resolves the published graph and identifies the owning Batch through `batchNodeId`. A claim returns its token and expiry. Keep the token for `submit_result`, `renew_claim`, or `fail_work`. Inspect `get_run` to distinguish a completed run from one waiting on claimed work or scripts.

If execution will exceed the lease, call `renew_claim` before it expires. If a submission loses its response, submit the identical result again using the same token. If a claim has expired, discover and claim available work again. Do not submit through another worker's claim.

A fresh-context assignment includes `executionInstructions` for a fresh session or an isolated subagent without inherited conversation history. If the caller cannot provide isolation, these instructions require it to leave the assignment unclaimed and give the user a ready-to-paste prompt containing the existing root run and assignment IDs. The prompt resumes the existing run instead of starting another one. Interlock does not create sessions or verify isolation. Do not declare `freshContext: true` merely because the assignment has a focused prompt. Declare required tools and skills only when the executor can actually use them.

## Author definitions through MCP

Use `create_workflow` with a definition containing flat `nodes` and `edges` arrays. `update_workflow` accepts that definition as `draft`, together with the current `draftRevision` from `get_workflow`. Pass the definition itself, not an exported workflow record. Incomplete drafts can be saved; `publish_workflow` validates the complete graph. Set `cascade: true` to advance and republish transitive dependents, including archived workflows. Unpublished dependent definition edits, dependency cycles, or validation failures reject the entire cascade. Existing runs retain their published pins. See [cascade publication](../README.md#publish-a-shared-workflow-and-its-dependents) for scope and draft behavior.

Use `kind: "batch"` for repeated work. Give each direct child a `batchId` matching its owner. The Batch has an `item` source port into the group and a `complete` source port into the continuation. Return every item branch to its owner with `targetHandle: "end"`. There is no nested body definition. Set `language: "javascript"` explicitly for JavaScript scripts; omitting it selects Bash. See [workflow definitions and graph scopes](architecture.md#workflow-definitions) and [Fetch configuration](fetch.md).

## MCP tools

| Tools                                                    | Purpose                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `list_workflows`, `get_workflow`                         | Find workflows and inspect drafts, contracts, and published version numbers. |
| `create_workflow`, `update_workflow`, `publish_workflow` | Author a draft and publish an immutable version.                             |
| `start_run`, `get_run`                                   | Start a published version and inspect its execution and descendants.         |
| `list_work`, `claim_work`                                | Discover available assignments and reserve one with declared capabilities.   |
| `submit_result`, `fail_work`, `renew_claim`              | Complete or fail claimed work, or extend its lease.                          |
| `cancel_run`, `retry_run`                                | Cancel unfinished work or explicitly retry a failed run.                     |

`list_work` returns available assignments, not claimed work. An empty list does not mean the execution has completed. Use `get_run` to inspect its status and descendant assignments. When given an existing run ID, resume it rather than calling `start_run` again.

`retry_run` retries the failed step of a failed run. Inspect its error first, since Script and Fetch retries can repeat external side effects. Failed Batch retries preserve successful items. Retry a failed parent when a child belongs to a terminal parent. Completed and cancelled runs cannot be retried. The CLI equivalent is `interlock retry RUN_ID`.

Archive, restore, and permanent deletion are available in the UI; these operations are not exposed as MCP tools. To browse execution history outside the UI, use `interlock runs`.

## Diagnose a connection

Check the service first:

```sh
curl http://127.0.0.1:4310/health
interlock workflows
```

If both succeed but the harness cannot execute Interlock tools, check its endpoint URL, transport, and tool approval settings. HTTP clients must use `/mcp` with Streamable HTTP. Opening that URL in a browser sends GET and returns 405; use an MCP client to initialize and call tools.

For stdio, inspect the bridge startup settings. The adapter prints protocol messages to stdout and diagnostics to stderr. Do not wrap its command in a script that prints startup banners to stdout.

From a source checkout, the automated MCP transport test runs without a model:

```sh
pnpm test
```

Transport tests cover HTTP and stdio initialization, tool discovery, work discovery, claims, results, and Batch retries. HTTP checks also cover malformed requests, protocol headers, concurrent clients, and local-access restrictions. The package check, `pnpm build && pnpm test:package`, exercises global and npx startup from a local tarball, then submits a persisted claim after a restart using the same HTTP endpoint.

The optional `scripts/codex-smoke.ts` check invokes the installed Codex CLI with a real account and a local text task. It creates a workflow in the running engine and consumes model usage. Its result depends on the client's authentication and tool approval settings; it is separate from the automated transport tests.
