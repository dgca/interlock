---
'@type_of/interlock': patch
---

Let agents propose workflow changes for review. With a workflow's opt-in, agents call MCP `propose_workflow_change` during a claim or as a connected client; the proposal stores `edit_workflow` operations with a title, rationale, source runs and author, within the workflow's allowed node kinds and fields and its open-proposal limits. People review proposals in the workflow's new Proposals tab, with the diff against the current draft, the simulation result, edit-before-approve, approve, reject with a reason and re-apply, or with `interlock proposals` and the HTTP API. The run inspector lists proposals beside the step that made them. Approval applies the edits as a new draft revision and never publishes. Each proposal carries a fixture simulation of the workflow's saved cases with and without the change.
