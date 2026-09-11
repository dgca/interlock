---
'@type_of/interlock': patch
---

Fix claim renewal shortening long leases when the duration is omitted. CLI `renew` now accepts options JSON with `leaseSeconds`. Omitted renewals across CLI, HTTP, and MCP reuse the original claim duration, including after restart. Older stored claims without a saved duration fall back to 300 seconds. Compatibility: callers that relied on every omitted renewal resetting to 300 seconds must now request that duration explicitly. Explicit overrides apply only to that renewal.

Add `workflowId`, optional `parentRunId`, `rootRunId`, and `rootWorkflowId` to compact work discovery, and root IDs to run summaries. Dispatchers can route nested assignments by their outermost workflow without fetching execution history. Existing databases need no rewrite.
