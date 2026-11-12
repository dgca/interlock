---
'@type_of/interlock': patch
---

Retry prompt creation safely after a lost response. The new prompt dialog reuses its request ID, and MCP clients can supply one to recover the saved prompt.
