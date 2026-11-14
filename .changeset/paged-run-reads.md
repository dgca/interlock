---
'@type_of/interlock': patch
---

Run lists page by the last run ID read. `runs.list` (and `interlock runs` without flags) accepts optional `limit` (default and maximum 1000) and `afterRunId`, so stores with up to 1000 runs return whole as before and larger stores no longer load every run at once. `runs.find`, MCP `list_runs` and `interlock runs --after-run RUN_ID` accept `afterRunId` for the next page.
