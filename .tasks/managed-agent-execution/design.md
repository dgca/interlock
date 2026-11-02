# Managed Agent execution

## Confirmed scope

Issue #71. Direct implementation, explicitly selected by the user. Claude Code and Codex are required; OpenCode is deferred because native permission, session and recovery behavior deserves its own adapter validation. No Channels or separate monitoring daemon. Use Impeccable for the UI and preserve Interlock's established Mantine identity. The user requested a draft PR while implementation is in progress.

## Architecture

- Portable optional workflow executor reference, with Agent override and explicit null for connected-agent execution. Existing definitions keep their behavior.
- Local revisioned profiles and attempt/session records. No workflow credentials, paths or native sessions in portable exports.
- Server-owned execution manager subscribes to Store changes, with a one-second recovery check. It observes available work without advancing the engine, preventing a notification/pump feedback loop that starves script process completion.
- Shared claim, renewal, budget, resource, usage, submission and bounded failure paths. Adapters own native protocols and never claim/submit independently.
- Claude Agent SDK core with explicit installed executable. Codex app-server over stdio. Installed CLI discovery/version checks make no model calls.
- Independent ungrouped/fresh sessions; manager-owned logical continuity bindings map to native sessions and pin configuration within the run/group.
- Explicit native permission/question responses. Additional Codex sandbox grants and MCP elicitation decline. Read-only tool restrictions are not startup-hook containment.
- Interrupted execution is held and blocks fresh claims until explicit confirmation that the prior session/subprocesses stopped. Native processes are cancelled on timeout, disablement, claim loss and shutdown.
- One grouped MCP tool and corresponding CLI/shared API, with compact work status and on-demand bounded execution details. Local Git trials remain blocked for these adapters until their scoped-executor contract can be met.

## Validation and remaining work

The additional review is recorded in [review.md](review.md). Independent standards and specification reviewers found and verified fixes for process cleanup, uncertain replay, restart usage attribution and captured settings. Parent integration checks added claim/approval expiry guards, scoped native approvals, question validation, finite shutdown and diagnostic draining. The full suite passed 1,158 tests, followed by a focused native check for the last turn-identity guard. Build, package and formatting checks are repeated before pushing. Tests use deterministic native stand-ins, never real accounts.

Before marking ready: finish rendered desktop/mobile checks and Impeccable finish review/documentation. Verify real Claude Code and Codex authentication/permissions deliberately in supported environments; fixture tests do not establish enterprise/subscription compatibility. Keep the patch changeset pending.
