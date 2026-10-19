# Compact MCP continuation responses

## Problem and outcome

Interlock repeats complete workflow definitions, assignment bodies, and growing run histories in the result of every MCP start and submission. Agents spend context on already known data and can require compaction after only a few stages. Issue [115](https://github.com/dgca/interlock/issues/115) reports this during a 30-node workflow.

Executors need a small response that identifies the continuation run, its state, and available work. Full inspection remains available when requested. Existing callers must keep working without changes.

## Source and settled decisions

On 2026-10-18 the user accepted the assessment's staged recommendation: add explicit compact responses first and defer a breaking default change. They instructed: "Work autonomously until the issue is addressed. Follow the SDLC workflow."

Preserve full defaults for start_run, submit_result, list_work, the shared API, UI, and CLI. Teach agents to request detail: summary and fields: summary. Keep claim_work complete. Use a patch changeset. Changing defaults requires a separate, explicit breaking-release decision.

This run uses the published SDLC workflow v4 with reviewPolicy auto and createPr false. Work is isolated from the original checkout. Artifacts live in .tasks/compact-mcp-continuation. Final review requires fresh context. No merge, publication, or production database migration is part of this task.

## Scope and constraints

Add a compact continuation mode to start_run and submit_result, with bounded work discovery and a cursor that works with the existing wait operation. Preserve child and detached lifecycle semantics and submission idempotency. Describe and validate the response contracts over both MCP transports. Update affected agent guidance and documentation.

Keep execution behavior in runtime, contracts in core, and shared API access for both MCP transports. Use temporary test databases and preserve the user's .interlock data. Full responses for fail_work, retry_run, and cancel_run remain follow-up work.

## Success and open questions

An agent using compact mode can continue a long workflow without receiving its complete definition or prior execution payloads after each stage. Older callers receive the same full data as before. Child completion cannot hide work unlocked in its owning lifecycle.

No unresolved human intent decisions remain. The specification will settle response fields, continuation scope, and bounds.

## Task baseline

Branch: `codex/compact-mcp-continuation`.

Base commit: `5c17d6a909a58ae05eb8a9773afa2b23a3c8e0bd`.

SDLC run: `ddf5c5c5-e9eb-468d-8df9-076ea6e4e0f2`.
