---
'@type_of/interlock': patch
---

Add opt-in compact responses to MCP start_run and submit_result with detail: "summary". Responses include lifecycle-scoped next work and wait cursors without repeating workflow definitions or execution payloads. Keep existing full defaults and document compact agent execution, including child and detached runs.
