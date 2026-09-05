# Interlock

Interlock runs versioned workflows that hand bounded assignments to agent harnesses. The local engine owns sequencing, validates results, and persists progress between tool calls. A dark web UI provides a node editor and run inspector.

## Run locally

Use Node 24.13 or later and pnpm 11.7 on macOS or Linux. Script nodes require Bash.

```sh
pnpm install
pnpm dev
```

Open [the development UI](http://127.0.0.1:5173). The engine listens on `127.0.0.1:4310` and stores state in `.interlock/interlock.db`. Closing the browser does not stop the engine.

For the built UI:

```sh
pnpm build
pnpm start
```

Open [Interlock](http://127.0.0.1:4310).

The initial library contains **Research a protocol** and **DeFi opportunity brief**. These are editable examples. They accept a supplied protocol list and request agent research. They do not fetch live rankings or access internal engagement data.

## Connect a harness

Choose **Connect with MCP** in the sidebar to copy configuration with absolute paths for this checkout. Keep the engine running separately. The MCP adapter uses stdio and connects to the engine over local HTTP.

See [Connect a harness](docs/connect-harness.md) for the request loop and Codex configuration. Harness approval policy must allow the Interlock tools. Fresh context and required tool availability are executor declarations, not capabilities that MCP automatically grants.

You can also inspect and complete work through the CLI:

```sh
pnpm cli workflows
pnpm cli start WORKFLOW_ID '{"protocols":[{"name":"Aave"}]}'
pnpm cli work RUN_ID
pnpm cli claim WORK_ID my-worker
pnpm cli submit WORK_ID CLAIM_TOKEN @result.json
pnpm cli run RUN_ID
```

## Validate changes

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

The tests cover runtime behavior and a real MCP stdio client connected to the HTTP service. `pnpm exec tsx scripts/codex-smoke.ts` additionally attempts a text-only Codex run using the installed CLI and its account. It consumes model usage and needs a harness policy that permits Interlock tool calls. The initial attempt reached the MCP tool but the host blocked `start_run` because approval was required under a `never` approval policy. It is not counted as a passing integration test.

## Project documentation

- [Domain language](CONTEXT.md)
- [Architecture and execution semantics](docs/architecture.md)
- [V1 scope and limits](docs/v1.md)
- [Harness integration](docs/connect-harness.md)

Packages are private during v1 development. Changesets is configured, but npm publication requires compiled package entrypoints and release preparation. No packages have been published.
