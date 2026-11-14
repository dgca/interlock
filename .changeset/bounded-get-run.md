---
'@type_of/interlock': patch
---

`get_run`, `runs.get` and `interlock run` now keep responses under 64 KiB for long runs. When the full inspection would be larger, the response omits the workflow definition and every run, execution and assignment field over 1 KiB, lists each omitted field's size in `omittedBytes`, and adds `compacted` with the full size and how to read the rest. Read one step with `get_run_result`, or pass `full: true` (CLI `--full`) for the complete response. Runs under 64 KiB return exactly what they did before, and the run page still loads everything.
