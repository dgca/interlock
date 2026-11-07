# Intent: Accept Run-Level Observer Usage Outside Claim Attempts (Issue #204)

## Baseline Information
- **Task Branch**: `feat/issue-204`
- **Base Commit**: `1c9c42209a51e4476de5c6aa14dadd421cf78e33`
- **Issue**: dgca/interlock#204
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-204`

## Problem Statement
Currently, Interlock usage reporting only attributes token counts and costs to specific claim attempts (`workId` + `attempt`). When an executor session serves multiple assignments across a run (for example in a continuity group, or across waits and briefings), tokens spent outside an active claim attempt—such as reading run briefings, resuming after waits, recovering from errors, or awaiting human input—belong to no single attempt.

Because there is no mechanism to record these out-of-attempt tokens, reporting them against an individual attempt would distort per-step accounting, while omitting them means run totals and run budgets undercount actual consumption.

## Desired Outcome
1. **Run-Level Observer Reporting**:
   - Observers can report usage directly for a `runId` without providing a `workId`, `attempt`, or `token`.
   - Support multiple observer streams per run keyed by session identity (`executorId` and/or `sessionId`, or `streamId`) so reports from different sessions/executors do not overwrite each other.
   - Run-level reports use the same metrics (`ModelUsage`), cumulative sequences, duplicate idempotency, monotonic update checks, cost attribution rules, and finality semantics as attempt reports.
   - Run-level reports are accepted while the run is active and for a bounded grace period after the run concludes (to allow late measurements to be collected and submitted).

2. **Integration into Usage Inspection (`get_run_usage` / `runs.usage`)**:
   - Run-level usage is included once in run usage totals. When `includeDescendants` is enabled, run-level usage of scoped descendant runs is also included once.
   - In usage grouping (e.g. `groupBy: 'run'`, `node`, `worker`, `attempt`), run-level observer streams are clearly labelled and distinct from attempt-level usage.

3. **Integration into Run Budgets**:
   - Run budgets count run-level usage streams alongside attempt usage under identical rules:
     - Configured limits (tokens, cost) include run-level usage metrics.
     - `unknownUsage: 'block'` blocks new claims if any active or ended run-level stream lacks final figures for configured metrics, while `unknownUsage: 'allow'` allows claims with warnings.
     - Safe integer overflow and currency separation apply consistently.

4. **Preserve Attempt-Level Reporting**:
   - Existing attempt-level executor and observer reporting contracts remain completely unchanged.
   - Documentation clearly distinguishes attempt-level reporting (for work executed during a claim) from run-level reporting (for session/orchestrator overhead outside claims).

5. **Documentation & Changeset**:
   - Update `docs/usage-reporting.md`, `docs/run-budgets.md`, `docs/architecture.md`, `docs/v1.md`, and MCP tool schemas/descriptions.
   - Add a patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Measuring Observers / Harnesses**: Can report session overhead, orchestrator prompts, and inter-assignment tokens directly against the run.
- **`packages/core`**: Update `reportUsageSchema`, usage aggregation, budget evaluation types and schemas.
- **`packages/storage`**: Persist run-level usage streams (e.g., in a dedicated collection or indexed within usage receipts).
- **`packages/runtime`**: Update `Usage` class and `Budgets` class to record, aggregate, and evaluate run-level streams; enforce bounded post-run acceptance window.
- **`packages/server` & `packages/mcp`**: Expose run-level reporting options in `reportUsage` and `report_usage`.
- **`packages/ui`**: Display run-level observer streams in usage tables / run inspector without colliding with node attempts.

## Settled Decisions
- **Stream Identification**: Run-level observer streams are keyed by `runId` and a stream identifier derived from `streamId` or `session: { executorId, sessionId }` (defaulting to `'default'` if unspecified).
- **Grace Period / Acceptance Window**: Active runs always accept reports. For completed, failed, or cancelled runs, reports are accepted for a bounded window (e.g., 10 minutes or 1 hour) after the run's `endedAt` to capture trailing metrics without accepting arbitrary writes to long-settled runs.
- **Precedence & Combination**: Run-level usage represents unassigned run/session overhead. It is summed with attempt usage in run totals and budget checks, not overwritten by attempt usage.
- **Attempt Contracts Untouched**: Attempt reports continue to require `workId` and `attempt` (with executor claim token or ended-attempt observer requirement).

## Open Questions
- None.
