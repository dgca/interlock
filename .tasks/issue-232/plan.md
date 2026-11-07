# Implementation Plan: Per-run dynamic working directory (cwd) for Managed Agents and Scripts

See [intent.md](./intent.md) for context and [spec.md](./spec.md) for acceptance criteria (AC1–AC7).

## Intended Code Areas
1. **`packages/core`**:
   - `packages/core/src/index.ts`:
     - Add `cwdBindingSchema` (supporting static string or `ValueBinding`).
     - Add `cwd?: cwdBindingSchema` to `definitionSchema`, Agent node schema, Script node schema, and `pollCheckShapeSchema` (for script kind).
     - Add `resolvedCwd?: string` to `NodeExecution`.
     - Add `resolvedCwd?: string` and `cwdBlocked?: { reason: string; path?: string }` to `WorkRequest` / `WorkItem`.
   - `packages/core/src/executors.ts`:
     - Add `allowedRoots` to `executorProfileSchema`, `executorSettingsSchema`, `executorSettingsUpdateSchema`.
   - `packages/core/src/continuation.ts`:
     - Add `resolvedCwd` to `continuationWorkSchema`.
     - Update continuation types if needed for blockers.
2. **`packages/runtime`**:
   - `packages/runtime/src/index.ts`:
     - Dynamic cwd resolution and containment verification helpers (`resolveCwd`, `checkAllowedRoots`).
     - Pass `allowedRoots` into `Engine` constructor options.
     - In `advance`:
       - Resolve dynamic `cwd` for Agent nodes from node/definition binding via `bindingSource`.
       - Check directory existence and containment against server/profile `allowedRoots`.
       - If invalid/missing/outside allowed roots, set `cwdBlocked` on `WorkRequest` and record blocker.
       - Set `execution.resolvedCwd` upon resolution.
     - In `localOperation`:
       - Resolve dynamic `cwd` for Script nodes and polling script checks.
       - Validate directory existence and containment.
       - If invalid/missing/outside allowed roots, fail immediately with `InterlockError`.
       - Set `execution.resolvedCwd`.
   - `packages/runtime/src/executors/manager.ts`:
     - Support profile and server `allowedRoots`.
     - Handle `allowedRoots` in `settings()`, `saveSettings()`, `saveProfile()`.
     - In `scan`:
       - If work has `cwdBlocked`, leave unclaimed.
       - Check `resolvedCwd` against profile `allowedRoots`. If outside, leave unclaimed and record blocker.
       - Continuity pinning: ensure session pins `cwd` on launch and subsequent continuity assignments retain the pinned `cwd`.
   - `packages/runtime/src/continuation.ts`:
     - Expose `resolvedCwd` and `cwdBlocked` blocker reason (`cwd_blocked`) in briefings, nextWork, and inspection.
3. **`packages/server`**:
   - `packages/server/src/index.ts` / `start.ts`:
     - Parse `INTERLOCK_ALLOWED_ROOTS` (comma-separated or JSON list of paths) and pass to `Engine`.
4. **`packages/mcp`**:
   - `packages/mcp/src/server.ts`:
     - Update server instructions and `manage_executors` tool description to document `allowedRoots` and dynamic `cwd`.
5. **Documentation & Changeset**:
   - `docs/managed-executors.md`
   - `docs/architecture.md`
   - `docs/v1.md`
   - `.changeset/*.md` patch changeset for `@type_of/interlock`.

## Implementation Sequence
1. **Core contracts & schemas** (`packages/core`):
   - Define `cwdBindingSchema`.
   - Update `definitionSchema`, Agent node, Script node, and poll check schemas.
   - Update `executorProfileSchema`, `executorSettingsSchema`, `executorSettingsUpdateSchema`.
   - Update `NodeExecution`, `WorkRequest`, and `continuationWorkSchema`.
2. **Runtime directory resolution & validation** (`packages/runtime`):
   - Implement `resolveAndValidateCwd` with canonicalization (`fs.realpathSync`), directory check (`statSync`), and `allowedRoots` containment check.
   - Update Script node and Polling check execution in `localOperation`.
   - Update Agent node creation and claim gating in `advance` and `claim`.
   - Update `ExecutorManager` for profile `allowedRoots`, scan containment checks, and continuity session cwd pinning.
   - Update `continuation.ts` for `cwd_blocked` blocker reporting and execution record inspection.
3. **Server integration** (`packages/server`):
   - Wire `INTERLOCK_ALLOWED_ROOTS` into engine startup.
4. **MCP definitions & documentation** (`packages/mcp`, `docs/`):
   - Update MCP server instructions and tool descriptions.
   - Update `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.
5. **Testing & Verification**:
   - Unit tests for dynamic cwd binding in Script nodes (static & node/input bindings).
   - Unit tests for Polling Script checks with dynamic cwd.
   - Unit tests for Agent nodes with dynamic cwd and `allowedRoots` containment.
   - Failure tests: missing binding path, non-existent directory, path traversal escape (`..`), symlink escape outside `allowedRoots`.
   - Continuity group tests: verify initial launch pins cwd and subsequent tasks retain pinned cwd.
   - Telemetry tests: verify `resolvedCwd` on `NodeExecution` in run history and MCP inspection.
   - Run `pnpm test`, `pnpm build`, and `pnpm format:check`.
6. **Changeset**:
   - Add patch changeset for `@type_of/interlock`.

## Criteria Mapping & Verification Plan
- **AC1 (cwd binding schema on workflows & nodes)**:
  - Verified by core schema tests and runtime execution tests binding from node output and run input.
- **AC2 (allowedRoots declarations in profiles and server)**:
  - Verified by profile save, settings update, and server config tests.
- **AC3 (containment validation, script failure & agent blocker)**:
  - Verified by negative test cases (escaping path, non-existent dir, symlink escape). Scripts fail step; agent work is blocked with `cwd_blocked`.
- **AC4 (continuity session pinning)**:
  - Verified by multi-step continuity tests asserting session cwd remains pinned across consecutive work items.
- **AC5 (node execution record & inspection)**:
  - Verified by asserting `execution.resolvedCwd` on completed executions and in `get_run` / briefing inspection.
- **AC6 (backward compatibility)**:
  - Existing workflows and profiles without `cwd` continue working as before.
- **AC7 (documentation & changeset)**:
  - Verified by doc reviews and changeset validation.

## High-Risk Failure Cases & Direct Checks
1. **Path traversal / symlink escape outside allowedRoots**:
   - *Test*: Directory `/tmp/safe/escape` with symlink to `/tmp/outside`. Point cwd to symlink.
   - *Expected*: Canonical resolution identifies target outside `allowedRoots`; script step fails, agent work is left unclaimed.
2. **Missing directory or bad binding path**:
   - *Test*: Binding points to `{ source: "node", nodeId: "missing", path: "nonexistent" }`.
   - *Expected*: Script step fails with clear error; Agent work item is marked `cwd_blocked` and left unclaimed. Never falls back to default cwd.
3. **Continuity session cwd drift**:
   - *Test*: Step 1 binds `/tmp/worktree-a`. Step 2 in same continuity group binds `/tmp/worktree-b`.
   - *Expected*: Step 2 uses pinned `/tmp/worktree-a`; session directory does not change.
