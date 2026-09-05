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

## Complete a run

Give the harness a workflow ID and input, then ask it to complete the run through Interlock:

```text
Start Interlock workflow WORKFLOW_ID with the supplied input.
Use list_work for the root run, including its child runs.
Claim assignments with your actual capabilities.
Perform each assignment using its prompt, input, and context policy.
Submit JSON matching its output schema.
Continue until the root run completes or fails.
```

`start_run` returns a persisted run. `list_work` includes descendants of the requested run. A claim returns its token and expiry. Keep the token for `submit_result`, `renew_claim`, or `fail_work`. Inspect `get_run` to distinguish a completed run from one waiting on claimed work or scripts.

If execution will exceed the lease, call `renew_claim` before it expires. If a submission loses its response, submit the identical result again using the same token. If a claim has expired, discover and claim available work again. Do not submit through another worker's claim.

A fresh-context assignment requires an isolated agent execution. Do not declare `freshContext: true` merely because the assignment has a focused prompt. Declare required tools and skills only when the executor can actually use them.

## Diagnose a connection

Check the service first:

```sh
curl http://127.0.0.1:4310/health
interlock workflows
```

If both succeed but the harness cannot execute Interlock tools, inspect its MCP startup and approval settings. The MCP adapter prints protocol messages to stdout and diagnostics to stderr. Do not wrap its command in a script that prints startup banners to stdout.

The automated MCP transport test runs without a model:

```sh
pnpm test
```

The optional `scripts/codex-smoke.ts` check invokes the installed Codex CLI with a local text task. The initial host rejected `start_run` because tool approval was required while approval policy was `never`. That result does not establish an Interlock execution failure, and it does not verify a full Codex run.
