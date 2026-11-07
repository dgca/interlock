# Specification: Accept Run-Level Observer Usage Outside Claim Attempts (Issue #204)

## Baseline Information
- **Task Branch**: `feat/issue-204`
- **Base Commit**: `1c9c42209a51e4476de5c6aa14dadd421cf78e33`
- **Issue**: dgca/interlock#204
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-204`
- **Intent Reference**: See [.tasks/issue-204/intent.md](intent.md)

---

## 1. Overview & Objectives

Interlock currently records model usage exclusively against specific claim attempts (`workId` + `attempt`). When an executor session or orchestrator spends tokens between assignments (e.g. evaluating continuity briefings, error handling, waiting for human input), those tokens cannot be attributed to an individual attempt.

This specification defines run-level observer reporting:
1. Observers can report usage directly for a `runId` without providing a `workId`, `attempt`, or `token`.
2. Multiple observer streams per run are supported, keyed by session identity (`executorId` / `sessionId`) or explicit `streamId`.
3. Reports enforce the exact same cumulative, idempotency, monotonic, and finality rules as attempt-level reports.
4. Active runs accept reports freely; ended runs accept reports within a bounded grace window (1 hour post-run).
5. Run-level usage is aggregated into `get_run_usage` totals once (including descendant traversal) and labelled distinctly in group breakdowns.
6. Run budgets evaluate run-level usage under the exact same rules as attempt usage, including `unknownUsage` blocking and warnings.
7. Attempt-level reporting contracts remain 100% backward compatible.

---

## 2. Data Contracts & Schema (`packages/core`)

### 2.1 `reportUsageSchema` Updates

The schema `reportUsageSchema` is extended to support both attempt-level and run-level reporting while preserving `reportUsageSchema.innerType().shape` compatibility for MCP and router registration.

```typescript
export const reportUsageSchema = z
  .object({
    // Attempt-level target:
    workId: z.string().min(1).optional(),
    attempt: positive.optional(),
    token: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Required for executor reports; omit for observer reports.'),

    // Run-level target:
    runId: z.string().min(1).optional(),
    streamId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Observer stream identifier; defaults to session or "default".'),
    session: sessionIdentitySchema
      .optional()
      .describe('Optional executor session identity for the observer stream.'),

    // Common properties:
    source: z
      .enum(['executor', 'observer'])
      .default('executor')
      .describe(
        'Executor uses its claim token; observer requires an ended attempt or active/recent run and no token.',
      ),
    snapshot: usageSnapshotSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isRunLevel = value.runId !== undefined;
    const isAttemptLevel = value.workId !== undefined;

    if (!isRunLevel && !isAttemptLevel) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Either workId and attempt, or runId must be provided',
      });
      return;
    }

    if (isRunLevel && isAttemptLevel) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Provide either workId and attempt for attempt usage, or runId for run usage, not both',
      });
      return;
    }

    if (isAttemptLevel) {
      if (value.attempt === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['attempt'],
          message: 'attempt is required when workId is provided',
        });
      }
      if (value.streamId !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['streamId'],
          message: 'streamId is only supported for run-level observer reports',
        });
      }
      if (value.source === 'executor' && value.token === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Executor usage requires the claim token',
        });
      }
      if (value.source === 'observer' && value.token !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Observer usage must omit the claim token',
        });
      }
    } else {
      // Run-level
      if (value.attempt !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['attempt'],
          message: 'attempt is not permitted for run-level usage',
        });
      }
      if (value.source !== 'observer') {
        context.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'Run-level usage reporting requires source: "observer"',
        });
      }
      if (value.token !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Run-level observer usage must omit the claim token',
        });
      }
    }
  });
