# Specification: M10: Workflow performance and cost report (interlock report)

## Overview and Reference
This specification defines the functional requirements, schemas, storage aggregations, runtime reporting engine, server route, CLI command, MCP tool, and UI view for the `interlock report` workflow performance and cost reporting operation.
For problem statement, goals, and constraints, see [intent.md](intent.md).

## Acceptance Criteria

### AC1: Core Report Schemas and Contracts (`packages/core`)
- In `packages/core/src/report.ts` (and exported from `packages/core/src/index.ts`):
  - **Query Filter (`ReportFilter`)**:
    - `workflowId?: string` (optional: filter to a specific workflow or entire library if omitted)
    - `since?: string` (ISO timestamp for start of window, optional)
    - `until?: string` (ISO timestamp for end of window, optional)
    - `limit?: number` (max runs to sample/aggregate, default 500, max 5000)
  - **Percentile Summary (`DistributionMetric`)**:
    - `count: number`
    - `min: number | null`
    - `median: number | null`
    - `p90: number | null`
    - `max: number | null`
  - **Stage Duration (`StageDurationMetric`)**:
    - `stage: string`
    - `durationMs: DistributionMetric`
    - `runCount: number`
  - **Node Duration (`NodeDurationMetric`)**:
    - `nodeId: string`
    - `label: string`
    - `kind: string`
    - `stage?: string | null`
    - `durationMs: DistributionMetric`
    - `executionCount: number`
  - **Claim Wait Breakdown (`ClaimWaitReport`)**:
    - `newSession: DistributionMetric` (time in ms from work available to claimed for new sessions)
    - `continuingSession: DistributionMetric` (time in ms from work available to claimed for continuing sessions)
    - `totalAttempts: number`
    - `leaseExpiries: number`
    - `failures: number`
    - `h7Recoveries: number` (transient retries, continuation turns, refusal recoveries)
    - `h12Stalls: number` (stalls recorded in history)
  - **Usage & Cost Breakdown (`UsageCostReport`)**:
    - `tokens`:
      - `inputTokens: number`
      - `outputTokens: number`
      - `cachedInputTokens: number`
      - `reasoningOutputTokens: number`
    - `costs`: Array of `{ currency: string; totalAmountMicros: number; formatted: string }`
    - `coverage`:
      - `measuredPercentage: number` (percentage of attempts with measured usage)
      - `unknownPercentage: number` (percentage of attempts with unknown usage)
      - `measuredAttempts: number`
      - `unknownAttempts: number`
      - `totalAttempts: number`
    - `byRun`: Array of `{ runId: string; inputTokens: number; outputTokens: number; cost: number | null; currency?: string; measured: boolean }`
    - `byNode`: Array of `{ nodeId: string; label: string; inputTokens: number; outputTokens: number; cost: number | null; currency?: string; measuredPercentage: number }`
    - `byModel`: Array of `{ model: string; provider: string; inputTokens: number; outputTokens: number; cost: number | null; currency?: string; count: number }`
    - `byProvider`: Array of `{ provider: string; inputTokens: number; outputTokens: number; cost: number | null; currency?: string; count: number }`
  - **Terminal Outcomes Breakdown (`TerminalOutcomesReport`)**:
    - `totalRuns: number`
    - `completedRuns: number`
    - `failedRuns: number`
    - `cancelledRuns: number`
    - `activeRuns: number`
    - `exitNodes`: Array of `{ nodeId: string; label: string; count: number; percentage: number }`
    - `unattendedCompletionRate: number` (percentage of runs completing unattended)
    - `humanEscalationRate: number` (percentage of runs requiring human intervention or reaching escalation exit)
  - **Complete Report (`WorkflowReport`)**:
    - `filter`: `ReportFilter`
    - `generatedAt`: string (ISO timestamp)
    - `window`: `{ since: string | null; until: string | null }`
    - `summary`:
      - `totalRuns: number`
      - `durationMs: DistributionMetric`
      - `admissionQueueWaitMs: DistributionMetric` (H8 admission queue wait)
      - `humanWaitMs: DistributionMetric` (human wait time)
    - `stages`: `StageDurationMetric[]`
    - `nodes`: `NodeDurationMetric[]`
    - `claims`: `ClaimWaitReport`
    - `usage`: `UsageCostReport`
    - `terminalOutcomes`: `TerminalOutcomesReport`
  - Zod schemas for all of the above: `reportFilterSchema`, `distributionMetricSchema`, `workflowReportSchema`, etc.

