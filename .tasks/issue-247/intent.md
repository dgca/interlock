# Intent: M10: Workflow performance and cost report (interlock report)

## Baseline Information
- **Task Branch**: `feat/issue-247`
- **Base Commit**: `d6df180d418e5254681b8d6096cb04f7bc041e98`
- **Issue**: dgca/interlock#247
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-247`

## Problem Statement
Operators currently run bespoke scripts against run logs to calculate median step durations, claim wait latencies, human wait times, and total model spend across workflows.
There is no unified, bounded, out-of-the-box reporting facility in Interlock to assess operational performance and cost across CLI, MCP, shared API, and UI. Specifically:
1. **Performance & Latencies**: Operators cannot easily see run durations, admission queue wait latencies (H8 admission queue), human wait latencies, or time per stage (H4 stage lifecycle) and per node (median and p90).
2. **Claim Lifecycle & Stalls**: Claim wait latencies (time from available -> claimed) are not broken down by new vs. continuing sessions, nor are attempts, lease expiries, failures, H7 recoveries, and H12 stalls aggregated into clear operational metrics.
3. **Usage & Attributed Cost**: Model spend (tokens, execution cost) cannot be aggregated across runs, nodes, models/aliases, and providers with explicit transparency on measured vs. unknown usage coverage percentages.
4. **Terminal Outcomes & Automation Rate**: Terminal outcomes are not grouped by Exit node to reliably measure unattended completion rate versus human escalation or failure rates.

## Desired Outcome
Provide an `interlock report` operation delivering bounded performance and cost summaries across CLI, MCP, shared API, and UI:
1. **Core Report Schemas (`packages/core`)**:
   - Define query parameters: optional `workflowId`, time window (`since`, `until`), optional `limit`, grouping options.
   - Define report output structures:
     - Run metrics: count, completed, failed, cancelled, active, run duration percentiles (median, p90), admission queue wait (H8), human wait.
     - Stage metrics: duration per stage (H4) (median, p90).
     - Node metrics: duration per node (median, p90).
     - Claim metrics: claim wait (available -> claimed) split by new vs. continuing session, total attempts, lease expiries, failures, H7 recoveries, and H12 stalls.
     - Usage & Cost metrics: total input/output tokens, attributed cost breakdown per run, node, model/alias, provider, with measured vs. unknown coverage percentages.
     - Terminal outcomes: outcomes grouped by Exit node to measure unattended completion rate vs. human escalation rate.
2. **Storage & Runtime Aggregations (`packages/storage`, `packages/runtime`)**:
   - Add efficient database query aggregations over execution history, runs, work assignments, attempts, and usage records.
   - Support filtering by workflow ID and time window (`since`, `until`).
   - Implement stage duration calculations and cost attribution logic.
3. **Shared Server API (`packages/server`)**:
   - Expose report endpoint (e.g. `report.summary` or `system.report` / `workflow.report`).
4. **MCP Tool (`packages/mcp`)**:
   - Expose a bounded reporting tool (e.g. `get_workflow_report` or `workflow_report`) keeping descriptions compact within discovery byte limits, updating tool counts in transport tests.
5. **CLI Command (`interlock report`)**:
   - Implement `interlock report [--workflow <id>] [--since <date>] [--until <date>] [--json]` with human-readable summary tables and machine-readable JSON output.
6. **UI Reporting View (`packages/ui`)**:
   - Provide a dedicated Report / Analytics view displaying performance charts/cards, claim breakdown, usage & spend by model/provider, and Exit node outcomes.
7. **Documentation, Tests & Changeset**:
   - Comprehensive unit and integration tests verifying metrics aggregation, stage duration calculations, and cost attribution accuracy.
   - Update `docs/usage-reporting.md`, `docs/architecture.md`, `README.md`, `docs/v1.md`.
   - Add patch changeset for `@type_of/interlock`.

## Affected Packages and Systems
- `packages/core`: Report filter and summary schemas and contracts.
- `packages/storage`: Aggregation queries for runs, steps, attempts, usage, and exit nodes.
- `packages/runtime`: Report generator service evaluating stage/node percentiles and cost attribution.
- `packages/server`: Server route for report queries.
- `packages/mcp`: MCP tool for agent report access with bounded summaries.
- `packages/cli`: `interlock report` command.
- `packages/ui`: Performance and cost report visualization.

## Settled Decisions
- The report operation is read-only and operates over historical runs within an optional workflow filter and time window.
- Percentiles calculate median and p90 for run, stage, and node durations.
- Usage explicitly tracks measured vs. unknown coverage percentages.
- Patch changeset for `@type_of/interlock`.

## Open Questions
- None.
