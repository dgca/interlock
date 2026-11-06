# External-input node intent

## Problem

A workflow waiting for a GitHub comment or another external answer currently relies on an integration to claim an Agent assignment or on a polling Wait. The integration has to track which visit the answer belongs to, handle duplicates and corrections, and recover after a lost response. A polling Wait can advance as soon as it sees a match, before the integration is ready to accept it.

## Outcome

When a run reaches an External input node, the run waits for a caller to submit and explicitly accept a JSON value. The caller addresses the exact waiting execution. Interlock validates submissions, retains the latest pending revision, and records acceptance before the run advances. This lets an integration recover after retries or restart and lets an operator verify what was accepted.

For a deploy approval, a GitHub integration can verify the commenter, submit their answer, and replace it if a correction arrives. It accepts the exact revision it intends to approve, then uses the acceptance receipt to decide when to acknowledge the answer on GitHub.

## Scope

- Add a first-class node, authorable through the workflow editor and definition format. Use the shared server interface for HTTP, MCP, and CLI operations.
- Persist revisioned submissions and acceptance receipts. Scope them to a single node execution so each loop visit and Batch item is independent.
- Let a hold block acceptance while allowing corrections. Releasing a hold makes the latest revision eligible for explicit acceptance.
- Show the wait and its progress in run inspection and bounded briefings. Keep submitted values available on a targeted read.
- Preserve pending state and receipts across restart. Cancellation closes the wait. Workflow exports carry the node definition.
- Preserve current workflow execution, Agent assignment and hold behavior, and keep MCP discovery compact.

External integrations verify the sender and own writes back to their systems. Interlock records its own acceptance and workflow advancement. The integration reconciles outside writes using the receipt. Interpretation of free-form answers can happen in a subsequent Agent node.

## Decisions

- Build the explicit submit and accept flow shown to the requester. Approval applies to the named revision. The requester responded, "Ah, I see. Yeah, sounds super useful. Let's build it."
- Use the published SDLC workflow. The requester selected "Use Interlock’s published SDLC workflow." Run `b168284a-1c50-4f49-8dc7-e0c36dd83997` is pinned to version 4. Its review policy is `auto`.
- Open a PR and have a subagent review it after opening, in addition to the workflow's fresh-context review before delivery. Source is the requester's standing instruction for issue work.
- An acceptance hold covers the selected run and its attached child workflows and Batch items. Detached runs stay independent. The requester selected, "This run and its attached child workflows and Batch items. Detached runs stay independent. (Recommended)"

## Task branch

- Branch `codex/external-input-node`
- Base commit `df51cdafec427769321e768f1397cb6ebbcb46ec`

## Source

[Interlock issue #207](https://github.com/dgca/interlock/issues/207) and the follow-up conversation about an integration submitting and accepting deploy approval.
