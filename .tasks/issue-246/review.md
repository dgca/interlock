# Review: Issue #246 - M9: interlock doctor health and readiness check

## Summary
- **Verdict**: `revise`
- **Base Commit**: `db544c60ecf68f368031187b347ef9c634975a11`
- **Reviewed Commit**: `f33cc28f7c948cc738f012bbe8fa2b292825a561`
- **Review Scope**: `full`
- **Scope Reason**: Initial complete review of all acceptance criteria for Issue #246.

The overall implementation of the `interlock doctor` operation is clean, comprehensive, and well-structured across `packages/core`, `packages/runtime`, `packages/server`, `packages/cli`, `packages/mcp`, and `packages/ui`. All 5 check categories (`system`, `harnesses`, `triggers`, `blockers`, `workflows`) are implemented in `runDoctor` with appropriate remediation messages, non-destructive read-only queries, and tRPC integration. The UI diagnostics screen at `/settings/diagnostics` and CLI command formatting are thoroughly implemented.

However, the change cannot pass review yet because `pnpm test` fails with 17 test failures across 8 transport test suites due to an un-updated tool count (from 61 to 62), and AC7's requirement to verify failure exit codes via tests is partially unverified.

---

## Findings

### Finding 1: MCP Transport Test Suites Fail on Tool Discovery Count
- **ID**: `f33cc28-transport-tests-tool-count`
- **Location**: `tests/comparisonConfigurationsTransport.test.ts`, `tests/comparisonMetricsTransport.test.ts`, `tests/nodeResultsTransport.test.ts`, `tests/runChainTransport.test.ts`, `tests/runStartTransports.test.ts`, `tests/starterTransports.test.ts`, `tests/trialTransports.test.ts`, `tests/workflowFailureTransport.test.ts`
- **Details**:
  `pnpm test` fails with 17 test failures across 8 transport test suites because the expected MCP tool count was not updated from 61 to 62 after registering the new `doctor` tool in `packages/mcp/src/server.ts`.
  Repository instructions in `AGENTS.md` explicitly specify:
  > "When MCP definitions change, check what clients discover over both HTTP and stdio with the transport tests."
  Updating `expect(tools).toHaveLength(61)` to `62` in the 8 affected transport test files is required for the full test suite to pass.

### Finding 2: Missing Test for CLI Binary Exit Codes
- **ID**: `f33cc28-cli-exit-code-test-gap`
- **Location**: `tests/doctor.test.ts`
- **Details**:
  AC7 specifies: "Tests verify all doctor checks, JSON output format, and failure exit codes."
  In `tests/doctor.test.ts`, the test suite verifies `formatDoctorReport` and `runCommand(['doctor'])` returning reports with status `fail`, but does not test the CLI binary entry point's exit code handling (either via child process execution or testing `process.exit` in `bin.ts`).

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
| :--- | :--- | :--- |
| **AC1: Core Schemas and Contracts** | Verified | `packages/core/src/doctor.ts` defines and exports `diagnosticCategorySchema`, `diagnosticStatusSchema`, `diagnosticCheckSchema`, `doctorReportSchema`, and `doctorOptionsSchema`. Verified schema parsing in `tests/doctor.test.ts`. |
| **AC2: Runtime Diagnostics Runner** | Verified | `packages/runtime/src/doctor.ts` implements `runDoctor(engine, options)` covering engine version, migration schema version, `PRAGMA quick_check`, storage metrics, `statfsSync` free disk space, enabled harness detection/cwd/allowedRoots/live probe, schedule lag, auto-pause/failure triggers, webhook rejections, H3 pauses, uncertain locks, H12 stalls, needs_model holds, missing/disabled variables, and unpublished drafts. Verified in `tests/doctor.test.ts`. |
| **AC3: Server API `system.doctor`** | Verified | `packages/server/src/router.ts` exposes `system.doctor` query procedure. Verified query over tRPC in `tests/doctor.test.ts`. |
| **AC4: CLI `interlock doctor [--live] [--json]`** | Verified | `packages/cli/src/bin.ts` and `commands.ts` handle `interlock doctor [--live] [--json]` with `formatDoctorReport`, `--json` raw serialization, and `process.exit(report.status === 'fail' ? 1 : 0)`. |
| **AC5: MCP `doctor` Tool** | Verified | `packages/mcp/src/server.ts` registers `doctor` tool with compact schema and bounded `doctorReportSchema` output. |
| **AC6: UI Diagnostics View** | Verified | `packages/ui/src/features/diagnostics/Diagnostics.tsx`, `routes/paths.ts`, `routes/index.tsx`, and `Sidebar.tsx` implement `/settings/diagnostics` with banner, category cards, status badges, live probe toggle, and remediation details. Cleanly builds in Vite. |
| **AC7: Tests, Docs & Changeset** | Gap | Documentation (`README.md`, `docs/architecture.md`, `docs/v1.md`) and patch changeset (`.changeset/doctor-health-check.md`) are complete. However, `pnpm test` fails due to 8 un-updated transport test files expecting 61 instead of 62 tools, and tests do not cover the CLI process exit codes. |

---

## Standards Verification

- **test**: Failed (`pnpm test` has 17 failures in 8 transport test suites).
- **build**: Passed (`pnpm build` completed with 0 errors).
- **format:check**: Passed (`prettier --check .` passed cleanly).
- **boundaries**: Passed (Strict layering between `@interlock/core`, `@interlock/runtime`, `@interlock/server`, `@interlock/storage`, `@interlock/cli`, and `@interlock/ui` maintained).
- **documentation**: Passed (`README.md`, `docs/architecture.md`, `docs/v1.md`, and `packages/mcp/src/server.ts` updated).
