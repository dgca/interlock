---
'@type_of/interlock': patch
---

Add compact run briefings, targeted input/output reads, and cancellable change waits through MCP and the shared API. Briefings distinguish claimed work, timers, Batch progress, and independent detached runs. Sequence cursors recover explicitly after restart. Database schema 3 adds transactional revision tracking with a pre-upgrade backup while preserving existing workflow and run records.
