# Implementation and verification

Implement [spec.md](spec.md) on the branch and baseline recorded in [intent.md](intent.md).

1. Core owns the optional policy, fixed failure contract, configured ports, input hints, and preflight route shapes. Reuse existing publication and Batch validation. Cover AC1, AC3, AC7.
2. Runtime routes only operation outcomes, leaving startup/input checks and restart handling terminal. Preserve failed executions and raw outputs. Keep cancellation guards around asynchronous completion. Cover AC2 through AC4.
3. Add the settings switch and Failed handle with existing Mantine and canvas helpers. Reuse route pruning on Apply. Add a short inspection hint. Cover AC5 and AC6.
4. Update affected README, architecture, Fetch, agent operations, harness and limits documentation, MCP authoring/execution guidance, and a pending patch changeset. Inspect CLI help for contradictions. Cover AC7.

Build owns deterministic tests with temporary stores and fake HTTP services. Verify successful and failing JavaScript and legacy Bash, configured versus omitted policies, HTTP rejection versus accepted status, output mismatch versus valid output, destination mismatch versus valid recovery, cancelled and interrupted operations versus completed failures, Batch End and ordinary recovery, and a recovery loop reaching its step limit. Assert persisted failure status, error, raw output and port. Invalid publication tests must have a valid connected control; no database schema or multi-record mutation is added.

Extend existing HTTP and stdio transport tests to discover the option and error shape, reject invalid policies, author and publish a recovered workflow, and inspect retained failure history. Use a deterministic testbench comparison to show the unconfigured baseline failing and the configured candidate completing without changing the baseline.

Run focused tests, the full suite, `pnpm build`, `pnpm test:package` after build, and `pnpm format:check`. The package check provides additional confidence that shared MCP schema changes bundle correctly.

For AC5 and AC6, build owns one actual UI journey on a temporary server and database: open Script settings, enable Route on failure, Apply, inspect Out/Failed, save and reopen, verify Raw preservation, run a connected recovery definition, inspect the failed step and completed run, then disable the switch and verify route removal. Check dialog scrolling at a narrow viewport. Reuse available browser tooling and existing UI tests; add no automation framework.

Independent review owns a fresh isolated diff review using Standards and Spec checks, plus targeted boundary experiments around cancellation/restart, recovery output contracts and scoped edges. Review reports exact candidate and evidence. Prepare PR owns clean reviewed HEAD verification, committed artifacts, one PR for this increment, and explicit partial issue linkage. Issue #75 remains open for deferred scope.

## Build evidence

AC1 through AC4 and AC7 have deterministic runtime checks in `tests/failure-routes.test.ts`, including an unchanged failing baseline versus recovered candidate through the testbench. A late Fetch cancellation and an injected completion write failure verify that neither enters recovery. Existing Batch, claim, timer and detached-run suites remain part of the full test run. Core input hints and strict discovery descriptions use one fixed error shape. Testbench route assertions now accept recorded Script/Fetch Failed routes while output checks still require successful node executions.

AC5 and AC6 were exercised through actual controls on a temporary server and database. The journey enabled the Script switch, dragged Failed to Exit, saved and inspected Raw JSON, published v2, started a run, and selected its failed execution. The run displayed Completed with the original error and the Failed-route hint. Reopening settings retained the switch. At 390 by 844, the dialog fit its width, retained its fixed Apply controls and kept the switch and Apply usable after a scroll action. Space toggled the focused switch off; Apply removed only Failed and left two ordinary connections. Screenshots and DOM observations are in `/tmp/interlock-failure-routes-proof/`. The UI files were unchanged by the subsequent runtime-only persistence error guard.

The affected MCP audit covered definition create/update, atomic edit, preflight, import/export, publication, startup, full/compact run inspection, targeted reads, explicit retry, cancellation and testbench assertions. HTTP and stdio tests discover the optional policy and envelope description, reject invalid policies, validate and publish a recovery workflow and inspect its failed history. No tools were added. README, architecture, Fetch, harness, agent operations, current limits and testbench documentation were checked. CLI help remains accurate because existing create/edit/run/retry commands use the same API without new flags. This is an affected-flow audit, not an audit of every unrelated MCP tool.

Full test/build/package/format logs are `/tmp/interlock-failure-routes-{tests,build,package,format}.log`. Independent review checks these against the exact candidate. No user data or real external service was used.

Independent review at `ca6b963307c1e8039f3aebff1ead256893f5a696` verified the behavior and requested one correction, `ca6b963-docs-edge-colors`. The architecture edge-color sentence now includes Script/Fetch Failed routes. This revision changes documentation only; runtime, UI and MCP evidence from that candidate remains applicable. Recheck formatting and independently review the correction before delivery.