### AC2: Storage Aggregations and Runtime Reporting Engine (`packages/storage`, `packages/runtime`)
- In `packages/storage/src/report.ts` (or `packages/storage/src/index.ts`):
  - Helper queries to retrieve runs, work requests, attempts, stalls, and usage within a time window (`since`, `until`) and optional `workflowId`.
- In `packages/runtime/src/report.ts`:
  - `generateReport(store: Store, engine: Engine, filter: ReportFilter): Promise<WorkflowReport>`:
    - Calculates percentile distributions (min, median, p90, max) for:
      - Run durations (`endedAt - createdAt` or terminal event time).
      - Admission queue wait (H8) (`admittedAt - queuedAt` when queued, 0 if admitted immediately).
      - Human wait (duration in external input wait, human request pause, or needs_human holds).
      - Time per stage (H4) (median and p90).
      - Time per node (median and p90).
    - Calculates claim wait split by new session vs. continuing session.
    - Aggregates attempts, lease expiries, failures, H7 recoveries (recovery events on managed executions), and H12 stalls.
    - Aggregates usage tokens and costs with explicit measured vs unknown coverage percentages, grouped by run, node, model/alias, and provider.
    - Groups terminal outcomes by Exit node, computing unattended completion rate vs human escalation rate.

### AC3: Shared Server API Route (`packages/server`)
- In `packages/server/src/router.ts`:
  - Add `report: t.router({ summary: t.procedure.input(reportFilterSchema).query(...) })` (or `system.report`).
  - Calls `engine.report(input)` and returns `WorkflowReport`.

### AC4: CLI Command `interlock report` (`packages/cli`)
- In `packages/cli/src/commands.ts` & `packages/cli/src/bin.ts`:
  - Add command `interlock report [--workflow <id>] [--since <date>] [--until <date>] [--json]`:
    - Calls client query `report.summary`.
    - If `--json`: formats raw JSON.
    - If formatted table output: displays:
      - Window and run summary (total runs, duration med/p90, queue wait med/p90, human wait med/p90).
      - Stage durations (table with stage, count, median, p90).
      - Node durations (table with top nodes by duration).
      - Claim metrics (new vs continuing session wait, attempts, lease expiries, failures, H7 recoveries, H12 stalls).
      - Usage & Cost attribution (spend by model & provider, token totals, coverage percentages).
      - Terminal outcomes (exit node breakdown, unattended completion %, escalation %).

### AC5: MCP Tool `get_workflow_report` (`packages/mcp`)
- In `packages/mcp/src/server.ts`:
  - Register compact MCP tool `get_workflow_report` (or `workflow_report`).
  - Concise description to stay strictly under discovery byte budget.
  - Returns bounded report summary.
  - Update tool count in tests (e.g. `tests/*Transport.test.ts`).

### AC6: UI Performance and Cost Report View (`packages/ui`)
- In `packages/ui`:
  - Add Report route `/report` or `/workflows/:id/report`.
  - Accessible from Navigation sidebar ("Report" / "Analytics").
  - Displays:
    - Filters: Workflow selector, date/time range presets (24h, 7d, 30d, all).
    - Summary stat cards: Run Duration (p50/p90), Admission Wait (H8), Human Wait, Unattended Completion Rate.
    - Stages & Nodes duration table / visual bars.
    - Claim Latency & Reliability card (new vs continuing session wait, lease expiries, recoveries, stalls).
    - Model Usage & Spend breakdown by Provider and Model/Alias with coverage indicator.
    - Exit Nodes terminal distribution chart/table.

### AC7: Tests, Documentation & Changeset
- Tests in `tests/report.test.ts` verifying:
  - Metric distributions (median and p90 calculations).
  - Stage and node duration aggregations.
  - Claim wait latency (new vs continuing sessions).
  - Attempts, lease expiries, failures, H7 recoveries, and H12 stalls counts.
  - Usage and cost attribution across runs, nodes, models, and providers with coverage percentages.
  - Terminal outcomes grouped by Exit node.
- Documentation updates:
  - `docs/usage-reporting.md`: add section on Performance & Cost Reporting (`interlock report`).
  - `docs/architecture.md`: document reporting engine and aggregation.
  - `README.md`: include `interlock report` CLI and MCP capability.
  - `docs/v1.md`: document reporting limits and capabilities.
- Patch changeset for `@type_of/interlock`.
