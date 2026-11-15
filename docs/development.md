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

CI runs on Linux for pull requests, pushes to `main`, and manual dispatches. Four jobs run independently:

- `checks` runs `pnpm format:check`, `pnpm lint`, `pnpm lint:deps`, and `pnpm lint:unused`.
- `unit` runs `pnpm test` without sharding.
- `browser` builds the package and UI, installs Chromium, and runs `pnpm test:browser`. On failure, it uploads available screenshot diffs.
- `package` builds the package and UI, then runs `pnpm site:build`, `pnpm test:package`, and `pnpm test:kill`.

Each job installs its own dependencies. The browser and package jobs build separately because their tests need build output. The final required check, `validate (linux)`, runs after all four jobs and succeeds only if every job succeeded. A failed, cancelled, or skipped dependency makes this final check fail.

See [Release Interlock](releases.md) for versioning and publication.

### File size budgets

`pnpm lint` limits each TypeScript source file to 800 lines of code. Blank lines and comments do not count. Files that were already larger have their own ceiling in `eslint-size-budgets.json`; a ceiling must be above 800, and a file at or under 800 loses its entry.

- Never remove blank lines or comments, shorten strings, or join statements to fit a size limit. They are not counted, and squeezing code makes it worse.
- When a file outgrows its budget, prefer extracting a coherent module.
- A pull request may raise a file's ceiling when the change belongs in that file and it has no natural module boundary. Give a one-line reason in the PR description for the reviewer to judge.
- A ceiling may sit above the file's count; do not lower it for small reductions. Lower it to the current count, or delete the entry, once the file is more than 50 lines or 5% below it, whichever is larger.

## Add a database migration

The schema version is independent of the npm package version. `packages/storage/src/migrations.ts` owns the ordered migration list, and the `migrations` table records completed versions.

Rules:

- Append the next consecutive version when a persisted format needs conversion. Never edit a migration that has shipped.
- Keep migration functions synchronous and limited to database changes. The runner owns the transaction and version records: do not commit transactions or cause external side effects.
- Preserve immutable published definitions, version pins and run history. Prefer compatible readers for optional fields when no rewrite is needed.
- A schema migration does not make an incompatible API or execution change backward compatible.

### Test a migration

Add a fixture from the preceding release and test the conversion, rollback and execution of its published workflows.

- `tests/migrations.test.ts` covers the runner with test-only future migrations, including a failed later migration and committed WAL data.
- The schema-v1 fixture was generated by the tagged 0.1.3 runtime.
- The schema-v2 fixture was generated by the published 0.1.13 CLI in a temporary database. It includes JavaScript and legacy Bash workflow pins, completed runs, events and a claimed Agent assignment, with its test claim token and deadline normalized. Tests check that records stay unchanged, that revisions persist across reopen, that claimed work continues, and that earlier script pins execute.
- The published 0.1.18 fixture in `tests/fixtures/testbench-previous-release.json` keeps the original schema SQL, JavaScript and omitted-language Bash versions, completed runs and an active claim. Testbench compatibility checks open it unchanged, resume its claim and run both script paths before comparing a previous pin. Workflow test suites and comparisons use new document collections and optional run context without converting existing schema-3 records.

### How the runner protects an upgrade

The runner uses SQLite's [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause) to make a consistent snapshot, including committed WAL data. After it takes the migration write lock, it checks `PRAGMA data_version` and refuses to continue if another connection committed during the backup. This protects the upgrade; it does not add support for several running servers.

Users follow [Upgrading](upgrading.md) to install updates and restore backups.
