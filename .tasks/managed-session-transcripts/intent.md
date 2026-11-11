# Managed session transcripts and operator messages

## Source and decisions

- Source issue: [#365](https://github.com/dgca/interlock/issues/365).
- User request: "Let's tackle 365. Make sure we've got safeguards in place to prevent taking up a ton of HDD".
- The user selected Interlock's published SDLC workflow on November 10, 2026.
- Execution uses SDLC workflow `cc973113-577c-4f6c-b5ea-a213605c92cb`, published version 4, run `c22c7c1f-f852-4068-bb01-11f65d727fde`.
- Review policy is the workflow default, `auto`. Human decision assignments remain unclaimed until the user answers. Initial delivery finished locally. On November 10, 2026, the user then requested a pull request. Merge and publication remain unrequested.

## Repository baseline

- Task branch: `codex/managed-session-transcripts`.
- Original base commit: `23af254fef0a91cba169c29dcf7bdbeee3265ef3`.
- Intent review proceeded under existing authorization on November 10, 2026. This is an agent assessment, not an additional human approval.

## Problem

Operators cannot inspect a managed Agent's conversation inside Interlock. Current inspection retains a small progress tail and links to native sessions. Understanding a stalled or misdirected Agent requires finding external logs. Sending corrective guidance also requires another interface, where one exists.

Capturing conversations introduces a second problem: verbose tool results and repeated executions can consume substantial disk space. Existing run-history retention is disabled by default and cannot be the only safeguard.

## Desired outcome

An operator can understand a managed execution and send guidance from its run inspector when the harness supports delivery. Supported messages, tool calls, and results remain inspectable after an Interlock restart, subject to explicit retention limits. Unsupported capture or messaging is visible.

Transcript storage has safe default limits and automatic cleanup, including when run-history retention is disabled. Inspection explains missing or truncated content. Reaching a capture limit must not stop useful Agent work or damage workflow results.

## Scope

- Durable managed-execution transcript capture and bounded inspection through the shared server interface, UI, CLI, and MCP.
- Operator messages to active managed sessions where their native or custom launcher interfaces support delivery, with delivery history.
- Protected-value redaction before transcript persistence and inspection.
- Default disk safeguards, transcript cleanup, and integration with existing run-history deletion.
- Documentation, compatibility guidance, a patch changeset, and relevant validation.

## Constraints

- Preserve existing run, claim, cancellation, retry, permissions, and session-continuity behavior.
- Keep contracts in `packages/core`, execution policy in `packages/runtime`, and persistence in `packages/storage`. Callers share server operations.
- Preserve user data and unrelated repository work. Use temporary databases for automated checks.
- Do not delete or manage native harness session files as part of transcript cleanup.
- Read current harness contracts before implementing adapters. Report capability gaps without inventing support or falling back to an unrequested new turn.
- Keep routine discovery and run summaries compact. Fetch transcript detail only on demand.
- Use the existing design system and run inspector patterns.

## Success

Operators can inspect supported managed conversations, identify capture gaps, and deliver supported guidance without leaving Interlock. Transcript storage remains bounded during noisy and repeated executions, survives restart within its retention policy, and is removed with the corresponding deleted history. Workflow execution continues when capture is unavailable or full.

## Questions

No unresolved intent questions. The specification owns the retention policy, capacity behavior, and per-harness delivery semantics. See its D1 decision for the user's approved disk policy.
