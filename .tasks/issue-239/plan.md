# Implement and verify

[Spec](spec.md) owns behavior and AC identifiers. [Intent](intent.md) records scope and the original baseline.

## Build sequence

1. AC1: Add core stall contracts, optional portable fields and per-attempt metadata. Persist local revision-checked settings separately from executor caps; use existing document storage.
2. AC2–AC4: Add runtime stall monitor under the engine pump. Capture durable active-clock intervals for needs_human, read pause/work/input holds, union exclusions. Keep observational stalled records separate from assignments. Enforce deadlines through ordinary attempt failure before claim renewal/result admission.
3. AC5: Integrate idle recovery in ExecutorManager using captured policy and attempt/last-progress guards, supported launcher messaging, confirmed stop and existing recovery paths. Preserve resources, tickets and budgets.
4. AC6: Reuse existing Mantine settings/node/workflow/run controls. Add inherited threshold fields and deadline/attention display without extra filler.
5. AC7: Update affected docs and MCP shared authoring/discovery/inspection paths, CLI help and patch changeset.

## Verification and ownership

Build owns deterministic runtime tests with fake clocks and temporary Stores, fake managed adapters and launcher endpoints. Cover thresholds just before/at crossing, no duplicate events, later progress and repeat stalls, persisted restart, inherited/null policies, pause/hold interval unions, needs_human freeze and input waits. Verify renewable lease cannot extend maxExecutionMs, fresh attempts reset it, and late result/renew cannot bypass expiry. Valid control reaches each boundary before negative case.

For recovery, exercise actual message endpoint and stop/relaunch; inject progress, renewal, completion, pause and uncertain cleanup between asynchronous responses. Expect no stale restart, no release of uncertain resources, and bounded persisted recovery count.

Use existing HTTP and stdio MCP transport tests for schemas and bounded responses. Run relevant suites, pnpm test, pnpm build and pnpm format:check; run pnpm test:package after build for CLI/packaging changes. All checks use isolated temporary data, no real account/model.

Representative UI journey for AC6: in a temporary server, set library stall threshold through settings, save/reopen; create workflow override and Agent maxExecutionMs through actual dialogs; save/reopen and inspect persistence. Start fake/unmanaged work, cross a short controlled threshold, open Needs attention and navigate to execution details. Verify threshold text and focused controls at desktop and narrow sizes. Reuse existing browser tools; no new UI automation framework.

Independent final review owns exact-commit diff review, AC evidence validation and targeted public-boundary checks. Before offering Review change, fetch/rebase latest main, resolve any overlap, rerun checks, commit intended artifacts/code and report exact base/head. Stop before claiming fresh review, pushing or PR. Parent creates an isolated reviewer and owns delivery/CI/merge. Any changed candidate requires a new exact-head review.
