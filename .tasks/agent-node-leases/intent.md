# Agent node leases

## Outcome

Long coding and review assignments should have an appropriate claim duration without depending on every worker to supply an override. Expiration should be identifiable in run events so workers can diagnose and recover from it.

## Source and authorization

Follow-up to https://github.com/dgca/interlock/issues/118. The user delegated scope and implementation: “Make a plan for what to tackle next, and then use the SDLC workflow to implement. Trust your gut in regards to what we should fix.” Earlier discussion deferred lease changes until the summary-response work merged. That work is merged as PR #119.

Use optional per-Agent-node lease durations and distinct expiry reporting. Explicit caller overrides win. Preserve the five-minute fallback, attempt accounting, and strict token expiry. Include editor support, agent-facing instructions, tests, and a patch changeset. Continue through independent review and a reviewable PR; do not merge or publish.

## Scope and constraints

The node setting belongs to the published workflow snapshot. Existing definitions and callers that omit the setting retain their behavior. Renewal without an override uses the effective duration selected when claiming. Expiry remains a failed attempt and cannot authorize a late submission.

Defer separate expiration/failure budgets, late-token acceptance, automatic heartbeats, a global default increase, and edits to the user's published SDLC workflow. Keep the user's databases and unrelated checkouts untouched. Documentation must describe current behavior without assuming historical context.

## Work context

Repository: /Users/dan/.codex/worktrees/compact-mcp-continuation/interlock
Branch: codex/agent-node-leases
Base: 6d714996ad6a3a9d27e22392ef7626c1a92e5258
Artifacts: .tasks/agent-node-leases/
SDLC v4 run: 98a3fec0-99cb-48e1-9a39-e22936fcb3d9 (isolated temporary database, exact published export).

## Open questions

None requiring a human decision. Implementation details and evidence belong in the specification and plan.
