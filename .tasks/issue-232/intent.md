# Intent: Per-run dynamic working directory (cwd) for Managed Agents and Scripts

## Source Request
Issue #232: H5: Per-run dynamic working directory (cwd) for Managed Agents and Scripts

## Git Baseline
- **Task Branch**: `feat/issue-232`
- **Base Commit**: `74ae3a320b00549d82d3d02ac02bc209189e4596`

Autonomous pipelines and software factories provision isolated git worktrees per work item. Today, Agent and Script nodes run in the static profile or server working directory, forcing brittle per-item profile creation or shell cd wrappers.
Allow workflows, Agent nodes, and Script nodes to dynamically bind their working directory (`cwd`) from run data with strict root containment.

## Problem Statement
Autonomous execution pipelines (such as software development lifecycle factories, batch multi-repo refactoring, or dynamic worktree processors) create temporary isolated git worktrees or checkout directories dynamically at runtime (e.g. via a setup script or workflow step). Currently in Interlock:
- Agent nodes execute under an executor whose working directory is fixed at profile creation or defaults to the server working directory.
- Script nodes run in the server's working directory or a statically configured path.
- As a consequence, workflows must rely on hacky workarounds like wrapping every shell command in `cd "$DIR" && ...` or generating ephemeral executor profiles for each worktree/job.
- Furthermore, dynamically binding working directories without validation poses security and isolation risks (e.g. path traversal escapes or directing agents to sensitive system paths).

## Desired Outcome
Interlock workflows, Agent nodes, and Script nodes (including polling script checks) can dynamically bind their working directory (`cwd`) from workflow inputs or previous node outputs, or inherit a workflow-level bound `cwd`.
This binding must be strictly contained within administrator-configured `allowedRoots` (declared in executor profiles or server settings).
Invalid directories, paths escaping `allowedRoots`, or non-existent directories are safely blocked (causing Agent assignments to remain unassigned/unclaimed with clear blocker diagnostics, and Script node executions to fail immediately), never silently falling back to insecure defaults.
Continuity groups pin their resolved working directory on first launch so that subsequent work in the same session maintains a stable, continuous working directory.
Every execution record captures the resolved working directory for complete observability and auditing.

## Affected Users & Systems
- **Workflow Authors**: Can write portable workflows that provision worktrees or scratch workspaces and bind downstream Agent and Script nodes to that directory without fragile wrappers.
- **Agent Workers / Managed Executors**: Will execute within the verified, bound worktree directory.
- **Platform Operators / Administrators**: Can restrict dynamic directory bindings to designated directories via `allowedRoots` on executor profiles and server configuration.
- **Inspection & Telemetry**: Operators and agents can inspect node execution records to verify the actual resolved working directory for each node.

## Scope
1. **Schema & Contract (`packages/core`)**:
   - Support `cwd` binding configuration at the workflow level (`workflow.cwd` binding) and at the node level (Agent nodes and Script nodes, including polling script checks).
   - Support run data binding specification (e.g. `{ source: "node", nodeId: "...", path: "..." }` or `{ source: "input", path: "..." }` or static strings).
   - Support `allowedRoots` (array of absolute path strings) on executor profile definitions and server configuration.
2. **Runtime Execution & Validation (`packages/runtime`)**:
   - Dynamic evaluation of bound `cwd` using run context / node outputs / input.
   - Fallback hierarchy: node-level `cwd` binding -> workflow-level `cwd` binding -> executor profile `cwd` / server `cwd`.
   - Containment validation against `allowedRoots`: path must resolve to a real existing directory and must reside strictly within one of the `allowedRoots` (resolving symlinks / realpath).
   - If binding fails (missing, not a directory, or outside allowedRoots):
     - For Script nodes: fail the execution with a clear diagnostic message. Never fall back.
     - For Agent nodes: block the work item / assignment (e.g. blocker reason on claim / scheduling). Never fall back.
   - Continuity group session pinning: when a continuity group session starts, the resolved cwd is pinned to the session, preventing subsequent tasks in the same group from shifting the session's working directory.
3. **Execution Records & Telemetry**:
   - Record `resolvedCwd` on node execution records (both Agent and Script nodes).
   - Surface `resolvedCwd` in execution details and MCP inspection tools.
4. **Server & MCP (`packages/server`, `packages/mcp`)**:
   - Server configuration support for `allowedRoots`.
   - MCP tools reflect and pass allowed roots and inspect resolved working directories.

## Constraints
- **Preserve Boundaries**: Graph contracts in `packages/core`, runtime execution in `packages/runtime`, persistence in `packages/storage`, server and MCP in their respective packages.
- **Fail-Safe Containment**: Missing, invalid, or uncontained paths must never silently fall back to profile or server defaults.
- **Continuity Invariance**: Once a continuity session is established, its working directory cannot be changed by later assignments.
- **Backward Compatibility**: Existing workflows and profiles that do not use dynamic `cwd` bindings or `allowedRoots` continue to function with their existing profile/server defaults.

## Open Questions
- None at this stage. All requirements in the issue description are explicit, clear, and actionable.
