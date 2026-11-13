# Working on Interlock

Interlock is a local workflow engine and editor. The public npm package is `@type_of/interlock`; its executable is `interlock`.

## Read for the task

- For domain terms or workflow behavior, read [CONTEXT.md](CONTEXT.md) and [execution semantics](docs/architecture.md).
- For UI work, read the UI components section of [architecture](docs/architecture.md) and [UI interaction patterns](docs/ui-patterns.md). Reuse the Mantine theme and existing contract editors.
- For run inspection, history, or collection-query changes, follow [read query review](docs/architecture.md#read-query-review).
- For MCP configuration or agent execution, read [Connect a harness](docs/connect-harness.md).
- For feature scope, read the [feature index](docs/features.md) and [current limits](docs/v1.md). Distinguish implemented behavior from planned capabilities.
- For a releasable change, version bump, or publication, follow [Release Interlock](docs/releases.md).

## Preserve these boundaries

Keep execution rules in `packages/runtime`, contracts and graph validation in `packages/core`, and persistence in `packages/storage`. UI, CLI, and MCP callers share the server API.

`pnpm lint:deps` enforces these boundaries with dependency-cruiser ([.dependency-cruiser.mjs](.dependency-cruiser.mjs)): each package imports only the lower layers its `allowedPackages` entry lists (from the bottom: `core`, `storage`, `runtime`, `server`, `client`, then `mcp`, `ui`, and `cli`), crosses packages through `@interlock/*` names rather than relative paths, forms no package cycle, and resolves every import. Only `packages/cli/src/bin.ts`, the executable's composition root, may import `server` and `mcp`; within `server`, only `packages/server/src/app.ts` may import `mcp`, which it mounts at `/mcp`; `client` imports only types from `server`, plus `@interlock/server/transport`. The server → mcp → client cycle exists only in types: the config's `typeOnlyCycleEdges` exempts its folder edges, and a second pass ([.dependency-cruiser-runtime.mjs](.dependency-cruiser-runtime.mjs)) checks package cycles without type-only imports and no exemptions. `packages/ui/src/design-system` imports no feature, route, API client, or domain code. Root `scripts/`, `tests/`, and `website/` are not packages and are not checked. Known violations are baselined in `.dependency-cruiser-known-violations.json`; never add entries there or to `typeOnlyCycleEdges`.

New script nodes default to JavaScript. Definitions that omit `language` retain legacy Bash behavior. Preserve both paths when changing script execution or serialization.

Prefix every new environment variable defined by Interlock with `INTERLOCK_`. Preserve names supplied by users or required by external tools.

Raw editing operates on the workflow definition, not the full stored workflow record. Keep draft-save validation separate from publication checks so incomplete graphs can still be saved.

Use the root package version through `packages/core/src/version.ts` for CLI, UI, and MCP version displays. Add changesets for `@type_of/interlock` even when the code changes in a private workspace package. Keep changesets pending in feature PRs. The GitHub release workflow applies versioning in a release PR and publishes after that PR merges.

While Interlock is on `0.x`, use `patch` changesets for all non-breaking changes, including new features. A minor or major bump requires an explicit user request. Flag breaking changes before choosing a release bump.

## Keep UI purposeful

Before changing a repeated interaction, compare the matching screens and identify the shared implementation. Reuse its behavior as well as its appearance. Put common fixes in the shared implementation; keep domain-specific differences explicit.

Every UI element should provide useful information or help the user decide or act. Use existing titles and navigation for context instead of repeating them in subtitles or labels. Omit generic filler copy added to make a layout feel complete. Keep guidance that explains a non-obvious behavior, consequence, or next step, and place it where needed. Build visual hierarchy with spacing, typography, and grouping rather than extra copy.

Before implementing a new screen, get a short written layout proposal approved. For changes under `packages/ui` other than Markdown files, complete the PR template's [UI evidence](.github/pull_request_template.md#ui-evidence) section and review its screenshots against the [UI review checklist](packages/ui/UI-REVIEW.md).

## Keep documentation and MCP definitions current

After changes that could affect documented behavior or agent usage, check README.md, related docs, CLI help, and [MCP definitions](packages/mcp/src/tools/server.ts) against the final implementation before declaring the task complete or opening or updating a PR. Update affected instructions, examples, UI labels, supported operations, and limits in the same change.

Review the full affected MCP workflow, including existing tools that interact with the changed behavior. Check server instructions, tool descriptions, parameter schemas and descriptions, defaults, bounds, returned fields, and error and lifecycle guidance against the shared server API. Keep guidance consistent across tools that accept the same data or participate in the same operation.

Treat MCP context as a limited resource. Keep server instructions focused on cross-tool behavior and tool descriptions focused on selection and correct use. Prefer bounded summaries and on-demand detail for large responses. Remove redundant guidance while preserving contract and lifecycle rules that agents need to act correctly. Justify added tools, discovery text, and response volume in the PR's MCP impact section.

Verify documented commands and examples against their implementations. When MCP definitions change, check what clients discover over both HTTP and stdio with the transport tests. State which docs and MCP flows were checked and any remaining gaps; describe a review as comprehensive only when the entire MCP tool set was audited.

Keep `.tasks/` artifacts local and ignored. At task completion, move lasting decisions into their owning docs and retire superseded proposals. Preserve original experiment evidence and active-run artifacts before removing files.

Keep changeset summaries focused on user-visible changes since the latest published release, omitting intermediate designs that never shipped.

When opening or updating a PR, use the [PR template](.github/pull_request_template.md), including when supplying the body through the CLI. Remove its optional MCP impact section when unaffected.

## Work locally

See [README.md](README.md) and the root `package.json` scripts for setup and commands. Development and installed copies use different databases. Preserve the user's `.interlock` data and use temporary databases for automated checks.

Connection configuration defaults to the running server's `/mcp` HTTP endpoint. The stdio fallback uses checkout paths in development and `interlock mcp` for installed copies, with optional absolute paths. Check which server is running before changing connection instructions.

Run tests relevant to changed behavior and `pnpm build` for TypeScript and UI build checks. For packaging, CLI startup, or version changes, also run `pnpm test:package`. Run the static checks that CI runs: `pnpm format:check` for formatting, `pnpm lint` for type-aware ESLint rules and file-size budgets, `pnpm lint:deps` for the package boundaries above, and `pnpm lint:unused` for unused files, exports and dependencies. For ESLint, new source files stay within 800 lines and files listed in `eslint-size-budgets.json` must not grow; existing violations live in `eslint-suppressions.json`, so after fixing some, run `pnpm lint --prune-suppressions`, and lower or remove a file's size ceiling when it shrinks. For Knip, configure new entry points in `knip.json`; after removing a finding listed in `knip-baseline.json`, drop it with `pnpm lint:unused --update` (`--allow-new` baselines new findings).

The package smoke test needs a completed build. It installs into a temporary prefix and exercises the bundled engine and MCP bridge. The separate `scripts/codex-smoke.ts` uses a real account and model, creates workflow data, and is not part of routine validation.
