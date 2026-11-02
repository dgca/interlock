# Idempotent ordinary run starts

Issue #181, direct implementation. Initially based on main 5b67879, then rebased onto 1f16162 after #189 merged. Both feature sections are retained; improvement-start guidance now uses the ordinary start key.

Use optional requestId and externalTask on existing starts. requestId is an opaque, nonblank 1..120-character key, globally scoped to ordinary starts in one library and separate from comparison keys. Omission preserves fresh-run behavior. A deliberate new attempt uses a new key, even for the same external task.

Fingerprint normalized workflow ID, original JSON input, requested version intent, budget and external correlation. Object key order is immaterial; omitted version remains an explicit null intent, so later publications never change an identical retry. Omitted budget/correlation normalize to null. Explicit version versus omitted version remain different requests. Detail and summary limits are response choices, not request identity.

Resolve the receipt and create the original run, prompt capture, chain state, metadata and budget in one BEGIN IMMEDIATE storage transaction. Only new starts pump execution. Replays inspect the original run read-only, including archived workflows, changed prompts/newer publications, terminal runs and continued predecessors. Existing chain links point at successors; retries never allocate another successor.

Retain minimal hashed-key receipts indefinitely, excluding payload/prompt bodies. Supported workflow/history deletion marks a receipt deleted and never removes it. Missing original run or missing receipt with a surviving start-tagged run fails closed. Out-of-band database edits that remove both run and receipt, or replacing the entire library with older/new state, cannot preserve discarded idempotency knowledge. No forget/prune operation is introduced. Receipts are excluded from workflow bundles.

External task metadata is bounded, non-secret system/id and optional HTTP(S) link without embedded credentials. It never changes original input or grants authority/updates a board. Existing list_runs and CLI runs filter exact request key or system/id; full inspection and briefings carry references. Continue-as-new successors inherit the external task only, while the request key identifies the original run. Ordinary children remain discoverable through ancestry rather than acquiring task ownership.

Extend shared contracts, runtime, storage lookup, existing server/MCP operations and CLI flags. No scheduler, ownership lock, exactly-once external-effect guarantee or new tool family. Use temporary databases and fake executors, verify HTTP/stdio/CLI, then build/format/package checks and pending patch changeset.
