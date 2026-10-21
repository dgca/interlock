# Agent result preflight

Issue #137. Add a read-only check against the captured work output contract and live claim. It never pumps the engine or writes state, including when a lease is overdue. Submission performs normal timer recovery, then repeats the same check inside its transaction. Identical accepted results remain idempotent.

Core returns at most ten diagnostics, with bounded JSON Pointer paths, schema paths, rule IDs, and corrective messages. Candidate values and schema enum values are excluded. Runtime adds explicit claim state and next-action guidance. Submission keeps its existing throwing contract, with a typed rejection carrying the report through tRPC error data and MCP structured error content. Existing expiry recovery messages remain available. CLI preflight returns JSON; rejected submissions retain nonzero exit status.

The new query uses POST transport to avoid request-line limits for large candidates. There are no stored fields or migrations. Tests cover non-mutation, rejected then corrected results, expired/replaced/cancelled claims, completed replay/conflict, bounded errors, escaped paths, restart, and HTTP/stdio/CLI consistency. No paid model calls.
