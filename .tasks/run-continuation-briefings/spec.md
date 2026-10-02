# Run continuation behavior

Scope and authorization are defined in [intent.md](intent.md).

## Decisions

D1. `get_run_briefing` returns a compact snapshot. `wait_for_run_change` accepts its cursor and waits at most 60 seconds, default 30 seconds. `get_run_result` selects one run or execution input/output and a dot path. These operations also use the shared server API.

D2. Briefings include the requested run and all descendants. Each summary identifies its independent lifecycle boundary, which changes at detached relationships. Requested-scope counts exclude detached trees; separate independent counts and references expose those trees even after requested completion. This preserves existing discovery scope without confusing completion boundaries.

D3. SQLite maintains a monotonically increasing change sequence and latest revision per run. Run and assignment writes advance revisions transactionally, including lease renewals. Timestamp-only run updates do not advance the sequence. Cursor includes server incarnation, requested run, and scoped revision. No event replay or retention dependency. Restart, malformed, foreign, or future cursor returns a fresh snapshot with reset information. Equal timestamps cannot lose ordering.

D4. Every persisted run/assignment change within the requested tree wakes its wait. Unrelated runs and workflow edits do not. No claims or engine pumping occur in these reads. Timers retain their existing independent advancement. Subscribe before checking the snapshot to close the notification race.

D5. Arrays are capped independently at a caller-selected limit, default 20, maximum 100, with exact totals and truncation indicators. Counts remain complete. Summaries exclude prompts, instructions, schemas, input/output values, tokens, and event history. Result reads default to 64 KiB with a 256 KiB maximum and reject oversized selected values; narrower paths can recover. List bounds constrain record counts, not arbitrary stored labels or capability names.

D6. Cursors are continuation tokens, not authorization credentials. Finite waits return a fresh snapshot on change or timeout with explicit changed, timedOut, and reset flags. Actual HTTP request abort/disconnect, stdio cancellation, and shutdown release listeners/timers. Some HTTP MCP clients cancel their local promise while keeping the POST active; the stateless endpoint cannot correlate a separate cancellation notification safely, so that wait ends at its finite deadline. Missing/deleted runs return errors rather than completion. Waits hold no database transaction.

## Acceptance criteria

- AC1: Available/claimed work, Wait, local execution, failure, cancellation, and completion are distinguishable with actionable references and context/capability requirements, without private tokens or payload history.
- AC2: Batch counts include queued items; ordinary descendants belong to the requested lifecycle; detached boundaries and active independent trees remain explicit after requested completion.
- AC3: Cursors advance for scoped persisted changes with stable sequence ordering. Current cursors do not resend historical payloads, and stale/restart cursors recover explicitly.
- AC4: Bounded waits return on relevant changes and timeout, isolate unrelated changes, support concurrent waiters, avoid subscribe races, and clean up on abort/shutdown without holding transactions.
- AC5: Targeted input/output path reads preserve JSON null and reject missing data, invalid paths, foreign execution IDs, and oversized results. Snapshot lists expose bounds and exact totals.
- AC6: Shared API and HTTP/stdio MCP discover and call these operations with consistent bounds and cancellation. Existing inspection, discovery, timers, and runtime behavior remain available. Documentation and patch changeset explain the final protocol and migration.

## Risks

Full scoped aggregation can cost time on very large histories despite compact responses. SQLite projection avoids transferring payloads into the runtime. A noisy scoped run can wake all its waiters; per-run revisions filter unrelated work. No delta history is returned, so each wake returns the current bounded snapshot.

No unresolved product decisions. These choices implement issue #73 under the user's autonomous authorization.
