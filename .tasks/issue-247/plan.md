# Implementation Plan: M10: Workflow performance and cost report (interlock report)

## Overview and Reference
This document plans the implementation and verification of the unified `report` performance and cost reporting operation across `packages/core`, `packages/storage`, `packages/runtime`, `packages/server`, `packages/cli`, `packages/mcp`, and `packages/ui`.
For acceptance criteria, refer to [spec.md](spec.md); for problem and scope, refer to [intent.md](intent.md).

## Intended Code Areas

### 1. `packages/core` (Maps to AC1)
- `packages/core/src/report.ts`:
  - Define `ReportFilter`, `DistributionMetric`, `StageDurationMetric`, `NodeDurationMetric`, `ClaimWaitReport`, `UsageCostReport`, `TerminalOutcomesReport`, `WorkflowReport` and their Zod schemas:
    - `reportFilterSchema`: `{ workflowId?: string, since?: string, until?: string, limit?: number }`
    - `distributionMetricSchema`: `{ count: number, min: number | null, median: number | null, p90: number | null, max: number | null }`
    - `stageDurationMetricSchema`: `{ stage: string, durationMs: DistributionMetric, runCount: number }`
    - `nodeDurationMetricSchema`: `{ nodeId: string, label: string, kind: string, stage?: string | null, durationMs: DistributionMetric, executionCount: number }`
    - `claimWaitReportSchema`: `{ newSession: DistributionMetric, continuingSession: DistributionMetric, totalAttempts: number, leaseExpiries: number, failures: number, h7Recoveries: number, h12Stalls: number }`
    - `usageCostReportSchema`: `{ tokens, costs, coverage: { measuredPercentage, unknownPercentage, measuredAttempts, unknownAttempts, totalAttempts }, byRun, byNode, byModel, byProvider }`
    - `terminalOutcomesReportSchema`: `{ totalRuns, completedRuns, failedRuns, cancelledRuns, activeRuns, exitNodes: [{ nodeId, label, count, percentage }], unattendedCompletionRate, humanEscalationRate }`
    - `workflowReportSchema`: `{ filter, generatedAt, window, summary: { totalRuns, durationMs, admissionQueueWaitMs, humanWaitMs }, stages, nodes, claims, usage, terminalOutcomes }`
- `packages/core/src/index.ts`:
  - Export types and schemas from `report.ts`.

### 2. `packages/storage` & `packages/runtime` (Maps to AC2)
- `packages/storage/src/report.ts` / `packages/storage/src/index.ts`:
  - Queries for runs, work, attempts, usage, stalls within time window (`since`, `until`) and optional `workflowId`.
- `packages/runtime/src/report.ts`:
  - Implement `generateWorkflowReport(store: Store, engine: Engine, filter: ReportFilter): WorkflowReport`:
    - Collect runs matching `workflowId` (if supplied) and window.
    - Calculate percentile distributions (min, median, p90, max):
      - Run durations (`endedAt - createdAt` or terminal event time).
      - Admission queue wait (H8) (`admittedAt - queuedAt` when queued, 0 if admitted directly).
      - Human wait (external input waits, needs_human holds, pause holds).
      - Stage durations (H4) (median and p90).
      - Node durations (median and p90).
    - Calculate claim wait (time from available -> claimed) split by new vs. continuing session.
    - Aggregate attempts, lease expiries, failures, H7 recoveries (from managed execution recovery events), and H12 stalls (from `stalls` collection).
    - Aggregate usage tokens and costs with explicit measured vs unknown coverage percentages, broken down by run, node, model/alias, and provider.
    - Group terminal outcomes by Exit node to calculate unattended completion rate vs human escalation rate.
- `packages/runtime/src/index.ts`:
  - Expose `report(filter: ReportFilter): WorkflowReport` on `Engine`.

### 3. `packages/server` (Maps to AC3)
- `packages/server/src/router.ts`:
  - Add `report: t.router({ summary: t.procedure.input(reportFilterSchema).query(({ ctx, input }) => ctx.engine.report(input)) })`.

### 4. `packages/cli` (Maps to AC4)
- `packages/cli/src/commands.ts` & `packages/cli/src/bin.ts`:
  - Add command `interlock report [--workflow <id>] [--since <date>] [--until <date>] [--json]`:
    - Queries `client.report.summary.query(input)` (with fallback to local engine).
    - Formats clear terminal report output:
      - Overview & Durations (run duration p50/p90, H8 queue wait p50/p90, human wait p50/p90).
      - Stage & Node latencies.
      - Claim metrics (new vs continuing session wait, expiries, failures, recoveries, stalls).
      - Model Usage & Attributed Cost breakdown with coverage percentages.
      - Terminal outcomes (Exit node distribution, unattended completion %, human escalation %).
    - Outputs JSON if `--json` flag passed.

### 5. `packages/mcp` (Maps to AC5)
- `packages/mcp/src/server.ts`:
  - Register compact MCP tool `workflow_report` (or `get_workflow_report`):
    - Concise description and input schema to respect discovery byte budget.
    - Update tool count in tests (`tests/httpTransport.test.ts`, `tests/stdioTransport.test.ts`).

### 6. `packages/ui` (Maps to AC6)
- `packages/ui/src/features/report/WorkflowReportView.tsx`:
  - Dedicated performance and cost report dashboard.
  - Controls for workflow filtering and time range presets (24h, 7d, 30d, all).
  - Stat cards: Run Duration (median/p90), Admission Wait (H8), Human Wait, Unattended Completion Rate.
  - Stage & Node latency breakdown table.
  - Claim Latency & Reliability card (new vs continuing session wait, lease expiries, failures, recoveries, stalls).
  - Spend & Model attribution cards with measured vs unknown coverage indicators.
  - Terminal outcomes & Exit nodes breakdown.
- `packages/ui/src/routes/paths.ts` & `packages/ui/src/routes/index.tsx`:
  - Add route `/report` and `/workflows/:id/report`.
- `packages/ui/src/components/Sidebar/Sidebar.tsx`:
  - Add navigation item for Report / Analytics.

### 7. Documentation, Tests & Release (Maps to AC7)
- `tests/report.test.ts`:
  - Test metrics aggregation, stage duration calculations, claim wait (new vs continuing), H7/H12 counting, and cost attribution accuracy.
- Documentation updates:
  - `docs/usage-reporting.md`
  - `docs/architecture.md`
  - `README.md`
  - `docs/v1.md`
- Patch changeset for `@type_of/interlock`.

## Implementation Sequence
1. **Core Schemas**: Implement `packages/core/src/report.ts` and export in `packages/core/src/index.ts`.
2. **Storage Queries & Runtime Reporting Engine**: Implement `packages/runtime/src/report.ts` and hook into `Engine.report()`.
3. **Server API**: Expose `report.summary` in `packages/server/src/router.ts`.
4. **CLI Command**: Implement `interlock report` in `packages/cli`.
5. **MCP Tool**: Register `get_workflow_report` in `packages/mcp/src/server.ts` and update discovery transport test tool counts.
6. **UI View**: Implement `WorkflowReportView` in `packages/ui`.
7. **Comprehensive Tests**: Add `tests/report.test.ts`.
8. **Documentation & Changeset**: Update docs and add changeset.
9. **Validation**: Run `pnpm test`, `pnpm build`, `pnpm format:check`.
