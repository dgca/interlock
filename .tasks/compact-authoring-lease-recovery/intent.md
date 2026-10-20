# Compact authoring and lease recovery

## Problem and outcome

Workflow authors receive large repeated definitions and unchanged diagnostics. Executors can lose a run after missed renewals even when their work survives in files. Give agents compact authoring responses and a bounded reclaim path without changing existing consumers' defaults.

## Scope and decisions

- Issues [#123](https://github.com/dgca/interlock/issues/123) and [#122](https://github.com/dgca/interlock/issues/122), including the reporting agent's replies on 2026-10-20, supply the examples and requested behavior.
- The user accepted the revised recommendation with “Let's do it. Follow your heart” and selected “Use the SDLC workflow.” Planning uses automatic review under that authorization. Pause for unresolved material human decisions.
- Include compact authoring acknowledgments, reduced edit diagnostics without weakening validation, missing output schemas, additive CLI flags, optional separate expiry budgets, and actionable claim recovery errors.
- Preserve full authoring and diagnostics defaults, CLI defaults, and expiry behavior for nodes without the new policy. Defer late submission, expired renewal, default changes, and broader retry automation.
- Finish locally after independent review. No release or merge is authorized by this task.
- Follow repository package boundaries. Keep user data and unrelated checkout changes intact. Describe current behavior explicitly in docs and tool guidance.

## Task identity

- Branch: `codex/compact-authoring-lease-recovery`
- baseCommit: `b662361f4a8604f6895ec756951d2d1be2c28b15`
- SDLC run: `2ba73f29-b51e-4bba-8be9-271361aaa2eb`, published version 4
- Checkout: `/Users/dan/.codex/worktrees/compact-mcp-continuation/interlock`
- Artifacts: `.tasks/compact-authoring-lease-recovery/`

No unresolved product decisions. See [spec.md](spec.md) for behavior and [plan.md](plan.md) for implementation and evidence.
