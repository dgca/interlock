# Report integration plan

Follow [intent](intent.md) for scope and [spec](spec.md) for the criteria. Baseline stays 4f7b6ea41d1047b352c3d5af3c1f16f379ef3b75.

## Implementation

1. AC1–AC2: Reuse runTagsSchema in reportFilterSchema. Add bound all-pairs run_tags subqueries to storage before ordering/limit. Leave runtime aggregation over the selected sample unchanged.
2. AC3: Extend both CLI report entry points using the existing tag parser and shared request schema. Update workflow_report discovery without adding tools.
3. AC4–AC5: Reuse Runs tag inputs and applied-filter behavior in Reports. Make both useMatch calls unconditional. Add actual Router navigation regression from Runs to global and workflow Reports.
4. AC6: Correct affected README and guides to match actual defaults, interpolation and sampling. Add a patch changeset. Check related run-tag, usage and MCP workflows for consistency.

## Build-owned verification

- AC1: Parse valid control, 17 tags, oversized/empty keys and invalid values through core/API/MCP boundaries. Literal __proto__, constructor, dotted keys and equals signs retain exact matching.
- AC2: Seed mixed tagged/untagged/partial-match runs, newer excluded runs, workflow/date controls and limit 1. Assert filtering before limit and matching metrics/outcomes/usage attribution only. Inspect SQLite EXPLAIN QUERY PLAN to establish run_tags index use. Empty filters equal omission after normalizing generatedAt.
- AC3: Exercise repeatable CLI tags through both shared command tests and packaged executable. Test duplicate/invalid syntax rejection and values containing equals. Test MCP calls and bounded discovery on HTTP and stdio within existing resource budgets.
- AC4–AC5 representative journey: Open Runs, navigate to Reports using actual route controls, add repo and batch filters, apply, observe matching count, clear, observe original count, then navigate to a workflow report. Confirm no hook-order error and existing empty/error feedback. Reuse existing UI test setup and automation; record explicit limitations if rendering controls is unavailable.
- AC6: Review README, docs/usage-reporting.md, docs/architecture.md, docs/v1.md, docs/idempotent-run-starts.md, CLI help and workflow_report/list_runs/report_usage/get_run_usage guidance against the implementation. Full tool-set audit is out of scope.
- Run focused tests, repository test suite, pnpm build, pnpm format:check and pnpm test:package. Temporary stores only. Inspect logs for asserted outcomes and exit status. Rebase latest main before freezing; repeat affected checks if candidate changes.

## Independent review and delivery

Parent supplies a fresh final reviewer to inspect the full baseline-to-candidate diff, AC1–AC6 evidence and targeted boundaries. Build stops before claiming review. PR and merge remain later coordination actions.

## Risks

Filtering after limit could hide matches and misattribute cost, so direct limit/attribution assertions are required. Object-key edge cases could alter literal tags, so use parsed JSON controls. Duplicated CLI parsing could leave the installed binary inconsistent, so package smoke exercises it. The inherited conditional hook requires actual navigation, not static source assertions.

## Evidence

Build results will be recorded here after verification. Proof logs stay outside the checkout to preserve the reviewed candidate.
