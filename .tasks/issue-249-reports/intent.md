# Complete tagged performance reports

## Outcome and source

Complete the report acceptance in [#249](https://github.com/dgca/interlock/issues/249) after [M10 reports #247](https://github.com/dgca/interlock/issues/247) merged. Operators must filter workflow or library reports by the same bounded, exact key-value tags as run lists, including measured cost attribution. The parent issue is [#223](https://github.com/dgca/interlock/issues/223).

## Scope and authorization

The explicit follow-up authorizes report filter integration across contracts, indexed storage, runtime, shared API, CLI, MCP and UI, the inherited Reports navigation hook fix, related tests, accurate documentation and a pending patch changeset. Existing unfiltered report behavior and defaults remain unchanged. Tag start, trigger, inheritance and summary behavior is already implemented and outside this correction.

The user explicitly authorized unattended SDLC execution with reviewPolicy auto, no human UI gate in this run, and combined human UI review later. Ordinary implementation choices are settled by the existing tag contract. Parent coordinates independent final review. Do not push, open a PR, or merge before parent continuation, despite createPr true authorizing later delivery. Original completed run 75cb244b is not resumed or mutated.

## Baseline

- Checkout: /Users/dan/dev/interlock-worktrees/issue-249
- Branch: feat/issue-249
- baseCommit: 4f7b6ea41d1047b352c3d5af3c1f16f379ef3b75
- Separate follow-up run: 2d779a3f-9937-4df2-be5d-df3931aa7922
- Artifacts: .tasks/issue-249-reports/

## Current evidence

At baseline, core reportFilterSchema accepts workflowId/since/until/limit only; storage runsForReport never queries run_tags. App.tsx short-circuits two useMatch hooks. Report docs claim date defaults and limits absent from code and nearest-rank percentiles despite interpolation. Use live implementation as the compatibility contract and correct those descriptions.

Preserve local .interlock data and use temporary test databases. No new database migration or unrelated report redesign is needed.

## Review correction authorization

The parent follow-up after fresh review of 890d23060d609d4292afcd62e02c3423c19660f9 explicitly requires fixing failed-filter result attribution and the accepted ISO date boundary semantics. Preserve the same run and baseline, stable finding IDs, report defaults and calculations. Normalize accepted timestamps rather than documenting a known semantic error. Independent final review and publication restrictions remain unchanged.

The subsequent parent correction request explicitly authorizes supported timestamp bounds with clear validation errors for malformed or out-of-range dates. It does not request broader date parsing. Preserve normal accepted date and tag semantics while preventing server errors and inverted selections.
