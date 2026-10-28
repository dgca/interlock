# Implementation and verification

Keep hold contracts in core, interval persistence in storage documents through runtime, and execution in a focused WorkHolds module. Extend existing shared API, inspection and continuation. Test idempotency, stale-token/attempt/revision races, rollback, restart, deadline equality/crossings, separate/combined budgets, telemetry, cancellation, nested Batch and detached lifecycles, pagination/deletion, and UI resume. Audit affected MCP schemas and descriptions over HTTP and stdio. Run full tests, build, formatting and post-build package smoke. Open the second PR against codex/agent-result-rules and leave both PRs open.

## Validation and review

Full candidate suite passed 855 tests in 73 files. After the final documentation/MCP guidance and text-wrapping pass, 29 focused lifecycle, HTTP/stdio and UI tests passed, including an additional read-only-history/continuation-wakeup regression. Production build, post-build packed installation smoke, formatting and diff checks passed. The three JSON examples in docs/work-holds.md parse against the request schema. Logs are /tmp/interlock-assignment-holds-{tests,build,package,format}.log and final-tests/final-build/final-package variants.

Browser verification used an isolated temporary database on port 4338: inspect the blocker and persisted interval, resume, verify no claim is retained, claim manually, submit and observe completion. Rendered captures are /tmp/interlock-assignment-held.png and /tmp/interlock-assignment-resumed.png. A 768px inspection with maximum-length reason and checkpoint checks wrapping. No user database was touched.

Reviewed contracts, capture/claim/submission, expiry/recovery accounting, budgets and late usage, continuity, timers/restart, cancellation/detached/Batch lifecycles, history cleanup, UI resume, CLI and docs. MCP review covered the new grouped operation and affected existing discovery, briefing/wait, claim/renew/fail/preflight/submit, full inspection and telemetry guidance. This is an affected-flow review, not a full unrelated-tool audit.

Both MCP transports discover 49 tools and 227,274 bytes of serialized definitions versus 48 tools and 222,235 bytes on the first PR. The 5,039-byte increase is about 2.3%, not a token estimate. One grouped lifecycle/history tool avoids separate hold/resume/list tools. Summaries omit heldWork unless needed; blocker reasons and checkpoints stay out of routine discovery. History defaults to 20 and caps at 100 intervals; full inspection includes 20 recent intervals per affected assignment.
