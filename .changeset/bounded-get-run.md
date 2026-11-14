---
'@type_of/interlock': patch
---

`get_run`, `runs.get` and `interlock run` now keep responses under 64 KiB for long runs. When the full inspection would be larger, the response drops the workflow definition and large run, execution and assignment fields (IDs, status and timestamps always stay), truncates long errors, lists children as references, and if still too large keeps only the most recent executions, events and descendants. `omitted` records what is missing and whether to read it with `get_run_result` or `full: true`, and `compacted` gives the full size. Read one step with `get_run_result`, or pass `full: true` (CLI `--full`) for the complete response. Runs under 64 KiB return exactly what they did before, and the run page still loads everything.
