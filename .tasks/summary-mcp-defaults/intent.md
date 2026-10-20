# Compact MCP defaults

## Outcome and scope

Agents should continue workflows without repeatedly loading definitions, prompts, and accumulated execution payloads. This addresses the compact-default portion of [issue #118](https://github.com/dgca/interlock/issues/118), following #115.

Change the MCP defaults for start_run, submit_result, and list_work. Keep explicit full responses available and claim_work complete. Add small actionable continuation guidance and current-state documentation. Preserve existing full shared API, UI, and CLI behavior.

Lease policy, other mutation responses, CLI enhancements, and publication are outside scope. Issue #118 therefore remains partially addressed.

## Authorization

The user deferred lease changes and approved summary defaults, explicit full options, next-call guidance, and a migration path. They accepted the proposed pending minor changeset for 0.2.0 and PR creation with "Sounds great", then explicitly asked to use summary options to exercise the future defaults. Their writing instruction is to describe current behavior without assuming historical context. Historical comparisons belong only in explicit migration guidance.

Use published SDLC v4 with reviewPolicy auto. Pause for unresolved consequential human decisions. Fresh-context review is required. No unresolved intent questions remain.

## Workspace and provenance

Branch: codex/summary-mcp-defaults.

Base commit: b15ffa825a3fb23431ad2d591f19ba578e8d6a5c.

Repository: /Users/dan/.codex/worktrees/compact-mcp-continuation/interlock.

Artifacts: .tasks/summary-mcp-defaults.

SDLC run: a8e92cfc-cdb9-41f7-bb51-b7471c041dbb. The running development server predates summary support. An exact export of published SDLC v4 is imported into a temporary database served by the baseline checkout code. Coordination uses explicit summary calls; the user's development server and database are unchanged. Receipts and database are under /tmp/interlock-118.bZSufQ.
