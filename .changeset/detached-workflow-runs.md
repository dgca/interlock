---
'@type_of/interlock': patch
---

Add Start and continue to Workflow nodes. Dispatch a pinned workflow and immediately return its run ID, workflow ID, and version, while preserving Wait for result as the default. Independent runs survive parent completion or cancellation, can be retried directly, and remain visible in Runs with links to their launching execution. Include durable dispatch, Batch support, and CLI and MCP lifecycle guidance.
