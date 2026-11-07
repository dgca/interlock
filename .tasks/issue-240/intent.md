# Authenticated webhook intake

External systems should deliver signed events directly to Interlock without a polling proxy. Operators configure webhook triggers beside schedules, use Secret variables for authentication, and inspect bounded delivery outcomes through UI, CLI and MCP.

Source: GitHub dgca/interlock#240 and parent #223 M1. The coordinator explicitly authorized unattended completion with reviewPolicy auto, ordinary technical decisions, and deferred human UI review. The final independent review remains a separate fresh-context assignment. PR creation and merging wait for the coordinator.

Scope includes signed event identity and time, filters, run starts through existing admission, precise waiting-input delivery, cancellation and acceptance holds, ingress limits, an isolated hooks listener, portable disabled configurations, docs and a patch changeset. Existing schedule behavior and run/pause contracts must remain intact. No credentials, payloads or signatures enter delivery logs or exports.

Success means a configured authenticated event advances exactly its intended target or returns an inspectable bounded rejection. UI, CLI and MCP share the same trigger contracts. There are no unresolved intent decisions.

Task branch: `feat/issue-240`. Original baseCommit: `7f98e35dbd62945b4668e4b35691cdfc5f09defd`.
