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

### Verified build results

- AC1–AC3: 16 focused tests passed in reportTags.test.ts, report.test.ts, runTagsTransports.test.ts and reportUi.test.ts. `/tmp/issue249-report-all-focused.log` records the run. The actual report selection SQL uses covering index run_tags_match. Mixed literal tags, __proto__, constructor, dotted keys, empty values, wrong case, missing pairs, dates/workflows and sample limit have valid controls. Adding excluded runs leaves the entire selected report unchanged, including attempt and run-level spend, node/model/provider attribution, event/hold reliability and outcomes. Empty tags and omission produce the same report content.
- AC1–AC3: HTTP and stdio discover identical workflow_report contracts and execute filtered reports. Shared report.summary, system.report and CLI use the same schema. Invalid filters reject through both API aliases and both transports. Full discovery remains 66 tools and 297188 bytes, under the existing 300000-byte budget; server instructions also pass the existing 10000-byte budget. No tools or response fields were added. MCP impact is one optional filter field plus focused guidance, without broader report responses.
- AC4–AC5: The actual App and React Router navigation regression passes from Runs to global Reports to workflow Reports, then back. Tests also cover Apply/Clear, literal tag requests, duplicate-key focus, server error recovery and out-of-order response handling. The additional workflow route key fixes an observed view-state reuse bug exposed by that journey; the sequence guard prevents a newly possible filter race.
- AC4–AC5: Real browser controls with isolated `/tmp/issue249-report-browser.db` passed sidebar Runs → Reports, keyboard entry of repo=org/repo and batch=1, Apply 4 → 1 runs, Clear 1 → 4, and direct workflow-scoped report. Desktop and 640px render inspection passed. Evidence: `/tmp/issue249-report-tags-desktop.png`, `/tmp/issue249-report-tags-narrow.png`, filtered/cleared `.txt` snapshots and `/tmp/issue249-report-workflow.txt`. Browser console had no errors in `/tmp/issue249-report-browser-console.log`; detector output is `[]` in `/tmp/issue249-report-ui-detect.json`. Test helper input injection was supplemented by real keyboard browser interaction. Browser/server/Vite processes were stopped. This is build verification, not human UI approval.
- AC6: Checked README, usage-reporting, architecture, v1 and idempotent-run-starts guides; CLI help and examples; workflow_report, list_runs, report_usage and get_run_usage definitions and related shared APIs. Corrected settled limits and documented inherited report constraints instead of changing metrics. This was the affected MCP flow audit, not a comprehensive tool-set audit. Pending patch changeset remains unversioned.
- Repository checks passed: `pnpm test` 162 files/1853 tests, `/tmp/issue249-full-test.log`; `pnpm build`, `/tmp/issue249-build.log`; `pnpm test:package`, `/tmp/issue249-package.log`, including installed repeatable report tags and global/npx installs; final `pnpm format:check`, `/tmp/issue249-format-final.log`; `git diff --check`. Typecheck also passed separately in `/tmp/issue249-typecheck.log`. The build emits the existing large-chunk advisory only.
- Latest origin/main fetched before freezing remains the recorded baseline. No dependencies, tag inheritance, existing report metrics or no-filter defaults changed. Temporary stores preserve the user's .interlock data. No unresolved build-owned verification gaps remain. Final independent review and later combined human UI review remain with parent coordination.
