# Develop Interlock

This page is for contributors working from a source checkout. Repository rules, package boundaries and the full set of static checks are in [AGENTS.md](../AGENTS.md).

## Run from source

You need Node.js 24.13 or later and pnpm 11.7.

```sh
pnpm install
pnpm dev
```

- The development UI runs on [port 5173](http://127.0.0.1:5173), with the engine on port 4310.
- `pnpm dev` waits for the engine's `/health` endpoint before starting Vite. If the engine is not healthy within 30 seconds, startup stops; check the server output for the cause.
- Stop any installed Interlock server on port 4310 first.
- The engine accepts browser requests from the Vite origin only in development. An installed copy rejects them.

Development data lives in `.interlock/interlock.db` inside the checkout. Installed copies use a separate database unless you pass `--db`.

To serve the built UI on port 4310 with the development database:

```sh
pnpm build
pnpm start
```

## Check a change

```sh
pnpm test
pnpm build
pnpm format:check
pnpm test:package
pnpm test:kill
```

| Command             | What it checks                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`         | Workflow contracts, runtime behavior, and MCP over HTTP and stdio.                                                                                                                              |
| `pnpm build`        | The build, including TypeScript checks.                                                                                                                                                         |
| `pnpm test:package` | Installs a local tarball into a temporary prefix and checks global and npx startup, the CLI, the UI, both MCP transports, JavaScript execution, and claims across a restart. Publishes nothing. |
| `pnpm test:kill`    | Installs the tarball the same way, stops the server with SIGKILL while a foreground Script, a background Script and a managed Agent attempt run, and checks their recovery after restart.       |

After building, run the browser journeys against an isolated SQLite store:

```sh
pnpm exec playwright install --only-shell chromium
pnpm test:browser
```

CI runs all of these on Linux for pull requests and pushes to `main`. See [Release Interlock](releases.md) for versioning and publication.
