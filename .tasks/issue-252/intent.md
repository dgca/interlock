# Intent: L4: Notifications

## Baseline Information
- **Task Branch**: `feat/issue-252`
- **Base Commit**: `c73867f7bb66f76f182775758169414cf48baebc`
- **Issue**: dgca/interlock#252 (Parent #223, Prerequisite M2 #241)
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-252`

## Problem Statement
Operators need timely alerts when unattended runs require human intervention or encounter stalls without having to watch the UI continuously.
1. **Unattended Run Attention Latency**: When an unattended run encounters a state requiring human attention (such as approvals, questions, model choices, recovery, or stalls), operators only discover it if they actively check the Interlock UI or polling clients.
2. **Heavyweight Notification Workflows**: Currently, M2 lifecycle event triggers allow triggering another workflow. However, for simple alerts (e.g., notifying local operators on desktop or sending a lightweight webhook payload to Slack, Discord, or a pager service), configuring and executing an entire handler workflow introduces unnecessary execution overhead, requires published workflow definitions, and consumes engine slots.
3. **Outbound Notification Security and Verification**: External webhook receivers need a tamper-evident mechanism to verify that incoming event payloads originated from the Interlock instance and were not replayed or altered.

## Desired Outcome
1. **Optional Local OS Desktop Notifications for Needs Attention**:
   - Provide opt-in local desktop notifications when runs enter `Needs attention`.
   - Dispatch platform-appropriate desktop alerts (e.g., using macOS `osascript` / notification command or notifier fallback) without interrupting engine execution.
   - De-duplicate alerts so repeated polls or existing attention states do not spam the desktop.
2. **Optional Outbound HMAC-Signed POST Alerts on M2 Lifecycle Events**:
   - Support outbound HTTP POST webhook alerts directly from lifecycle events (`completed`, `failed`, `cancelled`, `needs_attention`, `stalled`).
   - Deliver compact event payloads to configured webhook endpoints with HMAC-SHA256 signatures (e.g., `X-Interlock-Signature-256`, timestamp header) for authenticity and replay protection.
   - Dispatch asynchronously with timeouts and robust error handling so webhook network failures never block or fail the primary workflow engine run.
3. **Configuration & Verification**:
   - Configurable via server/environment options or library settings.
   - Comprehensive test coverage for trigger conditions, signature generation, delivery headers, and error handling.
   - Updated documentation in `docs/architecture.md` and `docs/v1.md`.
   - Patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Operators**: Receive immediate notifications on desktop or in chat/pager systems when attention is required.
- **`packages/core`**: Types and schemas for notification configuration and webhook action payloads/headers.
- **`packages/runtime`**: Lifecycle event dispatcher hook to emit outbound webhooks and desktop alerts on attention transitions.
- **`packages/server`**: Server options and startup wiring for notification settings.
- **`packages/mcp`**: Keep tool discovery under the 300,000 bytes budget.

## Settled Decisions
- Desktop notifications trigger specifically on transitions into `Needs attention`.
- Outbound POST webhooks use HMAC-SHA256 signatures with timestamps for verification.
- Webhook dispatch is non-blocking and handles connection/timeout failures gracefully.
- Prerequisite M2 lifecycle event system is leveraged directly.

## Open Questions
- None. Requirements and scope are clear.
