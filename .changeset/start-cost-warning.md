---
'@type_of/interlock': patch
---

An optional start warning projects a workflow's cost from the median of its recent completed runs. Set a threshold with `interlock prices start-warning`; the Start run dialog then warns and asks to start anyway when the median exceeds it. CLI, MCP `start_run` and HTTP `/api` start responses include the projection as information and never refuse a start. Schedules and event triggers start without asking and record a `run.cost_warning` event. Without a threshold nothing changes.
