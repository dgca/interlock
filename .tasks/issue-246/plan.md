# Implementation Plan: M9: interlock doctor health and readiness check

## Overview and Reference
This document plans the implementation and verification of the unified read-only `doctor` health and readiness check across `packages/core`, `packages/runtime`, `packages/server`, `packages/cli`, `packages/mcp`, and `packages/ui`.
For acceptance criteria, refer to [spec.md](spec.md); for problem and scope, refer to [intent.md](intent.md).

## Intended Code Areas

### 1. `packages/core` (Maps to AC1)
- `packages/core/src/doctor.ts`:
  - Define `DiagnosticCategory`, `DiagnosticStatus`, `DiagnosticCheck`, `DoctorReport`, `DoctorOptions` and their Zod schemas:
    - `diagnosticCategorySchema`: `'system' | 'harnesses' | 'triggers' | 'blockers' | 'workflows'`
    - `diagnosticStatusSchema`: `'ok' | 'warn' | 'fail'`
    - `diagnosticCheckSchema`: `{ category, name, status, message, details?, remediation? }`
    - `doctorReportSchema`: `{ status, checkedAt, summary: { total, ok, warn, fail }, checks: DiagnosticCheck[] }`
    - `doctorOptionsSchema`: `{ live: z.boolean().optional() }`
- `packages/core/src/index.ts`:
  - Export types and schemas from `doctor.ts`.

### 2. `packages/runtime` (Maps to AC2)
- `packages/runtime/src/doctor.ts`:
  - Implement `runDoctor(engine: Engine, options?: DoctorOptions): Promise<DoctorReport>` with modular checks:
    - `checkSystem(engine)`:
      - Engine version (`VERSION`)
      - Schema version (verifies current SQLite migration version)
      - SQLite database integrity check via `PRAGMA quick_check`
      - Storage and history size: `storageSpace(db)` and run count
      - Disk space: `statfsSync` on db directory or cwd (warn < 1GB, fail < 250MB)
    - `checkHarnesses(engine, live)`:
      - Enabled profiles from `engine.executors.settings()`
      - Binary detection on filesystem/PATH
      - Version check if binary is available
      - `cwd` directory existence
      - `allowedRoots` existence
      - Optional `--live` single-turn auth/model probe when `live: true`
    - `checkTriggers(engine)`:
      - Active schedule lag (overdue `nextTriggerAt` > 60s)
      - Consecutive failures and auto-paused schedules
      - Recent webhook rejections
    - `checkBlockers(engine)`:
      - H3 human intervention / pauses
      - Uncertain resource and executor holds
      - H12 stalled work (`storage.currentStalls()` with unresolved items)
      - `needs_model` holds
    - `checkWorkflows(engine)`:
      - Published workflows referencing missing or disabled variables/aliases
      - Unpublished draft modifications (`draftMatchesLatest === false`)
- `packages/runtime/src/index.ts`:
  - Expose `doctor(options?: DoctorOptions)` method on `Engine`.

### 3. `packages/server` (Maps to AC3)
- `packages/server/src/router.ts`:
  - Add `system: t.router({ doctor: t.procedure.input(doctorOptionsSchema).query(({ ctx, input }) => ctx.engine.doctor(input)) })`.

### 4. `packages/cli` (Maps to AC4)
- `packages/cli/src/commands.ts` & `packages/cli/src/bin.ts`:
  - Handle `interlock doctor [--live] [--json]`:
    - Query `client.system.doctor.query({ live })` with fallback to local engine if server is offline.
    - If `--json`: output structured JSON report.
    - If default: render formatted summary with category headers, check glyphs (✓, ⚠, ✗), summary stats, and remediation guidance for failing checks.
    - Exit code: 0 if status is `ok` or `warn`; 1 if status is `fail`.

### 5. `packages/mcp` (Maps to AC5)
- `packages/mcp/src/server.ts`:
  - Register read-only `doctor` tool with succinct description and schema to respect MCP discovery byte budget.
  - Returns `DoctorReport` bounded output.

### 6. `packages/ui` (Maps to AC6)
- `packages/ui/src/features/diagnostics/Diagnostics.tsx`:
  - Diagnostics screen rendering category cards, status badges, details, and live probe toggle.
- `packages/ui/src/routes/paths.ts` & `packages/ui/src/routes/index.tsx`:
  - Add route `/settings/diagnostics`.
- `packages/ui/src/components/Sidebar/Sidebar.tsx`:
  - Add Diagnostics navigation link.

### 7. Documentation, Tests & Release (Maps to AC7)
- `tests/doctor.test.ts`:
  - Test all check categories and scenarios (db corruption, missing binary, missing variables, stalls, schedule lag).
  - Test CLI formatting, `--json` flag, and failure exit code.
  - Test MCP tool discovery and execution.
- Update `README.md`, `docs/architecture.md`, `docs/v1.md`, and `packages/mcp/src/server.ts`.
- Add patch changeset for `@type_of/interlock`.

## Implementation Sequence
1. **Core Schemas**: Implement `packages/core/src/doctor.ts` and export.
2. **Runtime Diagnostics Runner**: Implement `packages/runtime/src/doctor.ts` and hook into `Engine.doctor()`.
3. **Server API**: Add `system.doctor` in `packages/server/src/router.ts`.
4. **CLI Command**: Add `interlock doctor [--live] [--json]` with exit code 1 on failure.
5. **MCP Tool**: Register `doctor` tool in `packages/mcp/src/server.ts`.
6. **UI Diagnostics View**: Add Diagnostics component, route, and sidebar link in `packages/ui`.
7. **Comprehensive Tests**: Add `tests/doctor.test.ts` covering all checks and edge cases.
8. **Docs & Changeset**: Update documentation and create patch changeset.
9. **Validation**: Run `pnpm test`, `pnpm build`, `pnpm format:check`.

## Risk Analysis & Direct Checks
1. **False positive on clean installations**:
   - *Direct check*: Run doctor on an empty/fresh in-memory or on-disk database with no schedules or harnesses enabled; verify status is `ok` with 0 failures.
2. **Detection of database corruption**:
   - *Direct check*: Mock or inject SQLite error into `PRAGMA quick_check`; verify doctor returns `status: "fail"` with category `"system"` and actionable remediation message.
3. **Detection of missing variables referenced by published workflows**:
   - *Direct check*: Create and publish a workflow referencing `var:missing_api_key`; run doctor; verify category `"workflows"` returns `status: "fail"` identifying the missing variable.
4. **Detection of active blockers and stalls**:
   - *Direct check*: Record an unresolved stall in storage; run doctor; verify category `"blockers"` returns `status: "warn"` or `"fail"` identifying the stall.
5. **CLI exit codes**:
   - *Direct check*: Invoke CLI runner with failing check; verify process exit code is 1. Invoke with all passing checks; verify exit code is 0.

## User Journey for Diagnostics UI
1. User opens navigation and clicks "Diagnostics" (`/settings/diagnostics`).
2. Page displays loading skeleton while `api.system.doctor.query()` runs.
3. Results render grouped into 5 clear category cards with summary badges (`ok`, `warn`, `fail`).
4. If an issue exists (e.g. missing variable), the card highlights in warning/danger color with a remediation recommendation.
5. User clicks "Run Live Probe" button to include live executor model checks.

## Open Questions
- None.