```

### 2.2 `RunUsageReport` Record Definition

```typescript
export interface RunUsageReport {
  id: string; // key: `${runId}:${streamId}`
  runId: string;
  streamId: string;
  session?: SessionIdentity;
  source: 'observer';
  snapshot: UsageSnapshot;
  reportedAt: string;
}
```

Stream ID resolution:
- If `streamId` is explicitly provided, use `streamId.trim()`.
- Else if `session` is provided: `${session.executorId}:${session.sessionId}`.
- Otherwise, default to `'default'`.

### 2.3 Usage Aggregation (`packages/core/src/usage.ts`)

`summarizeUsage` is extended:
```typescript
export function summarizeUsage(
  attempts: UsageAttempt[],
  runReports: RunUsageReport[] = [],
): UsageSummary
```

- Selected reports include:
  - Attempt selected reports (`selectedUsageReport(attempt)`).
  - Run-level reports (each `RunUsageReport` has `snapshot`).
- Models:
  - FlatMap from all attempt reports + all run reports.
- Finality:
  - `final = (attempts.length > 0 || runReports.length > 0) && reports.every(r => r?.snapshot.final) && runReports.every(r => r.snapshot.final)`.
- Outcomes:
  - Only attempts populate `outcomes` (run reports are out-of-attempt overhead).
- Metric totals:
  - Tokens and cost sums incorporate all scoped models across attempts and run reports.
  - Safe-integer overflow rules apply identically.
- Summary metadata:
  - `attempts`: count of attempts.
  - `reportedAttempts`: count of attempts with reports.
  - `finalAttempts`: count of attempts with final reports.
  - `runStreams`: count of run-level observer streams.
  - `finalRunStreams`: count of run-level observer streams with `final: true`.

### 2.4 Budget Evaluation (`packages/core/src/budgets.ts`)

`evaluateBudget` signature:
```typescript
export function evaluateBudget(
  policy: BudgetPolicy,
  attempts: UsageAttempt[],
  runReports: RunUsageReport[] = [],
): BudgetEvaluationResult
```

- `claims` limit:
  - Evaluated against `attempts.length` (run-level streams do not consume claim counts).
- `inputTokens` & `outputTokens` limits:
  - Evaluated against `totals.tokens[metric]`, which includes run reports.
- `cost` limits:
  - Evaluated across models from attempts and run reports.
  - Cost finality considers both attempts and run reports.
- `unknownUsage`:
  - If `policy.unknownUsage === 'block'` and any attempt or run report is incomplete or non-final, `usage_incomplete` blocks claims.
  - If `policy.unknownUsage === 'allow'`, incomplete usage generates a warning.

---

## 3. Storage & History Retention (`packages/storage`)

### 3.1 Document Collection `runUsage`
- Collection: `'runUsage'`.
- Document key: `${runId}:${streamId}`.
- Value: JSON-serialized `RunUsageReport`.

### 3.2 History & Cascade
In `packages/storage/src/history.ts`:
- Add `'runUsage'` to `scoped` collection list:
  ```typescript
  const scoped = [
    'work',
    'events',
    'usageAttempts',
    'runUsage',
    'workHolds',
    ...
  ];
  ```
- Any history deletion (`deleteHistoryDocuments`) or inventory query (`historyInventory`) for run IDs automatically cascades and includes `runUsage` records.

---

## 4. Runtime Execution (`packages/runtime`)

### 4.1 Reporting Lifecycle & Grace Period
In `Usage.report()`:
- If run-level report:
  - Check that the target run exists in the store. If not, throw `InterlockError('Run not found')`.
  - Check run status:
    - If active (`pending`, `waiting`, `running`), report is accepted.
    - If terminal (`completed`, `failed`, `cancelled`):
      - Compute elapsed time since `run.updatedAt`.
      - Grace window constant: `RUN_USAGE_GRACE_MS = 60 * 60 * 1000` (1 hour).
      - If `Date.now() - Date.parse(run.updatedAt) > RUN_USAGE_GRACE_MS`:
        - Throw `InterlockError('Run-level usage reports are only accepted while the run is active or within 1 hour after it ends')`.
- Sequence & Cumulative Checks:
  - Load existing `RunUsageReport` for `${runId}:${streamId}` if any.
  - If existing:
    - If `snapshot.sequence === existing.snapshot.sequence`:
      - If deep equal: return `{ runId, streamId, source, sequence, applied: false }`.
      - Else throw `InterlockError('A different usage snapshot already uses this sequence')`.
    - If `snapshot.sequence < existing.snapshot.sequence`:
      - Throw `InterlockError('Usage sequence is stale; report current cumulative totals with a higher sequence')`.
    - If `existing.snapshot.final`:
      - Throw `InterlockError('Final usage cannot be changed')`.
    - Enforce `assertCumulative(existing.snapshot, snapshot)`:
      - Cannot remove models.
      - Cannot decrease tokens.
      - Cannot decrease cost or change cost currency/source.
- Storage & Notification:
  - Persist `RunUsageReport` to `'runUsage'`.
  - Advance continuation / notify: `this.notify(runId)`.
  - `this.notify(runId)` triggers `budgets.refresh()`, `resources.refresh()`, and event `work.usage_reported`.
  - Return `{ runId, streamId, source: 'observer', sequence: snapshot.sequence, applied: true }`.

### 4.2 Query & Inspection (`get_run_usage` / `Usage.read`)
In `Usage.read(input)`:
- Resolve scoped runs (anchor run + chain if `includeChain` + descendants if `includeDescendants`).
- Load attempts via `attemptsForRuns(scope)`.
- Load run reports via `runReportsForRuns(scope)` (`this.store.forRuns<RunUsageReport>('runUsage', scope)`).
- Compute `totals`: `summarizeUsage(attempts, runReports)`.
- Grouping:
  - `groupBy: 'run'`:
    - Groups keyed by `runId`. Each group contains attempts for that run and run reports for that run.
    - Group totals computed via `summarizeUsage(runAttempts, runReportsForRun)`.
  - `groupBy: 'node'`:
    - Attempt groups keyed by `[runId, nodeId]`.
    - Run-level reports grouped under key `[runId, null]` (or `[runId, '__run__']`), labelled `nodeId: null, label: 'Run-level usage'`.
  - `groupBy: 'attempt'`:
    - Attempt items have `workId`, `attempt`, `outcome`, etc.
    - Run-level items have `kind: 'run'`, `streamId`, `attempt: null`, `workId: null`, `label: 'Run-level usage'`, `source: 'observer'`, `snapshot: runReport.snapshot`.
  - `groupBy: 'worker'`:
    - Attempt items grouped by `workerId`.
    - Run-level items grouped by `runReport.session?.executorId ?? null`.

---

## 5. Documentation, CLI, and MCP Updates

1. `docs/usage-reporting.md`:
   - Document run-level observer reporting format with examples.
   - Clarify stream keying by `streamId` / `session`.
   - Document bounded post-run acceptance window (1 hour).
   - Document how totals and budgets evaluate run-level usage.
   - Explain when to use attempt reporting (work during claims) vs run reporting (inter-assignment overhead).
2. `docs/run-budgets.md`:
   - Clarify that token and cost limits count run-level observer streams under identical rules.
   - Describe `unknownUsage` behavior with run-level observer streams.
3. `docs/architecture.md` & `docs/v1.md`:
   - Update usage reporting sections to reflect run-level observer capabilities.
4. MCP Server:
   - Update `report_usage` tool description and parameter documentation.
   - Update `get_run_usage` tool description.
5. Changeset:
   - Add patch changeset for `@type_of/interlock`.

---

## 6. Verification & Test Plan

1. **Unit & Runtime Tests (`packages/runtime/test/usage.test.ts` & `budgets.test.ts`)**:
   - Run-level report submission on active runs.
   - Monotonic sequence, idempotency (`applied: false`), stale sequence rejection, conflicting sequence rejection.
   - Immutability of final snapshot.
   - Cumulative monotonic enforcement (cannot remove models or decrease counts).
   - Multi-stream isolation: two sessions reporting for the same run don't collide.
   - Acceptance grace window: reports accepted within 1 hour of run end; reports rejected after 1 hour with informative error.
   - Inspection (`get_run_usage`): run-level usage included once in totals, descendants included properly, grouping by `run`, `node`, `worker`, `attempt`.
   - Run budget evaluation: token limits, cost limits, `unknownUsage: 'block'`, `unknownUsage: 'allow'`, and admission clearing when final reports arrive.
2. **MCP Transport Tests**:
   - Test `report_usage` tool with run-level payload over stdio/HTTP.
3. **Full Build & Format**:
   - `pnpm test`, `pnpm build`, `pnpm format:check`.
