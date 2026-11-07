# Intent: M9: interlock doctor health and readiness check

## Baseline Information
- **Task Branch**: `feat/issue-246`
- **Base Commit**: `db544c60ecf68f368031187b347ef9c634975a11`
- **Issue**: dgca/interlock#246
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-246`

## Problem Statement
Unattended automation pipelines and operators need a single, automated, read-only health and readiness check before dispatching or starting work. Currently, verifying system readiness requires disparate checks or manual inspection across multiple surfaces:
1. **System & Storage Readiness**: Verifying that the SQLite database is not corrupted (`PRAGMA integrity_check`, `quick_check`), the database schema version is up to date, execution history size is bounded, and disk space is sufficient.
2. **Harness & Profile Readiness**: Verifying that enabled executor/harness profiles have available binaries (e.g., codex, claude, node/bun/python), valid versions, valid `cwd` and existing `allowedRoots`, and optionally running a live single-turn model/auth check (`--live`).
3. **Active Triggers**: Detecting schedule lag, consecutive schedule failures, auto-paused schedules, and recent webhook rejections.
4. **Active Blockers & Stalls**: Detecting runs paused under human intervention (H3 pauses), uncertain resource/executor holds, stalled work requiring intervention (H12 stalled work), and `needs_model` holds.
5. **Workflow & Dependency Integrity**: Detecting missing or disabled variables and variable aliases referenced by published workflows, as well as surfacing workflows with unpublished draft edits that could cause operator confusion.

## Desired Outcome
Provide a unified, comprehensive, read-only diagnostic operation named `doctor` accessible across all Interlock interfaces:
1. **Core Diagnostic Schemas & Runner**:
   - Define structured diagnostic result types in `packages/core` (categories, check status: `ok`, `warn`, `fail`, metrics, actionable diagnostics messages).
   - Implement a modular, read-only diagnostics runner in `packages/runtime` that evaluates storage/database integrity, harness profiles (with optional live probe), active triggers, active blockers/holds, and workflow variable/draft dependencies.
2. **Shared API (`system.doctor`)**:
   - Expose the diagnostic runner through the shared server API (`system.doctor`) in `packages/server`.
3. **CLI Command (`interlock doctor [--live] [--json]`)**:
   - Implement `doctor` command in `packages/cli` supporting human-readable formatted summary output and machine-readable `--json` output.
   - Return a non-zero exit code (e.g. code 1) when any critical check fails, allowing CI/CD and automated orchestrators to gate execution.
4. **MCP Doctor Tool (`doctor`)**:
   - Expose a compact, bounded `doctor` tool in `packages/mcp` for agentic harnesses to inspect system readiness, keeping MCP discovery bytes within strict budget guidelines.
5. **UI Diagnostics View**:
   - Add a Diagnostics / Doctor view in `packages/ui` displaying category statuses, check results, warnings, and error remediation details using existing Mantine components.
6. **Tests, Documentation & Changeset**:
   - Comprehensive tests in runtime, server, CLI, and MCP for all doctor check categories, exit codes, and JSON outputs.
   - Documentation updates in `README.md`, `docs/architecture.md`, `docs/v1.md`, and `packages/mcp/src/server.ts`.
   - Patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Automated Pipelines & CI/CD**: Can gate workflow runs using `interlock doctor --json`.
- **Operators & Agents**: Can diagnose misconfigurations, blocker holds, or disk/database issues before running tasks.
- **`packages/core`**: Schema definitions for doctor check categories, items, and response shapes.
- **`packages/runtime`**: Diagnostic runner evaluating storage, harness profiles, triggers, blockers, and workflow variable/draft dependencies.
- **`packages/server`**: Shared `system.doctor` API endpoint.
- **`packages/cli`**: `interlock doctor [--live] [--json]` command and exit code handling.
- **`packages/mcp`**: Read-only `doctor` tool registered in MCP server.
- **`packages/ui`**: Diagnostics interface.

## Settled Decisions
- The doctor operation is strictly read-only and does not mutate any workflow, run, or storage state.
- CLI exits with code 0 on all `ok` or `warn` status, and non-zero (1) if any check has `fail` status.
- Live probe (`--live`) is opt-in and tests single-turn connectivity/auth for enabled harness profiles when requested.
- Patch changeset for `@type_of/interlock`.

## Open Questions
- None.
