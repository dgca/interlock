# Implement run tags

[Spec](spec.md) owns behavior and AC identifiers. [Intent](intent.md) records authorization and the original baseline.

## Build

1. AC1–AC4: add a shared core tag schema to run starts, queries, trigger configurations and compact response schemas. Include explicitly supplied tags in start fingerprints without changing old omitted-tag receipts. Capture copies in `newRun`; inherit through its existing parent and continuation paths. Add source tags to lifecycle payloads. Trace schedule, webhook and event start paths directly.
2. AC5–AC6: append a storage migration creating a normalized run-tag table with a key/value/run index. Backfill existing run documents, and use SQLite document triggers to maintain the index atomically for all write/delete paths, including history cleanup. Query exact pairs with bound parameters before pagination. Add tags to selected summaries, continuation snapshots and compact mutations.
3. AC2, AC3, AC5–AC7: forward tags through shared server starts, CLI repeatable `--tag key=value`, inherited MCP schemas, Run start and trigger editors. Add Runs filter controls and preserve filters through navigation. Keep changes in disjoint package files across delegated implementation work.
4. AC8: update architecture, limits and relevant run/trigger guidance, CLI help and MCP discovery. Add a patch changeset for the public package. Leave M10 reports documented as planned.

Build verifies contracts, index backfill/write/delete/rollback and exact all-pairs matching, idempotency including changed tags, filtered counts/pagination, child/chain propagation, all three live trigger paths and transfer preservation. High-risk cases pair valid tagged starts with rejected oversized inputs and conflicting replay keys, ensuring no extra run is created. Punctuation and empty values prove keys are bound data rather than JSON path syntax. Index tests inspect query plans for the tag index and verify deletion cleanup.

Use temporary or in-memory databases, preserving `.interlock`. Run relevant tests first, then `pnpm test`, `pnpm build`, `pnpm format:check`, and `pnpm test:package` after build because CLI and startup contracts change. MCP verification includes HTTP and stdio transport discovery and behavior. Save exact command outcomes for the frozen commit.

## Representative UI journey

AC2, AC5–AC7: enter a repository tag in Run start, start a run, open Runs, apply that exact tag filter, inspect the matching run and return with the filter retained. Change the value to an unmatched one and observe the existing empty state, then Clear restores results. Check duplicate/oversized keys prevent submission. Reuse UI interaction tests and inspect changed layouts; the requester deferred the combined human UI review.

## Independent review and delivery

Review independently checks the full baseline-to-frozen-commit diff, requirements evidence, index parameter binding, and a targeted trigger/filter negative boundary. The author stops before claiming the fresh review node and sends the coordinator the run/work IDs, baseline, exact HEAD and verification evidence. Coordinator owns fresh review and later PR delivery. Fetch and rebase current main before freezing; rerun affected checks when the candidate changes.

No unresolved plan decisions. SQLite triggers avoid stale indexes from less common deletion paths and keep document persistence the sole authority.
