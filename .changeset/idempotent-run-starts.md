---
'@type_of/interlock': patch
---

Add optional idempotent run starts across MCP, HTTP and CLI, preserving the original attempt after redelivery or restart and preventing old keys from recreating deleted history. Add bounded external-task correlation and lookup through existing run tools.
