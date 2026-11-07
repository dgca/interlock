# Intent: H10: Execution provenance bindings & node visitCount

## Baseline Information
- **Task Branch**: `feat/issue-237`
- **Base Commit**: `068f6aa6f6705718cb3fe313bf06f6a6488dc202`
- **Issue**: dgca/interlock#237
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-237`

## Problem Statement
Workflows implementing review gates, quality checks, or repair loops currently lack engine-verified metadata regarding who or what executed a node and how many times a node has run:
1. **Unverified Model Provenance**: Verification of which model, harness, provider, effort, or profile executed an Agent node currently relies on external database queries, agent self-reporting, or pass-through Switch ledgers. Self-reporting is vulnerable to agent spoofing or hallucination.
2. **Loop Iteration Tracking**: Counting repair attempts or loop visits currently requires cumbersome custom state variables, external counters, or manual ledger tracking.
3. **Script Isolation**: Scripts running in review or verification stages do not receive authenticated execution provenance about prior node completions through standardized environment or file channels.

## Desired Outcome
1. **Engine-Verified Provenance**: The engine and executor manager automatically capture and record tamper-proof execution provenance on every accepted node execution:
   `{ profileId, harness, sessionId, requestedModel, actualModel, provider, effort, attempt, visitCount, startedAt, endedAt, usage }`.
   This is populated directly by the engine and executor manager upon node completion, cannot be spoofed or overwritten by agent output, and sets unknown values to `null`.
2. **Execution Data Binding Source (`source: "execution"`)**:
   Expose `source: "execution"` with `{ nodeId, path, default, sourceDefault }` in node `inputBindings` and Branch conditions (`switch` and `condition` routing).
   Allow downstream nodes (e.g., a review gate or branch) to inspect the execution provenance of any earlier node directly and safely.
3. **Node Visit Count (`execution.<nodeId>.visitCount`)**:
   Provide `visitCount` representing the 1-based count of completed executions of `<nodeId>` in the current run (and batch scope).
   This enables direct loop control and repair thresholds without manual incrementing or state bookkeeping.
4. **Script Provenance Exposure**:
   Expose execution provenance to Script nodes via the `INTERLOCK_EXECUTION_PROVENANCE_FILE` environment variable (pointing to a JSON file) and/or environment variables, as well as in run inspection data.
5. **Robust Documentation & Changeset**:
   Update `docs/node-data.md`, `docs/agent-workflows.md`, `docs/managed-executors.md`, `docs/architecture.md`, and `docs/v1.md`.
   Add a patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Authors**: Can build resilient loop termination conditions and model verification gates directly using declarative bindings.
- **`packages/core`**: Type definitions for `ExecutionProvenance`, `ValueBinding` with `source: 'execution'`, and schema validation.
- **`packages/runtime`**: Engine node completion tracking (`nodeData.ts`, `continuation.ts`, `scripts.ts`, `index.ts`), visit counting per node in a run, provenance injection into script executions, and binding resolution.
- **`packages/server` & `packages/mcp`**: Run inspection and tool responses reflecting node provenance.

## Settled Decisions
- **Anti-Spoofing Guarantee**: Agent output submitted to an Agent node cannot set or override the provenance fields. The engine/manager records provenance from its own tracking.
- **Null Defaults**: Any unknown or inapplicable provenance fields default to `null`.
- **Visit Count Semantics**: `visitCount` is a 1-based integer tracking how many times the specific `<nodeId>` completed in the current run and batch scope.
- **Binding Contract**: `source: "execution"` supports `nodeId`, `path`, and `sourceDefault`, mirroring `source: "node"` semantics for missing or uncompleted nodes.

## Open Questions
- None. Requirements and scope are well-defined.
