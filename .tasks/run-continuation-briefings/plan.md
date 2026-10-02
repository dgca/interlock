# Run continuation implementation

Follow [intent.md](intent.md) and [spec.md](spec.md). Baseline is current origin/main at task branch creation, `2abebb665a0d2a9fa6ac7c161a5b29bd49606546`. This baseline remains fixed for all review iterations.

## Approach

1. Add shared query schemas in core. Add schema-3 transactional revision tracking and scoped metadata projections in storage, preserving document records and published versions. Covers AC1, AC2, AC3, AC5.
2. Implement runtime briefing aggregation and lifecycle boundaries, targeted reads, and finite waits. Storage write notifications arrive after synchronous operations; subscribe before snapshot and compare persisted revisions. Abort and shutdown always clean up. Covers AC1 through AC5.
3. Expose queries through shared API, MCP bridge, and both transports. Propagate request and MCP cancellation signals to waits. Review affected run/work execution descriptions and defaults. Covers AC6.
4. Add deterministic temporary-database tests for waits, scopes, cursor recovery, bounds, results, and migration. Extend existing transport tests to discover and exercise the same MCP definitions in HTTP and stdio. Covers all criteria.
5. Update agent operations, architecture, current limits, README, and upgrades. CLI help has no changed command semantics; check it against final behavior. Add a pending patch changeset. Covers AC6.
6. Run relevant tests, complete suite, pnpm build, pnpm test:package after build, and pnpm format:check. Record outcomes here. Commit intended files, then run fresh independent workflow review before preparing a PR.

## Repository facts and risks

The shared router uses tRPC, HTTP MCP uses one JSON response per POST, and stdio proxies to the same router. Engine event listeners currently exclude renewals, so revision notifications must cover all persisted run/work writes. Store owns SQLite migration backups. No UI journey applies.

Projected summaries avoid fetching stored inputs, outputs, and prompts. Aggregation still scans metadata proportional to scoped history. Tests must demonstrate exact totals when response lists truncate. No user database is used for checks.

## Verification evidence

Implemented the planned protocol. SQLite projections avoid briefing payload loads; targeted reads select the caller's field/path and enforce the selected-value bound. Separate HTTP requests preserve wait cancellation and response independence.

Verification at implementation submission:

- AC1: `tests/continuation.test.ts` verifies available/claimed work, renewals at equal timestamps, completion with null, failures, cancellation, Wait, and running local execution. Payload markers, context instructions, and claim tokens are absent.
- AC2: The same tests verify nested Batches, queued/dispatched totals, collect-policy failure, ordinary descendants, and nested detached boundaries after parent completion. A 150-item Batch verifies truncation with exact counts.
- AC3: Tests verify transactional rollback, timestamp-only writes, equal-timestamp revisions, invalid/foreign/future cursors, and a new Engine incarnation. Migration tests verify persisted revision on reopen.
- AC4: Runtime tests cover multiple waiters, unrelated changes, subscription-race injection, timeout/zero timeout, abort/already-aborted signals, shutdown, deletion, and concurrent shared API writes. Transport tests verify actual HTTP disconnect cleanup and stdio protocol cancellation cleanup.
- AC5: Tests cover null, nested arrays, UTF-8 byte counts, missing paths/outputs, unsafe property paths, foreign execution IDs, and list/value limits.
- AC6: HTTP and stdio tests discover and call all three tools, assert defaults/bounds, claim/submit through existing operations, and verify guidance. Migration fixtures include the prior 0.1.3 data and freshly generated published 0.1.13 schema-2 data. Script pins execute after migration and the previous Agent claim completes.

`pnpm test` passed all 41 files and 465 tests before adding two boundary/previous-release tests; relevant continuation and migration tests then passed all 27 tests. Transport checks passed in both modes. `pnpm build`, `pnpm test:package`, `pnpm format:check`, and `git diff --check` passed. After adding root ancestry to run summaries, continuation/transport tests and build passed again.

The packed-install check exercised temporary global/npx installs, CLI startup, UI assets, both MCP transports, JavaScript, persistence, and claims across restart. No user database or real model/account was used.

Documented limitation: older HTTP MCP SDKs can cancel only their local promise and leave the POST active. Actual HTTP abort/disconnect cleans up; an uncorrelated cancellation notification cannot safely identify an original stateless request. Such waits end at the finite deadline. Stdio cancellation propagates through its dedicated shared-API request. This preserves the authorized stateless transport and is documented in spec D6, MCP descriptions, and agent operations.

Reviewed README, agent operations, architecture, current limits, upgrade guidance, and CLI command help against the final implementation. CLI commands retain their existing behavior. No UI journey applies. Review the complete affected execution flow: server instructions, get_run, list_runs, list_work, start_run, claim_work, renew_claim, submit_result, fail_work, retry_run, cancel_run, and the new operations. This is an execution-flow audit, not an audit of every authoring tool.

## Guidance follow-up

The SDLC run completed and PR #79 opened at independently reviewed commit `63fcf08d6e695c29b264973918606d0437373288`. Reviewer follow-up `63fcf08-guidance` identified copied handoff text and connect-harness examples that still direct resumption through full inspection.

Update that existing instruction text and related timer/detached guidance. Intent clarifies that copy-only handoff updates are within scope, with no new controls/layouts. AC6 applies. Render the existing handoff component using its established jsdom test, invoke its Copy instructions button, and inspect the text sent to the clipboard adapter. This verifies generated wording and unchanged visible confirmation/error behavior; it does not claim real OS clipboard integration. No clipboard mechanism changed. Run affected handoff/runtime/transport tests, build, format, and an independent review of the complete follow-up diff. Preserve the original review baseline and attribute earlier evidence accurately.

Follow-up verification passed: 53 tests across existing agent handoff, runtime, detached workflow, and both MCP transport tests. The rendered handoff test invokes Copy instructions for agent, checks all three continuation tool names and the full-inspection fallback in the clipboard adapter text, and retains copied/error/retry checks. pnpm build, pnpm format:check, and git diff --check passed. A separate focused review follows this commit; the completed SDLC review remains attributed to its original commit.
