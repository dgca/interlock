# Executor usage reporting

Issue #133. Implement directly with deterministic tests and one patch changeset.

Each successful claim creates a separate usage-attempt record. It captures assignment, run, node, worker, attempt number, claim-token hash, and lifecycle outcome. Reports never appear in workflow definitions or change claim permissions.

An executor submits a cumulative snapshot for one attempt, with a positive sequence number, a final flag, and up to 20 model entries. Model entries identify provider and model, optional input/output/cache/reasoning token counts, and optional cost in integer millionths of a stated currency with a source. Cache and reasoning counts are subsets, not extra tokens. No prices or account allowances are inferred.

Identical retries of the current sequence are acknowledged without writing. Conflicting or older sequences are rejected. New sequences cannot reduce or omit previously reported values or models. A final snapshot cannot change. Omitted fields remain unknown, including in a final snapshot. A retained claim-token hash permits late usage reporting after completion, failure, expiry, or cancellation, but never authorizes result submission or work resumption.

Read summaries default to one run. An explicit descendant option includes all descendants, including detached runs, exactly once. Totals and bounded groups distinguish attempt outcomes, missing reports, partial snapshots, model identity, and currencies. Legacy attempts without records remain unknown; an existing current claim can report using its retained token. No historical usage is invented.

Use the existing document store for additive records; no database schema migration is required. Delete usage records with their runs. Keep token hashes internal. Expose reporting and bounded inspection through the shared API, MCP, and CLI, plus a compact run-detail component. Document that external executors must supply actual telemetry.

Verify duplicate/conflicting/out-of-order reports, numeric bounds, partial coverage, multiple models/currencies, retries and lost leases, late reports, restart, legacy data, descendant scope, deletion, API/MCP/CLI parity, and UI rendering. Run the full tests, build, formatting, and package smoke test before opening a PR.
