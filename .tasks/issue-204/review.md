# Review: Accept Run-Level Observer Usage Outside Claim Attempts (Issue #204)

## Review Metadata
- **Task**: Issue #204 - Accept run-level observer usage outside claim attempts
- **Task Branch**: `feat/issue-204`
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-204`
- **Base Commit**: `1c9c42209a51e4476de5c6aa14dadd421cf78e33`
- **Reviewed Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Prior Reviewed Commit**: `null` (First review)
- **Review Scope**: `full`
- **Scope Reason**: Initial complete review of all acceptance criteria for Issue #204
- **Verdict**: `pass`

---

## Verification Results

### Standard Checks
1. **Test Suite**: `pnpm --dir /Users/dan/dev/interlock-worktrees/issue-204 test`
   - Result: Passed (137 test files, 1624 tests passed).
2. **Build & Typecheck**: `pnpm --dir /Users/dan/dev/interlock-worktrees/issue-204 build`
   - Result: Passed (`tsc --noEmit`, UI Vite build, and `scripts/build-package.mjs` completed with exit code 0).
3. **Format Check**: `pnpm --dir /Users/dan/dev/interlock-worktrees/issue-204 format:check`
   - Result: Passed (All matched files use Prettier code style).

### Independent Boundary Verification
An independent test script was executed against the built and runtime packages to exercise boundary states beyond implementer checks:
1. **Schema Boundary**: Verified that whitespace-only `streamId` values are rejected by schema validation (`streamId.trim().min(1)`).
2. **Grace Period Constant**: Confirmed `RUN_USAGE_GRACE_MS` is exported from `@interlock/core` and equals exactly `3,600,000` ms (1 hour).
3. **Multi-Currency & Token Aggregation**: Verified that mixed-currency cost models (e.g. USD and EUR) and token metrics sum properly across both attempt receipts and run-level observer streams.
4. **Cascade Deletion**: Confirmed that `runUsage` records in SQLite/document store are cascaded and purged when workflow run history is deleted (`deleteWorkflow`).

---

## Acceptance Criteria Verification

### Criterion 1: Observer Reporting Outside Attempts
- **Status**: Verified
- **Evidence**: `reportUsageSchema` in `packages/core/src/usage.ts` supports `runId` with `source: "observer"` while omitting `workId`, `attempt`, and `token`. Observers can provide `streamId` or `session` (`{ executorId, sessionId }`) to maintain isolated streams per session. Verified in `tests/usage.test.ts` ("accepts run-level observer reports, enforces cumulative monotonic updates, and supports multi-stream isolation") and transport tests in `tests/transport.test.ts`.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 2: Inclusion in Totals and Distinct Labelling
- **Status**: Verified
- **Evidence**: `summarizeUsage` merges attempt and run-level observer reports into `totals` once. In `Usage.read` (`get_run_usage`), grouping by `run`, `node`, `attempt`, and `worker` incorporates run-level streams and labels them distinctly as `'Run-level usage'` (or `'Run-level usage (<streamId>)'`) with `nodeId: null` and `workId: null`. UI tests in `tests/runUsage.test.ts` verify distinct labelling.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 3: Run Budget Enforcement
- **Status**: Verified
- **Evidence**: `evaluateBudget` in `packages/core/src/budgets.ts` and `packages/runtime/src/budgets.ts` includes `runReportsForRuns(scope)`. Token and cost limits enforce caps against the unified total, and `unknownUsage: "block"` blocks new claims when a run-level observer stream is non-final, clearing when a final report arrives. Claims limit counts attempt reservations only and is unaffected by run-level streams. Verified in `tests/budgets.test.ts`.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 4: Grace Window for Completed Runs
- **Status**: Verified
- **Evidence**: In `packages/runtime/src/usage.ts`, reports are accepted freely for active runs (`pending`, `waiting`, `running`). For ended runs (`completed`, `failed`, `cancelled`), reports within `RUN_USAGE_GRACE_MS` (1 hour) from `run.updatedAt` are accepted, while reports past 1 hour are rejected with an informative error. Verified with fake timers in `tests/usage.test.ts`.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 5: Attempt-Level Backward Compatibility
- **Status**: Verified
- **Evidence**: All existing attempt reporting semantics, executor token requirements, and observer attempt rules remain unchanged. `reportUsageSchema.innerType().shape` is preserved for MCP tool schema generation. Guidance in `docs/usage-reporting.md` explains when to use attempt vs run reporting.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 6: Documentation and MCP Tool Definitions
- **Status**: Verified
- **Evidence**: Updated documentation in `docs/usage-reporting.md`, `docs/run-budgets.md`, `docs/architecture.md`, `docs/v1.md`, CLI help in `packages/cli/src/commands.ts`, and MCP tool definitions in `packages/mcp/src/server.ts`. Stdio and HTTP MCP transports verified in `tests/transport.test.ts`.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

### Criterion 7: Changeset
- **Status**: Verified
- **Evidence**: Valid patch changeset present at `.changeset/run-level-observer-usage.md` targeting `@type_of/interlock`.
- **Evidence Commit**: `edd019ee2201088f46893058b3dec38fc394c207`
- **Source**: checked

---

## Architectural & Standards Compliance
- **Boundaries**: Types and validation reside in `packages/core`, document persistence and cascade cleanup in `packages/storage`, lifecycle and business rules in `packages/runtime`, and transport exposure in `packages/mcp`, `packages/cli`, and `packages/server`.
- **Package Release Rules**: Patch changeset properly specified; root package version reference maintained.
- **Findings**: None.
