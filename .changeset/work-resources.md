---
'@type_of/interlock': patch
---

Add optional exclusive resource requirements to Agent assignments, reserving all names atomically with a claim and exposing resource blockers through existing run tools. Retain uncertain reservations after expiry, cancellation or holds, with explicit stop confirmation before reuse. Add resource settings and recovery controls to the editor and run view, plus a grouped MCP/CLI recovery operation.
