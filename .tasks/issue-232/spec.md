# Specification: Per-run dynamic working directory (cwd) for Managed Agents and Scripts

See [intent.md](./intent.md) for background, problem statement, scope, and high-level outcomes.

## Overview
This specification details the contract, validation rules, runtime resolution, containment semantics, continuity session behaviors, and execution telemetry for dynamic per-run working directory (`cwd`) binding and `allowedRoots` enforcement.

## Behavioral Requirements & Acceptance Criteria

### AC1: Working Directory Binding Specification on Workflows and Nodes
- Workflows can define a top-level `cwd` binding property: `workflow.cwd`.
- Nodes supporting execution (`agent` and `script`, including polling script checks) can define a node-level `cwd` binding property: `node.cwd`.
- `cwd` can be defined as:
  1. A static path string (e.g. `"/tmp/worktrees/repo"`).
  2. A run data binding object (e.g. `{ source: "node", nodeId: "provision_worktree", path: "worktreePath" }` or `{ source: "input", path: "repoPath" }`).
- Node-level `cwd` overrides workflow-level `cwd`. If neither is provided, execution defaults to the executor profile's configured `cwd` or server default directory.

### AC2: Allowed Roots Declaration
- Executor profiles support an `allowedRoots` configuration field (`string[]` of absolute paths).
- Server configuration supports an `allowedRoots` setting (`string[]` of absolute paths, configurable via env `INTERLOCK_ALLOWED_ROOTS` or server options).
- When resolving allowed roots for an execution:
  - If the executor profile specifies `allowedRoots`, those roots apply.
  - If the profile does not specify `allowedRoots` (or for script nodes executed by the server engine directly), server-level `allowedRoots` apply if configured.
  - If both profile and server declare `allowedRoots`, the profile's roots must be within or intersect server allowed roots, or profile roots are used when assigned to that profile.

### AC3: Directory Resolution, Validation, and Strict Containment
- When evaluating a dynamically bound `cwd`:
  1. The value is resolved from run context (input or prior node output).
  2. The resolved value must be a non-empty string.
  3. The path must be resolved to a canonical absolute path (using `path.resolve` and `fs.realpathSync` to prevent symlink traversal escapes).
  4. The path must exist and must be a directory (`fs.statSync(resolvedPath).isDirectory()`).
  5. If `allowedRoots` is configured and non-empty:
     - The canonical directory must reside inside at least one of the canonical paths in `allowedRoots` (e.g., `resolvedPath === root || resolvedPath.startsWith(root + path.sep)`).
- **Strict Fail-Safe Enforcement**:
  - Missing property in binding, non-existent path, path that is not a directory, or path falling outside `allowedRoots` must **NEVER** silently fall back to profile or server default working directories.
  - For **Script nodes** (and polling script checks): The script execution fails immediately with a descriptive error code and message (e.g. `INVALID_WORKING_DIRECTORY` or `DIRECTORY_OUTSIDE_ALLOWED_ROOTS`).
  - For **Agent nodes**: The assignment cannot be claimed or scheduled; it is marked with an explicit blocker reason (e.g. `blocked_cwd_invalid` or `blocked_cwd_containment`) in work item status/inspection.

### AC4: Continuity Group Session Pinning
- When an Agent node belongs to a `context.continuityGroup`:
  - On initial session launch (the first claim/execution binding that creates the session), the resolved `cwd` is pinned to the session state in `ExecutorManager` / continuity session registry.
  - Subsequent work items assigned to the same continuity session MUST retain that pinned `cwd`.
  - If a subsequent assignment attempts to bind a different `cwd`, the session's pinned `cwd` is preserved (or an attempt to alter the session directory is rejected), ensuring stable working directory continuity across turns in a conversation or multi-step session.

### AC5: Node Execution Record & Observability
- Every node execution record (`NodeExecutionRecord`) records `resolvedCwd` (optional string, populated whenever a working directory is resolved for the node execution).
- The `resolvedCwd` is persisted in run history and surfaced in MCP inspection tools (`get_run`, `get_run_briefing`, `list_work`, `submit_result` full detail).

### AC6: Backward Compatibility
- Workflows without `cwd` bindings continue to execute in existing executor/server default directories as before.
- Executor profiles without `allowedRoots` retain default behavior unless server-wide `INTERLOCK_ALLOWED_ROOTS` is set.

### AC7: Documentation and Changeset
- Update `docs/managed-executors.md` detailing `allowedRoots` and `cwd` binding for managed profiles.
- Update `docs/architecture.md` detailing execution containment and dynamic directory resolution.
- Update `docs/v1.md` documenting dynamic cwd binding support.
- Add a patch changeset for `@type_of/interlock` describing dynamic per-run `cwd` and `allowedRoots` containment.
