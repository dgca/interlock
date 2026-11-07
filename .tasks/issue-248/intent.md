# Intent: M11: Simulation for parent workflows (waited children, virtual clock & route coverage)

## Baseline Information
- **Task Branch**: `feat/issue-248`
- **Base Commit**: `edfd6cfab93e3144cd5010fc877864e6fb1fa52b`
- **Issue**: dgca/interlock#248
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-248`

## Problem Statement
Runtime fixture simulation was introduced in #223 (`testbench.simulation` / `workflow_simulation`) to test workflow control flow, contract matching, assertions, and substitutions in-memory without model calls or live engines. However, fixture simulation currently has significant limitations:
1. **Unsupported Parent Workflows (Waited Child Workflows)**: Any `workflow` node (even waited child workflows) is rejected as unsupported. Simulating workflows that orchestrate child workflows currently requires deploying to a live engine.
2. **Unsupported Timers and Delays (Wait Nodes)**: `wait` nodes are rejected as unsupported. Workflows with timers, delays, or polling intervals cannot be simulated deterministically.
3. **Unsupported Agent Timeouts**: Agent `unclaimedTimeoutMs` is rejected as unsupported. Testing escalation routes, fallback paths, and timeout routes when an agent fails to claim work in time cannot be simulated.
4. **Unsupported Failure Route Traversal**: `onFailure: "route"` branches on Agent, Script, or Fetch nodes when operations fail or reject are not fully exercised through failure routes in simulation.
5. **No Route / Edge Coverage Analysis**: Simulation receipts and reports do not report route/edge coverage, making it difficult to detect untested branches across fixture suites.

## Desired Outcome
1. **Waited Child Workflow Simulation**:
   - Extend fixture simulation to support waited child workflows (`kind === 'workflow'` where `detached` is false).
   - Support either nested simulation or per-child workflow fixtures so parent workflows invoking child workflows can be verified in-memory.
2. **Deterministic Virtual Clock**:
   - Introduce a deterministic virtual clock into the simulation runtime.
   - Advance virtual time across `wait` nodes and polling checks without real-time wall-clock delays.
3. **Agent Unclaimed Timeouts & Failure Routing**:
   - Support Agent `unclaimedTimeoutMs` via the deterministic virtual clock or fixture configuration, triggering the unclaimed timeout route.
   - Support `onFailure: "route"` branches across Agent, Script, and Fetch nodes during simulation.
4. **Route / Edge Coverage in Simulation Receipts**:
   - Track visited graph edges/routes during simulation execution.
   - Calculate route/edge coverage against the workflow definition's executable transitions.
   - Include route coverage statistics and unvisited transitions in simulation receipts and reports.
5. **Core, Runtime, Server, MCP, Docs & Changeset**:
   - Update `packages/core` schemas and types for child workflow fixtures/options, virtual clock, and coverage receipts.
   - Update `packages/runtime` simulation engine (`simulation.ts`).
   - Expose coverage and capabilities in `packages/server` and `packages/mcp`.
   - Update `docs/workflow-simulation.md`, `docs/architecture.md`, `docs/v1.md`.
   - Comprehensive test suite in `tests/simulation.test.ts`.
   - Patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Developers & Testers**: Can simulate parent-child workflows, timer/polling workflows, and failure recovery flows deterministically with coverage reports.
- **`packages/core`**: Schema updates for fixtures (`simulationFixtureSchema`), simulation results/receipts (`coverage`), and validation rules.
- **`packages/runtime`**: `Simulations` class in `simulation.ts`, supporting virtual clock advancement, child workflow execution/mocking, timeout routes, and edge coverage collection.
- **`packages/server` & `packages/mcp`**: Tool and endpoint interfaces exposing the enriched simulation results and coverage data.
- **Documentation**: `docs/workflow-simulation.md`, `docs/architecture.md`, `docs/v1.md`.

## Settled Decisions
- The simulation engine remains fully local and in-memory; it never performs live network or model calls.
- Detached child workflows (`detached: true`) and continue-as-new continue to be unsupported in fixture simulation (as documented).
- Virtual clock advances deterministically based on pending timers rather than real delays.
- Route coverage measures taken graph transitions / ports relative to available edge definitions.
- Release bump will be a `patch` changeset for `@type_of/interlock`.

## Open Questions
- None.
