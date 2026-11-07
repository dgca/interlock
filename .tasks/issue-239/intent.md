# Detect stalled pipelines and bound Agent attempts

Source: [issue #239](https://github.com/dgca/interlock/issues/239), read live with no comments, and [parent #223](https://github.com/dgca/interlock/issues/223). The user authorized direct SDLC with auto review, PR delivery, isolated final review, and no release.

## Outcome

Operators can find stalled unattended work and opt into bounded managed idle recovery. Agent attempt execution can end after a configured active duration even when leases keep renewing.

## Scope and constraints

Add opt-in library, workflow and node stall policies, Agent attempt deadlines, independent stalled attention and lifecycle events, managed idle recovery, purposeful existing UI controls and shared API/CLI/MCP access. Preserve queue, named pauses, declared holds, budgets, uncertain ownership, claim tickets, session continuity and provider checks. M2 trigger registration is future work.

Use isolated temporary data and fake executors for checks. Preserve real server settings and user data. Keep code boundaries and documented behavior aligned, add a patch changeset, run required checks, then stop for a fresh isolated exact-commit review before push/PR. The parent owns delivery and merge.

## Task identity

Checkout: /Users/dan/dev/interlock-worktrees/issue-239
Branch: feat/issue-239
Original baseCommit: e9179503567b0577dade57e1021c52396b2cc32b
Artifacts: .tasks/issue-239
SDLC run: f2ac1bc9-82f3-430c-9594-494e4333dede

## Questions

No unresolved outcome decisions. Clock semantics are defined in spec.md after inspection of existing holds and input nodes.
