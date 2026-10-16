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
