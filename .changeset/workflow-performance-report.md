---
'@type_of/interlock': patch
---

Add bounded workflow performance and cost reporting across CLI (`interlock report`), MCP (`workflow_report`), shared API (`report.summary` / `system.report`), and UI (`WorkflowReportView` at `/report` and `/workflows/:id/report`), evaluating run durations, H8 admission queue wait, human wait, H4 stage durations, node p50/p90 percentiles, claim wait split by new versus continuing sessions, reliability metrics, model spend/coverage, and terminal Exit node outcomes.
