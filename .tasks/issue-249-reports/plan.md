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


### Revision after fresh review of 890d23060d609d4292afcd62e02c3423c19660f9

The same run continues with baseline 4f7b6ea41d1047b352c3d5af3c1f16f379ef3b75. Prior independent review verified AC1–AC3 and AC5, and found two P2 gaps. Its evidence remains tied to that commit and does not verify the corrected candidate.

- 890d2306-tag-error-scope, AC4: Clear obsolete results as each request begins, preserving latest-request guards. Add Apply failure/pending, same-tags Refresh retry, failed Clear, unfiltered retry, and stale success/error regressions. Verify old count/spend is absent under the new active scope, including after rejection. Original proof is /tmp/issue249-review-ui-boundary.log.
- 890d2306-date-guidance, AC2/AC3/AC6: Parent explicitly chose correcting accepted timestamp semantics rather than narrowing docs to raw text comparison. Normalize accepted bounds before comparing canonical stored creation times. Lower fractional bounds round up and upper bounds down to millisecond storage precision. Keep filter/window echo and unfiltered defaults unchanged. Test identical instants as canonical UTC, no milliseconds, positive/negative offsets, and finer fractions; pair them with one-millisecond before/after controls. Exercise Engine, both API aliases, CLI, both MCP transports and installed executable. Original proof is /tmp/issue249-review-attribution-boundary.log.

Rerun affected focused tests, full tests, build, package smoke, formatting and bounded transport discovery, fetch/rebase latest main, then freeze and submit build. Leave fresh review unclaimed again. Record corrected evidence below without overwriting original logs.

#### Corrected candidate evidence

- 890d2306-tag-error-scope resolved: Every new request clears its prior report before loading; existing request sequence checks ignore older success and error responses. New regressions failed on the prior candidate, `/tmp/issue249-tag-error-scope-red.log`, then 28 UI/routing/tag tests passed in `/tmp/issue249-tag-error-scope-green.log`. Actual browser forced HTTP 500 on Apply and Clear, verified visible error with no Total Runs or Attributed Spend, then Refresh recovered the correct tagged and unfiltered scopes. `/tmp/issue249-tag-error-browser.log` records assertions; failed-apply, retry, failed-clear and recovered snapshots plus apply/clear PNGs remain under `/tmp/issue249-tag-error-*`. Only the two injected HTTP failures reached the browser console. Own browser/server/Vite processes stopped; .interlock untouched.
- 890d2306-date-guidance resolved: Storage normalizes supplied date bounds before bound SQL comparison. Equivalent positive/negative offsets, omitted milliseconds and zero-extended fractions include the same boundary run; neighboring millisecond controls exclude correctly. Accepted finer fractions use ceil for since and floor for until, preserving inclusive meaning over millisecond storage. Original filter/window values, default500/max5000, no-date behavior and all aggregation calculations remain unchanged. Tests exercise Engine, both API aliases, CLI and both MCP transports. Installed CLI smoke also uses an offset lower bound and matching UTC upper bound. Documentation and workflow_report guidance now describe the implemented normalization rather than hiding the accepted-input bug.
- Focused final tests passed in `/tmp/issue249-r2-final-focused.log`, 16 tests across reportTags, reportUi and HTTP/stdio runTagsTransports; `/tmp/issue249-r2-focused.log` additionally includes the six original report tests. Transport discovery is 66 tools and 297223 bytes, within the existing 300000-byte budget. Full transport tests also retain the instructions budget. Current Zod4.6.7 docs and installed accepted-form probes confirmed offsets and arbitrary fractional precision; `/tmp/issue249-r2-zod-docs.txt` and `/tmp/issue249-r2-date-forms.mts` preserve the lookup/probe.
- Required checks passed: full `pnpm test`1859 tests/162 files, `/tmp/issue249-r2-full-test.log`; `pnpm build`, `/tmp/issue249-r2-build.log`; `pnpm test:package`, `/tmp/issue249-r2-package.log`; final `pnpm format:check`, `/tmp/issue249-r2-format-final.log`; `git diff --check`. Build caught and resolved a type-only tuple annotation in the new transport fixture after the full test run; focused tests were rerun afterward and passed. The build/package checks include that annotation. Existing chunk-size advisory only.
- Fetch before freezing still reports origin/main at the original baseline. No dependencies, migrations, metrics, defaults, inheritance or publication actions changed. Pending patch changeset includes both user-visible fixes. Independent review and combined later human UI review remain with parent coordination.
