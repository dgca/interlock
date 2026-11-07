# Implementation Plan: Accept Run-Level Observer Usage Outside Claim Attempts (Issue #204)

## Baseline Information
- **Task Branch**: `feat/issue-204`
- **Base Commit**: `1c9c42209a51e4476de5c6aa14dadd421cf78e33`
- **Issue**: dgca/interlock#204
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-204`
- **Intent Reference**: See [.tasks/issue-204/intent.md](intent.md)
- **Specification Reference**: See [.tasks/issue-204/spec.md](spec.md)

---

## 1. Intended Code Areas & Changes

### 1.1 Core Contracts & Types (`packages/core`)
- **`packages/core/src/usage.ts`**:
  - Export constant `RUN_USAGE_GRACE_MS = 60 * 60 * 1000` (1 hour).
  - Define `RunUsageReport`:
    ```typescript
    export interface RunUsageReport {
      id: string; // `${runId}:${streamId}`
      runId: string;
      streamId: string;
      session?: SessionIdentity;
      source: 'observer';
      snapshot: UsageSnapshot;
      reportedAt: string;
    }
    ```
  - Extend `reportUsageSchema` with optional `runId`, `streamId`, and `session`:
    - Keep `.innerType().shape` compatible for MCP reflection.
    - SuperRefine validates either:
      - Attempt report: `workId` and `attempt` required; `token` required if `source === 'executor'`, omitted if `source === 'observer'`; `runId` and `streamId` disallowed.
      - Run-level report: `runId` required; `workId`, `attempt`, and `token` disallowed; `source` must be `'observer'`; optional `streamId` and `session`.
  - Update `summarizeUsage(attempts: UsageAttempt[], runReports: RunUsageReport[] = [])`:
    - Incorporate models from all `runReports` into tokens and cost aggregation.
    - Compute `final` considering both attempt reports and run reports.
    - Return `runStreams` and `finalRunStreams` counts.
- **`packages/core/src/budgets.ts`**:
  - Update `evaluateBudget(policy: BudgetPolicy, attempts: UsageAttempt[], runReports: RunUsageReport[] = [])`:
    - Claims limit: continues to count `attempts.length` only.
    - Input/output token limits: evaluated against `totals.tokens[metric]`.
    - Cost limits: evaluated against combined attempt + run report models.
    - `unknownUsage`: incomplete/non-final run reports block or warn matching policy.
- **`packages/core/src/index.ts`**:
  - Export `RunUsageReport`, `RUN_USAGE_GRACE_MS`.

### 1.2 Storage & History (`packages/storage`)
- **`packages/storage/src/history.ts`**:
  - Add `'runUsage'` to `scoped` collection array. Ensures automatic cleanup in `deleteHistoryDocuments` and inclusion in `historyInventory`.

### 1.3 Runtime Engine (`packages/runtime`)
- **`packages/runtime/src/usage.ts`**:
  - Add collection constant: `const runUsageCollection = 'runUsage';`.
  - Implement `runReportsForRuns(scope: Set<string>): RunUsageReport[]`.
  - Update `report(input: UsageReportInput)`:
    - If `runId` provided:
      - Retrieve run from `this.store.get<Run>('runs', runId)`. If missing, throw `InterlockError('Run not found')`.
      - Check status: if terminal (`completed`, `failed`, `cancelled`), ensure `Date.now() - Date.parse(run.updatedAt) <= RUN_USAGE_GRACE_MS`. Otherwise throw `InterlockError('Run-level usage reports are only accepted while the run is active or within 1 hour after it ends')`.
      - Derive `streamId`: explicit `streamId` ?? (session ? `${session.executorId}:${session.sessionId}` : 'default').
      - Retrieve existing report for `${runId}:${streamId}`.
      - Enforce idempotency (identical sequence/payload -> `applied: false`), stale sequence error, conflicting sequence error, immutable final snapshot, and `assertCumulative(previous, snapshot)`.
      - Put `RunUsageReport` to `runUsageCollection`.
      - Call `this.notify(runId)`.
      - Return `{ runId, streamId, source: 'observer', sequence: snapshot.sequence, applied: true }`.
  - Update `removeRuns(runIds: Set<string>)`:
    - Remove scoped `runUsage` records when runs are purged.
  - Update `read(input: UsageQuery)`:
    - Load scoped `RunUsageReport` records via `this.runReportsForRuns(scope)`.
    - Pass `runReports` to `summarizeUsage(attempts, runReports)`.
    - When `groupBy === 'run'`: include run reports for each run in that run's totals.
    - When `groupBy === 'node'`: add run reports under group `key: JSON.stringify([runId, '__run__'])`, `label: 'Run-level usage'`, `nodeId: null`.
    - When `groupBy === 'attempt'`: include run reports as distinct entries with `attempt: null`, `workId: null`, `streamId`, `label: 'Run-level usage'`, `source: 'observer'`.
    - When `groupBy === 'worker'`: group by `session?.executorId ?? 'observer'`.
- **`packages/runtime/src/budgets.ts`**:
  - Pass `this.usage.runReportsForRuns(scope)` to `evaluateBudget(...)` in `evaluations()`.

### 1.4 Server & MCP (`packages/server` & `packages/mcp`)
- **`packages/mcp/src/server.ts`**:
  - Update `report_usage` tool description to document both attempt-level and run-level observer reporting.
  - Update `get_run_usage` tool description.
- **`packages/cli/src/commands.ts`**:
  - Update CLI help text for `report-usage` to show run-level reporting syntax (`runId`, `streamId`, `session`).

### 1.5 Tests
- **`packages/runtime/test/usage.test.ts`**:
  - Add tests for:
    - Run-level observer reporting on active runs (initial, cumulative update, final snapshot).
    - Idempotency with duplicate identical payload (`applied: false`).
    - Stale sequence and conflicting sequence rejections.
    - Final report immutability.
    - Cumulative monotonicity (cannot remove models or decrease counts).
    - Multi-stream isolation (two streams on same run don't collide).
    - Grace window acceptance within 1 hour of run completion; rejection after 1 hour.
    - `get_run_usage` totals incorporating run-level reports with `includeDescendants`.
    - Grouping behavior for `run`, `node`, `attempt`, `worker`.
- **`packages/runtime/test/budgets.test.ts`**:
  - Add tests for:
    - Run budget token limits including run-level observer reports.
    - Run budget cost limits including run-level observer reports.
    - `unknownUsage: 'block'` blocking when run-level report is non-final; clearing when final report submitted.
    - `unknownUsage: 'allow'` warning when run-level report is non-final.
    - Claims limit remaining unaffected by run-level reports.
- **`packages/mcp/test/server.test.ts`**:
  - Test `report_usage` tool with run-level payload over transport.

### 1.6 Documentation & Changeset
- Update `docs/usage-reporting.md`, `docs/run-budgets.md`, `docs/architecture.md`, and `docs/v1.md`.
- Add patch changeset for `@type_of/interlock`.

---

## 2. Risk Analysis & Verification Plan

| Risk | Mitigation & Direct Check | Planned Stage |
| --- | --- | --- |
| MCP tool reflection break | Preserve `reportUsageSchema.innerType().shape` using `z.object(...).superRefine(...)` instead of `z.union`. Verify with transport tests. | Build |
| Collision between multiple observer sessions | Key run-level streams by `${runId}:${streamId}` and derive `streamId` from session or explicit input. Test multi-stream execution. | Build |
| Database leak on history deletion | Add `'runUsage'` to `scoped` in `packages/storage/src/history.ts`. Test history deletion cascades to `runUsage`. | Build |
| Budget undercounting or double-counting | Test that run-level usage is added exactly once to budget consumption and does not alter attempt claim counts. | Build |
| Stale reports on ancient runs | Verify that runs completed over 1 hour ago reject run-level reports with explicit error. | Build |

---

## 3. Execution Sequence
1. Update `packages/core/src/usage.ts` and `packages/core/src/budgets.ts`.
2. Update `packages/storage/src/history.ts`.
3. Update `packages/runtime/src/usage.ts` and `packages/runtime/src/budgets.ts`.
4. Update `packages/mcp/src/server.ts` and `packages/cli/src/commands.ts`.
5. Write and execute test suites in `packages/runtime/test/` and `packages/mcp/test/`.
6. Run full verification: `pnpm test`, `pnpm build`, `pnpm format:check`.
7. Update documentation files and add changeset.
8. Commit all changes to `feat/issue-204`.
9. Submit `plan` and `build` SDLC workflow steps.
