# Idempotent ordinary run starts

Issue #181, direct implementation. Initially based on main 5b67879, then rebased onto 1f16162 after #189 merged. Both feature sections are retained; improvement-start guidance now uses the ordinary start key.

Use optional requestId and externalTask on existing starts. requestId is an opaque, nonblank 1..120-character key, globally scoped to ordinary starts in one library and separate from comparison keys. Omission preserves fresh-run behavior. A deliberate new attempt uses a new key, even for the same external task.

Fingerprint normalized workflow ID, original JSON input, requested version intent, budget and external correlation. Object key order is immaterial; omitted version remains an explicit null intent, so later publications never change an identical retry. Omitted budget/correlation normalize to null. Explicit version versus omitted version remain different requests. Detail and summary limits are response choices, not request identity.

Resolve the receipt and create the original run, prompt capture, chain state, metadata and budget in one BEGIN IMMEDIATE storage transaction. Only new starts pump execution. Replays inspect the original run read-only, including archived workflows, changed prompts/newer publications, terminal runs and continued predecessors. Existing chain links point at successors; retries never allocate another successor.

Retain minimal hashed-key receipts indefinitely, excluding payload/prompt bodies. Supported workflow/history deletion marks a receipt deleted and never removes it. Missing original run or missing receipt with a surviving start-tagged run fails closed. Out-of-band database edits that remove both run and receipt, or replacing the entire library with older/new state, cannot preserve discarded idempotency knowledge. No forget/prune operation is introduced. Receipts are excluded from workflow bundles.

External task metadata is bounded, non-secret system/id and optional HTTP(S) link without embedded credentials. It never changes original input or grants authority/updates a board. Existing list_runs and CLI runs filter exact request key or system/id; full inspection and briefings carry references. Continue-as-new successors inherit the external task only, while the request key identifies the original run. Ordinary children remain discoverable through ancestry rather than acquiring task ownership.

Extend shared contracts, runtime, storage lookup, existing server/MCP operations and CLI flags. No scheduler, ownership lock, exactly-once external-effect guarantee or new tool family. Use temporary databases and fake executors, verify HTTP/stdio/CLI, then build/format/package checks and pending patch changeset.

## Validation

Validated after rebasing onto main 1f16162, including the merged improvement starter and per-sample budgets. `pnpm test` passes 1,068 tests in 92 files. The 32 new tests cover persistence, concurrency, conflicting arguments, version intent, prompt capture, terminal states, deletion and restoration, crash before pumping, rollback, continuation, metadata bounds, portable export and HTTP/stdio/shared-API/CLI parity. All automated checks use temporary databases and synthetic executors.

`pnpm build`, `pnpm format:check`, `pnpm test:package` and `git diff --check` pass. The existing UI chunk-size warning remains. Package checks exercise temporary installed global and npx copies, both MCP transports and persisted assignments across restart.

Reviewed the affected start, summary/submission, list, inspection/briefing, continuation, budget, archive/delete and portable-export flows against shared API behavior. Updated README, agent/harness guides, architecture, limits, improvement-start guidance and CLI help. This is an affected-flow review, not an audit of every MCP tool. No real provider account or external board integration was exercised.

Both transport discovery checks report 49 tools and 269,409 bytes of tool JSON. Main 1f16162 reports 266,684 bytes, so this change adds 2,725 bytes, about 1.02%, for bounded correlation schemas and key lifecycle guidance. No new tools or global server instructions are added.
