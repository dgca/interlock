# Run continuation implementation

Follow [intent.md](intent.md) and [spec.md](spec.md). Baseline is current origin/main at task branch creation, `2abebb6`. Resolve the full object ID before build submission.

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

Pending implementation. Tests map directly to AC1 through AC6. Review the complete affected execution flow: server instructions, get_run, list_runs, list_work, start_run, claim_work, renew_claim, submit_result, fail_work, retry_run, cancel_run, and the new operations. This is an execution-flow audit, not an audit of every authoring tool.
