# Plan: M11: Simulation for parent workflows (waited children, virtual clock & route coverage)

## Baseline Reference
- **Intent**: [intent.md](./intent.md)
- **Specification**: [spec.md](./spec.md)
- **Task Branch**: `feat/issue-248`
- **Base Commit**: `edfd6cfab93e3144cd5010fc877864e6fb1fa52b`

---

## 1. Intended Code Areas & Architecture

### `packages/core`
- **`packages/core/src/simulation.ts`**:
  - Update `simulationFixtureSchema` to include `kind: 'workflow'` alongside `'agent'`, `'script'`, `'fetch'`.
  - Add `timedOut: z.boolean().optional()` to `simulationFixtureSchema`, enforcing that `timedOut` is only valid on `kind: 'agent'` with no `output` or `error`.
  - Define `routeCoverageSchema` and export `RouteCoverage`.

### `packages/runtime`
- **`packages/runtime/src/index.ts`**:
  - Add `clock?: { now: () => number }` to `EngineOptions`.
  - Add `nowMs(): number` method to `Engine` to query the clock or `Date.now()`.
  - Replace direct `Date.now()` calls in `Engine` with `this.nowMs()`.
  - Support `clock` for Wait durations, Wait timestamps, polling intervals/timeouts, and Agent unclaimed timeouts.
- **`packages/runtime/src/simulation.ts`**:
  - Relax unsupported node validation: permit `wait` nodes, waited `workflow` nodes (`mode !== 'detached'`), and Agent nodes with `unclaimedTimeoutMs`.
  - Maintain virtual clock state during simulation execution and pass `clock: { now: () => virtualTime }` to the scratch `Engine`.
  - In driver loop:
    - If active work item has a matching fixture with `timedOut: true`: advance virtual clock to `work.availableUntil`, step engine, and record `outcome: 'timed_out'`.
    - If run is `waiting`: advance virtual clock to the earliest deadline (`resumeAt`, `nextCheckAt`, `timeoutAt`) and step engine or poll check.
    - Support waited `workflow` node substitution using fixtures with `kind: 'workflow'`.
  - Implement edge coverage calculation: inspect `run.executions` and compare traversed `(nodeId, port)` against `definition.edges`, reporting `totalEdges`, `coveredEdges`, `percentage`, and `untested` edges.

### `packages/server` & `packages/mcp`
- Inspect `packages/server/src/trpc/routers/testbench.ts` and `packages/mcp/src/server.ts` to ensure simulation schema and reports pass through cleanly.

### Documentation & Packaging
- Update `docs/workflow-simulation.md`, `docs/architecture.md`, `docs/v1.md`.
- Add patch changeset for `@type_of/interlock` via `.changeset/`.

---

## 2. Implementation Sequence & Acceptance Criteria Mapping

| Step | Action | Criteria |
|---|---|---|
| 1 | Extend `simulationFixtureSchema` with `'workflow'` kind and `timedOut: boolean` | [AC1, AC3, AC6](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 2 | Add `routeCoverageSchema` to `packages/core/src/simulation.ts` | [AC5, AC6](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 3 | Add `clock` option and `nowMs()` to `Engine` in `packages/runtime/src/index.ts` | [AC2](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 4 | Support virtual clock advancement for Wait and Polling nodes in `simulation.ts` | [AC2](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 5 | Support Agent `unclaimedTimeoutMs` and `timedOut: true` fixtures in `simulation.ts` | [AC3](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 6 | Support waited `workflow` nodes substitution and failure routing in `simulation.ts` | [AC1, AC4](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 7 | Implement edge/route coverage calculation in simulation receipts and reports | [AC5](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 8 | Write comprehensive test scenarios in `tests/simulation.test.ts` | [AC1-AC5](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 9 | Update documentation (`docs/workflow-simulation.md`, `docs/architecture.md`, `docs/v1.md`) | [AC7](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |
| 10 | Add patch changeset and run test/build/lint verification | [AC7](file:///Users/dan/dev/interlock-worktrees/issue-248/.tasks/issue-248/spec.md#2-acceptance-criteria) |

---

## 3. High-Risk Failure Cases & Direct Checks

| Failure Mode | Direct Check | Expected Outcome |
|---|---|---|
| Virtual clock does not advance when wait node is pending | Run simulation with 1 hour duration wait | Simulation settles in milliseconds with status `passed` |
| Agent work item claimed instead of timed out | Supply Agent fixture with `timedOut: true` on node with `unclaimedTimeoutMs: 5000` | Work is not claimed; engine triggers `work.timed_out`; simulation takes `timeout` port |
| Detached child workflow mistakenly permitted | Configure simulation on workflow with detached child node | Simulation marked `unsupported` up front with explanatory reason |
| Child workflow failure route not taken | Waited child workflow fixture with `error: 'Child failed'` on node with `onFailure: 'route'` | Simulation routes to `failed` port and passes assertion |
| Route coverage overcounts or miscounts edges | Test workflow with 4 edges where only 2 are taken | `coverage.totalEdges === 4`, `coverage.coveredEdges === 2`, `coverage.percentage === 50`, `coverage.untested` lists the 2 unvisited edges |

---

## 4. Verification & Ownership

- **Build stage ownership**:
  - Code changes in `packages/core`, `packages/runtime`, `packages/server`, `packages/mcp`.
  - Comprehensive unit and integration test additions in `tests/simulation.test.ts`.
  - Repository commands: `pnpm test`, `pnpm build`, `pnpm format:check`.
  - Docs updates and patch changeset.
- **Review stage ownership**:
  - Independent verification of diff against requirements AC1-AC7.
  - Verification of boundary conditions (virtual clock, detached rejection, coverage math).
