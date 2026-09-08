# Working on Interlock

Interlock is a local workflow engine and editor. The public npm package is `@type_of/interlock`; its executable is `interlock`.

## Read for the task

- For domain terms or workflow behavior, read [CONTEXT.md](CONTEXT.md) and [execution semantics](docs/architecture.md).
- For UI work, read the UI components section of [architecture](docs/architecture.md). Reuse the Mantine theme and existing contract editors.
- For MCP configuration or agent execution, read [Connect a harness](docs/connect-harness.md).
- For feature scope, read [current limits](docs/v1.md). Distinguish implemented behavior from planned capabilities.
- For a releasable change, version bump, or publication, follow [Release Interlock](docs/releases.md).

## Preserve these boundaries

Keep execution rules in `packages/runtime`, contracts and graph validation in `packages/core`, and persistence in `packages/storage`. UI, CLI, and MCP callers share the server API.

New script nodes default to JavaScript. Definitions that omit `language` retain legacy Bash behavior. Preserve both paths when changing script execution or serialization.

Raw editing operates on the workflow definition, not the full stored workflow record. Keep draft-save validation separate from publication checks so incomplete graphs can still be saved.

Use the root package version through `packages/core/src/version.ts` for CLI, UI, and MCP version displays. Add changesets for `@type_of/interlock` even when the code changes in a private workspace package. Keep changesets pending in feature PRs. The GitHub release workflow applies versioning in a release PR and publishes after that PR merges.

While Interlock is on `0.x`, use `patch` changesets for all non-breaking changes, including new features. A minor or major bump requires an explicit user request. Flag breaking changes before choosing a release bump.

## Before opening or updating a PR

Check README.md, related docs, CLI help, and MCP tool descriptions against the PR's final behavior. Update affected instructions, examples, UI labels, supported operations, and limits in the same PR. Verify documented commands against their implementations. Keep changeset summaries focused on user-visible changes since the latest published release, omitting intermediate designs that never shipped.

## Work locally

See [README.md](README.md) and the root `package.json` scripts for setup and commands. Development and installed copies use different databases. Preserve the user's `.interlock` data and use temporary databases for automated checks.

Connection configuration defaults to the running server's `/mcp` HTTP endpoint. The stdio fallback uses checkout paths in development and `interlock mcp` for installed copies, with optional absolute paths. Check which server is running before changing connection instructions.

Run tests relevant to changed behavior and `pnpm build` for TypeScript and UI build checks. For packaging, CLI startup, or version changes, also run `pnpm test:package`. Check formatting with `pnpm format:check`.

The package smoke test needs a completed build. It installs into a temporary prefix and exercises the bundled engine and MCP bridge. The separate `scripts/codex-smoke.ts` uses a real account and model, creates workflow data, and is not part of routine validation.
