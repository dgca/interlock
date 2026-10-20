---
'@type_of/interlock': minor
---

Default MCP start_run and submit_result to summary responses and list_work to summary assignments. This is a breaking response-shape change: consumers that need workflow definitions, execution history, or complete unclaimed assignments must pass detail: "full" or fields: "full". Explicit full responses and complete claim_work assignments remain supported. UI, CLI, and shared full API responses are unchanged.

Compact mutation responses include a suggested read-only nextCall for result retrieval, failure inspection, or waiting. Tool guidance describes current response contents and directs agents to read persisted final results. See docs/upgrading.md for the 0.2 migration steps.
