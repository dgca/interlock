# Implementation and validation

Add core schemas, conservative publication checks, and bounded diagnostics. Capture rules beside outputSchema in work. Expose through existing claims and size inspection. Reuse existing editor controls. Verify missing/null/array/type cases, captured bindings, repeated visits, retries, restart, rejection rollback, correction, transfer, editor round trips, and both MCP transports. Run full tests, build, format and package checks, inspect final diff, and open a PR without merging.

## Validation

Full candidate suite passed 835 tests in 71 files, including HTTP and stdio discovery/authoring/claim/preflight/submission and CLI error propagation. Production build, packed global/npx startup and persistence smoke checks, formatting and diff checks passed. A final isolated Batch regression was then added and run with the result-rule/preflight/editor tests. Logs: /tmp/interlock-result-rules-{tests,build,package,format}.log.

Actual browser verification used an isolated temporary database on port 4337: add a candidate equality check, apply, save, reopen and verify both paths. The rendered control layout was inspected in /tmp/interlock-result-rules-editor.png. No user database was touched.

Affected review covered authoring/validation/publication/transfer, full versus compact discovery, claim, shared preflight/submission diagnostics, assignment-size inspection, CLI and editor persistence. No new MCP tools. Rules are optional in full work and omitted from summary discovery; new diagnostics remain ten-item bounded. This is an affected-flow review, not an audit of unrelated tools.
