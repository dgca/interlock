---
'@type_of/interlock': patch
---

Let agents propose workflow changes for review. With a workflow's opt-in, agents call MCP `propose_workflow_change` during a claim or as a connected client; the proposal stores `edit_workflow` operations with a title, rationale, source runs and author, within the workflow's allowed node kinds and fields and its open-proposal limits. People list, read, approve (optionally edited), reject or re-apply proposals with `interlock proposals` and the HTTP API. Approval applies the edits as a new draft revision and never publishes. Each proposal carries a fixture simulation of the workflow's saved cases with and without the change.
