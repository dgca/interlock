# Implementation and verification

See [intent](intent.md) and [spec](spec.md). Existing facts: workflowTriggers owns trigger CRUD and schedule dispatch; Webhooks shares the trigger union; Engine persists lifecycle events; attention projection and Stalls supply observational state; RunStarts owns ordinary start receipts.

## Build sequence

1. Extend core event contracts and storage queries, portable transfer and regression tests. AC1, AC3, AC6, AC7.
2. Add lifecycle capture and pending delivery processing to the runtime. Snapshot compact event context at emission. Use the existing RunStarts transaction for handler dispatch, and inherit triggerChain in child and continuation startup. Track uncertain connected claims independently of resource names and reconcile them through the existing confirm-stopped operation. AC2 through AC5.
3. Extend the existing trigger UI, shared API filters, CLI help, MCP discovery and both transport tests. Add docs and a patch changeset. AC1, AC7.
4. Run focused tests, then the full suite, pnpm build, pnpm test:package when CLI/package code changes, and pnpm format:check. Fetch and rebase latest main before the verified candidate is committed and submitted to review.

## High-risk cases and direct checks

Build owns these implementation checks with temporary databases:

- Positive controls for every event kind and scope, plus mismatching workflow and Exit filters. Expected exactly one matching handler with bounded source context. AC1, AC2.
- Duplicate capture, restart and visible-history pruning. Expected one durable pair receipt and one handler. Inject a start/write failure and compare persisted protected state to establish transactional rollback. AC3.
- Mutual triggers, self-trigger and depth limits, including child and continued runs. Expected logged suppression and no repeated chain member. AC3.
- Terminal parent with a live detached child, background Script, managed interruption and expired unresourced claim. Expected pending quiescence until every corresponding stop is confirmed, with a valid stopped control. AC4.
- Target pause, handler admission queue, failed handler threshold and reenable. Expected defer, ordinary admission, failure auto-pause and no disabled-time replay. AC5.
- Export/import using new and older formats. Expected disabled event config, preserved source dependencies and unchanged schedule/webhook behavior. AC6.
- HTTP and stdio discovery plus operations. Expected one shared schema with bounded responses and no redundant tools. AC7.

Build UI journey: open Triggers, choose Event, select source and completed, enable quiescence, save, reopen, inspect a matching delivery. Expected controls and saved values match the shared schema, keyboard focus remains usable, and delivery shows the source and outcome. AC1, AC7. Reuse available tests and local tooling. Human review is deferred by queue authorization. If actual controls cannot be exercised, record the precise gap instead of claiming success.

Independent review owns full diff review at exact HEAD, criteria evidence verification and targeted negative-boundary checks. Parent dispatches the fresh reviewer. Stop before claiming that assignment. Final PR preparation and merge stay parent-controlled.

## Risks

Lifecycle capture must share its source transaction and avoid backfilling historical events. Pending deliveries retain causal snapshots. Quiescence must inspect the entire source tree, including detached and continued runs, without treating a lost lease as proof of stop. Visible log trimming must never remove dedupe receipts or pending entries. Shared trigger changes can widen portable import and MCP contracts, so older schedule/webhook regression tests remain required.

## Implementation and build evidence

The runtime captures recipients and causal context with the source event, then starts handlers through RunStarts. Quiescence includes durable revoked-claim records without resource names and interrupted deterministic operations, including unresourced Fetch requests and foreground Scripts interrupted by restart. Existing exact-attempt resource reconciliation confirms stop. Cancellation retains its existing detached boundary. An indexed terminal-background projection avoids reading unrelated history on idle ticks. Schema 13 migration tests cover upgrade population and repeated upserts.

The implementation candidate is `57e0d4e10d91a2fc0cbd8f50078be3f41f8afa21`, rebased onto `8c720e70838847999fa3036a27b0a1c4c2c7d975`. The following evidence was checked against that code. A later documentation-only checkpoint records these results without changing tested behavior.

- AC1 through AC7: `pnpm test` passed all 1,688 tests in 142 files. Proof: `/tmp/interlock-241-test-verified.log`, exit 0. The event suites include all transition kinds, source and Exit mismatches, paused and failed starts, handler failure pause, rollback after injected delivery persistence failure, disabled-time behavior, durable receipt pruning and separate SQLite reopen, safe portable imports, and child/Batch/continuation inheritance.
- AC3 and AC4: `tests/eventQuiescence.test.ts` passed 12 checks with real supervised Scripts, authenticated and tampered receipts, actual managed adapter stop, live unresourced Fetch cancellation with remote work still running, separate SQLite reconnection, and foreground Script restart requiring explicit stop confirmation. Proof: `/tmp/interlock-241-script-restart.log` and the full-suite log. Named resource, pause, lease, restart and idle-scheduling regressions also passed.
- AC1 and AC7: HTTP and stdio exercised discovery and trigger create, update, invalid-config rejection, enable, dispatch, compact payload delivery, list, export, disable and delete. Both transports expose 61 tools and 299,429 bytes of definitions under the unchanged 300,000-byte bound. Proof: `/tmp/interlock241-discovery-rebased.log` and the full-suite log.
- AC1 and AC7 UI journey: actual controls created a completed-only workflow trigger, accepted source and Exit IDs, enabled quiescence, moved focus by Tab to depth, saved disabled, reopened retained values, enabled through its confirmation dialog, started the source and inspected delivery/source/handler links. Desktop and 390px rendering showed no page overflow. Proof: `/tmp/interlock241-form.png`, `/tmp/interlock241-delivery.png`, `/tmp/interlock241-mobile.png` and corresponding YAML snapshots. This journey occurred before the implementation commit. The UI code is unchanged in the verified rebased candidate. Human UI review remains deferred by the queue authorization.
- `pnpm build` passed TypeScript, UI and bundled-package generation. Proof: `/tmp/interlock-241-build-verified.log`, exit 0. The existing Vite large-chunk warning remains.
- `pnpm format:check` passed. Proof: `/tmp/interlock-241-format-verified.log`, exit 0. The final artifact checkpoint also receives a formatting check.

Docs checked against the final behavior: README, CONTEXT, architecture, v1 limits, event reference, work resources and CLI trigger/help paths. The affected MCP review covered trigger reads/mutations, full and compact start/submission outputs, get_run and briefing, cancellation/stop reconciliation, and export/import, over both transports. No new tool was added. Shared event contracts and bounded stop metadata add useful discovery information; shorter existing import/export and lifecycle descriptions offset that cost. This is an affected-flow audit, not a claim that every MCP tool was reviewed.

Independent fresh final review and PR delivery remain outstanding. No PR, push or merge was performed.

`pnpm test:package` passed after the completed build, exercising packed global and npx installs, CLI and UI assets, HTTP and stdio MCP, restart assignments, JavaScript and supervised background recovery, persistence and reviewed history cleanup. Proof: `/tmp/interlock-241-package-verified.log`, exit 0.
