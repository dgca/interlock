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
