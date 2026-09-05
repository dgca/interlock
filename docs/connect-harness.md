# Connect a harness

## Configure Codex

1. Start the Interlock engine with `pnpm dev` or `pnpm start` after a build.
2. Open the UI and select **Connect with MCP**.
3. Copy the generated Codex configuration into the configuration scope you use for local MCP servers.
4. Enable the Interlock tools through your harness's normal approval controls.
5. Start a fresh harness session if needed to discover the new tools.

The generated configuration uses absolute paths to Node, the local TypeScript loader, and the MCP entrypoint. Moving the checkout or changing the Node installation requires regenerating it. Interlock does not modify your global harness configuration.

Codex documents stdio MCP configuration in its [MCP integration guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). The UI also provides a generic `mcpServers` JSON object. Other harnesses may require a different configuration wrapper around the same command and arguments.

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
pnpm cli workflows
```

If both succeed but the harness cannot execute Interlock tools, inspect its MCP startup and approval settings. The MCP adapter prints protocol messages to stdout and diagnostics to stderr. Do not wrap its command in a script that prints startup banners to stdout.

The automated MCP transport test runs without a model:

```sh
pnpm test
```

The optional `scripts/codex-smoke.ts` check invokes the installed Codex CLI with a local text task. The initial host rejected `start_run` because tool approval was required while approval policy was `never`. That result does not establish an Interlock execution failure, and it does not verify a full Codex run.
