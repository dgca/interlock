# Atomic workflow edits

## Source and authorization

Implement [issue 72](https://github.com/dgca/interlock/issues/72). The user requested the published SDLC workflow, autonomous progression without human approval, and an open PR for review. Planning proceeds through agent review under that authorization, without claiming human approval. Run ID: `8bbe1397-85de-4004-b143-97a2e4765b3e`.

## Problem and outcome

AI authors currently resend the whole draft to change a prompt or insert a step. Small edits should consume only the relevant graph data and reject stale drafts without risking unrelated changes. Authors also need actionable diagnostics before publication.

## Scope and constraints

Add ordered atomic graph edits and read-only preflight through the shared API and MCP. Preserve full-draft replacement, saveable incomplete drafts, immutable published definitions, run history, ownership, layout, pins, and JavaScript versus legacy Bash behavior. Keep contracts and graph validation in core and orchestration in runtime. No UI redesign, database migration, publication side effects, or execution changes.

## Success

An author can make a small graph change with revision protection and inspect diagnostics without rebuilding the graph or publishing it. Tests and documentation make the supported checks and their uncertainty explicit. The change ends in a reviewable PR.

## Open questions

No unresolved intent questions. The edit vocabulary, deletion policy, and bounded preflight subset belong to spec.md and will be chosen within the user's authorization.
