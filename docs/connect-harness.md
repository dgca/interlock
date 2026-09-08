# Connect a harness

## Start Interlock

```sh
npm install -g @type_of/interlock
interlock
```

Keep this process running and open [Interlock](http://127.0.0.1:4310). **Connect with MCP** provides configuration for the running installation, including absolute paths if your harness cannot find the globally installed command.

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.interlock]
command = "interlock"
args = ["mcp"]
```

See the [Codex MCP guide](https://developers.openai.com/codex/mcp).

## Claude

For Claude Code, run:

```sh
claude mcp add --transport stdio --scope user interlock -- interlock mcp
```

For Claude Desktop, merge this into its MCP configuration:

```json
{
  "mcpServers": {
    "interlock": { "command": "interlock", "args": ["mcp"] }
  }
}
```

See the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp). The connection modal also supplies absolute paths for desktop applications whose PATH does not include global npm commands.

## OpenCode

Merge this into `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "interlock": {
      "type": "local",
      "command": ["interlock", "mcp"],
      "enabled": true
    }
  }
}
```

See the [OpenCode MCP guide](https://opencode.ai/docs/mcp-servers/).

## Other clients

Use a local **stdio** MCP server. Set the command to `interlock` and its argument list to `["mcp"]`. No additional arguments are required. The harness launches this bridge and communicates over stdin/stdout.

The bridge connects to the running engine at `http://127.0.0.1:4310`. Set the bridge environment variable `INTERLOCK_URL` when using another port. This engine URL is an internal HTTP API, not an HTTP MCP endpoint.

Restart or reconnect your harness after changing configuration. Enable Interlock's tools in its approval settings. Interlock does not modify harness configuration for you.

## Development configuration

A server started with `pnpm dev` or `pnpm start` generates absolute paths to the current Node installation, TypeScript loader, and checkout. These paths are computed locally and are not personal paths embedded in the npm package. Regenerate the configuration if you move the checkout or change Node installations.

A server started with the installed `interlock` command generates the portable command shown above. Its optional absolute-path fallback points to that installation. Use the configuration from the server you intend to connect to.

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

## Diagnose a connection

Check the service first:

```sh
curl http://127.0.0.1:4310/health
interlock workflows
```

If both succeed but the harness cannot execute Interlock tools, inspect its MCP startup and approval settings. The MCP adapter prints protocol messages to stdout and diagnostics to stderr. Do not wrap its command in a script that prints startup banners to stdout.

From a source checkout, the automated MCP transport test runs without a model:

```sh
pnpm test
```

The package check, `pnpm build && pnpm test:package`, also exercises a packed global install and its MCP bridge.

The optional `scripts/codex-smoke.ts` check invokes the installed Codex CLI with a real account and a local text task. It creates a workflow in the running engine and consumes model usage. Its result depends on the client's authentication and tool approval settings; it is separate from the automated transport tests.
