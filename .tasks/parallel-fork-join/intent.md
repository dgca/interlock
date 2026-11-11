# Parallel fork and join

## Source and authorization

- Source issue: [#362](https://github.com/dgca/interlock/issues/362).
- The user asked whether the feature was worth building, then accepted the scoped recommendation with "Great, let's do it. Use the SDLC workflow" on November 10, 2026.
- The accepted recommendation is a structured parallel section with fixed named branches, one matching all-results join, fail-fast cancellation, and retries that retain successful branches. Outer workflow loops can revisit a settled section. Internal branch paths remain acyclic initially.
- Defer quorum joins, successful-only collection, overlapping joins, and multiple outcomes from one Agent result.
- SDLC workflow `cc973113-577c-4f6c-b5ea-a213605c92cb`, published version 4, run `382951dd-a69a-4dd6-832f-98db49f9d755`.
- Use the default `auto` review policy. Pause at human decision assignments for unresolved consequential decisions. Finish locally, with fresh-context implementation review. PR creation, merge, and publication are not requested.

## Repository baseline

- Checkout: `/Users/dan/dev/interlock-worktrees/parallel-fork-join`.
- Task branch: `codex/parallel-fork-join`.
- Base commit: `92c789d1376e93e11c5d4e6998accd4085718dc5`, current `origin/main` when setup ran.
- Artifacts: `.tasks/parallel-fork-join/`.
- The original checkout remains on its unrelated transcript feature branch. Its research assessment is `/Users/dan/dev/interlock/docs/research/fork-join-assessment-2026-11-10.md`.

## Problem

Workflow authors cannot directly express several different paths that run independently and then return their results together. Independent reviews and checks therefore run sequentially or require Batch items, dispatch routing, and result mapping to approximate a fixed parallel section.

For two equally long independent reviews, sequential execution spends twice the review time when both executors could run together. The workaround also obscures which branches the author intends and which results the continuation requires.

## Desired outcome

Authors can define and inspect a parallel section containing distinct steps and Agent model choices. Each branch receives the section's captured input. The continuation receives named, validated results after all branches succeed. Execution remains durable across waits, restart, cancellation, and retry.

Operators can see which branches are queued, active, completed, or failed and identify the work preventing progress. Repeating a review round cannot use results from an earlier round. A failed branch can be retried without repeating successful sibling work.

## Scope

- Structured fixed parallel branches and a matching join in workflow definitions, publication checks, and the visual editor.
- Durable branch scheduling and collection through the shared runtime, including existing execution capacity, ownership, pause, budget, and cancellation rules.
- Deterministic input bindings, result contracts, and explicit step-budget ownership. The issue requests branch steps to count toward `maxSteps`.
- Run inspection, authoring and execution through the shared server API, CLI, and MCP.
- An explicit simulation contract: support the new behavior or reject unsupported definitions before simulation starts.
- Documentation, a pending patch changeset, and relevant verification evidence.

## Constraints

- Preserve existing workflows, published definitions, Batch behavior, original-input bindings, claims, and session continuity.
- Keep contracts and graph validation in core, execution policy in runtime, and persistence in storage. UI, CLI, and MCP share server operations.
- Reuse existing durable child-run behavior where it fits. Avoid a second competing scheduler.
- Cancellation does not prove that external work stopped. Preserve uncertain ownership and reconciliation requirements.
- Keep incomplete drafts saveable and publication validation separate.
- Reuse the Mantine theme, contract editors, graph controls, and run inspection patterns. Add information and actions that help the user operate the workflow.
- Preserve user `.interlock` data and unrelated files. Use temporary databases for checks.
- Keep MCP discovery and routine responses bounded. Explain any added tools or response volume.

## Success

A workflow author can express two independent model-specific reviewers, collect both named results, and return to the author for another review round. Both reviews can progress when executor capacity permits. The operator can inspect and recover the section without losing branch identity or repeating successful work.

## Open questions

No unresolved intent questions. The specification owns exact graph boundaries, input scopes, limits, supported nesting, recovery behavior, and the UI proposal. Material changes to the accepted scope require a human decision.
