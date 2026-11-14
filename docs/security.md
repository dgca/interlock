# Security

Interlock is a trusted local tool for one person. Workflows run Scripts, Fetch requests and agents with your user account's access, so treat a workflow like code you run.

- The server listens only on `127.0.0.1`, and the listen address is not configurable. It rejects requests addressed to another host or sent from an untrusted browser origin. Do not expose the port through a tunnel, proxy, port forward or container port mapping.
- Interlock creates a per-install [API token](connect-harness.md#api-token) in an owner-only `api-token` file. The UI, the `interlock` CLI and the stdio bridge send it automatically, and **Connect with MCP** includes it in HTTP client configuration. On loopback the token is optional in 0.2. Set `INTERLOCK_REQUIRE_TOKEN=1` before starting Interlock to reject `/api`, `/trpc`, `/mcp` and `/events` requests without it.
- Scripts are not sandboxed. A Script's [server environment](architecture.md#scripts-and-interruptions) mode decides which of Interlock's environment variables it receives. `minimal` passes only `PATH`, `HOME`, locale variables, `INTERLOCK_*` variables, bound saved variables, execution context and the names you list to pass through. Scripts and polling checks added in the editor start in `minimal`. A Script without a mode, or set to `inherit`, receives the whole server environment, including any credentials in it, so existing and imported workflows keep their behavior.
- Imported Scripts wait for [one-time approval](reuse-work.md#approve-imported-scripts) before their first run. Scripts you write, or that a connected agent writes over MCP, run without approval unless you extend approval to agent-authored Scripts.

Scripts execute with your user account's filesystem, environment, and network access. They are not sandboxed, so review scripts before running imported workflows.
