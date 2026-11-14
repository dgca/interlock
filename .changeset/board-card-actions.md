---
'@type_of/interlock': patch
---

Add held starts and board card actions. A start with `hold: { reason }` stays queued in the Backlog until released. Cards on typed and stage boards offer Open run, Cancel run, Move to backlog and Release when the run allows them. Hold and release through `interlock board hold|release` and MCP `manage_pause`.
