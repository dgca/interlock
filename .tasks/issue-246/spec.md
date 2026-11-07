# Specification: M9: interlock doctor health and readiness check

## Overview and Reference
This specification defines the functional requirements, schemas, execution rules, CLI command, MCP tool, shared API endpoint, and UI diagnostics view for the read-only `doctor` health and readiness check operation.
For problem background, high-level outcomes, constraints, and baseline information, refer to [intent.md](intent.md).

## Acceptance Criteria

### AC1: Diagnostic Core Schemas and Contracts (`packages/core`)
- In `packages/core/src/doctor.ts` (re-exported in `index.ts`):
  - Diagnostic category enum/type `DiagnosticCategory`: `'system' | 'harnesses' | 'triggers' | 'blockers' | 'workflows'`.
  - Diagnostic status enum/type `DiagnosticStatus`: `'ok' | 'warn' | 'fail'`.
  - Diagnostic check item `DiagnosticCheck`:
    - `category`: `DiagnosticCategory`
    - `name`: `string`
    - `status`: `DiagnosticStatus`
    - `message`: `string`
    - `details` (optional): `Record<string, unknown>`
    - `remediation` (optional): `string`
  - Overall report `DoctorReport`:
    - `status`: `DiagnosticStatus` (highest severity among all checks: `fail` > `warn` > `ok`)
    - `checkedAt`: `string` (ISO timestamp)
    - `summary`: `{ total: number; ok: number; warn: number; fail: number }`
    - `checks`: `DiagnosticCheck[]`
  - Doctor options `DoctorOptions`:
    - `live`: optional `boolean` (default `false`)
  - Zod schemas: `diagnosticCategorySchema`, `diagnosticStatusSchema`, `diagnosticCheckSchema`, `doctorReportSchema`, `doctorOptionsSchema`.

### AC2: Modular Diagnostics Runner (`packages/runtime`)
- In `packages/runtime/src/doctor.ts`:
  - Provide `runDoctor(engine: Engine, options?: DoctorOptions): Promise<DoctorReport>`.
  - **Category: System & Storage (`system`)**:
    - **Engine Version**: checks current runtime version against `VERSION` constant (`ok`).
    - **Schema Version**: verifies SQLite migration schema version against target schema version (`ok` if current; `fail` if outdated).
    - **SQLite Integrity**: executes `PRAGMA quick_check` (or `integrity_check`) on SQLite connection (`ok` if returns 'ok'; `fail` with corrupt message otherwise).
    - **Storage & History Size**: inspects `storageSpace(db)` (`databaseBytes`, `reusableBytes`) and run document count; returns stats in details (`ok`).
    - **Free Disk Space**: checks filesystem free space on storage directory using `statfsSync`; sets status `fail` if available space < 250MB, `warn` if < 1GB, `ok` otherwise, reporting free and total bytes.
  - **Category: Harness Profiles (`harnesses`)**:
    - Queries configured executor profiles from engine (`engine.executors.settings()`).
    - For each enabled profile:
      - Binary detection: checks executable path or PATH resolution (`fail` if binary missing).
      - Binary version: checks detected version string.
      - Working directory (`cwd`): checks that path exists and is a directory (`fail` if missing).
      - `allowedRoots`: verifies that all declared root paths exist on filesystem (`fail` or `warn` if any missing).
      - Live probe (`--live`): if `options.live` is true, performs a probe (e.g. model listing or ping) on the enabled harness (`warn` or `fail` on auth/model connection failure).
  - **Category: Active Triggers (`triggers`)**:
    - Evaluates schedules:
      - Schedule lag: checks if any active schedule has overdue `nextTriggerAt` beyond allowable tolerance (e.g. > 60 seconds overdue) (`warn`).
      - Consecutive failures & auto-paused schedules: checks triggers with failure counts > 0 or auto-paused due to repeated failures (`warn` or `fail`).
    - Evaluates webhooks: checks recent rejection history or configuration mismatches if any (`warn`).
  - **Category: Active Blockers (`blockers`)**:
    - Runs in H3 pause / human intervention: checks active runs with unaddressed `needs_human` requests or pause attention (`warn`).
    - Uncertain resource / executor holds: checks held work waiting on resource locks or uncertain executor ownership (`warn`).
    - H12 stalled work: queries `storage.currentStalls()` where `resolvedAt` is null (`warn` or `fail`).
    - `needs_model` holds: queries active executions held in `needs_model` waiting for model selection (`warn`).
  - **Category: Workflows & Dependencies (`workflows`)**:
    - Checks published workflows:
      - Verifies that all referenced variables and aliases exist and are enabled in variable storage (`fail` if referenced variable is missing or disabled).
    - Checks workflows with unpublished draft edits:
      - Surfaces workflows where `draftMatchesLatest === false` (indicating unpublished draft modifications) (`warn` or `ok` info).

### AC3: Shared Server API `system.doctor` (`packages/server`)
- In `packages/server/src/router.ts`:
  - Add `system: t.router({ doctor: t.procedure.input(doctorOptionsSchema).query(...) })`.
  - Invokes `runDoctor(engine, input)`.
  - Re-exported through `@interlock/client`.

### AC4: CLI Command `interlock doctor [--live] [--json]` (`packages/cli`)
- In `packages/cli/src/bin.ts` & `packages/cli/src/commands.ts`:
  - `interlock doctor [--live] [--json]`:
    - Calls `client.system.doctor.query({ live })` (or local fallback if engine is local/embedded).
    - If `--json`: outputs raw formatted JSON `JSON.stringify(report, null, 2)`.
    - If default: formats readable CLI output with categories, status icons (✓ ok, ⚠ warn, ✗ fail), summary banner, and detailed remediation advice for failing checks.
    - Process exit code: returns 0 if `report.status` is `'ok'` or `'warn'`; returns 1 if `report.status` is `'fail'`.

### AC5: MCP Doctor Tool (`packages/mcp`)
- In `packages/mcp/src/server.ts`:
  - Register tool `doctor`:
    - Description: Compact, bounded summary of system health and readiness (storage, harnesses, triggers, blockers, workflows).
    - Input schema: `{ live: z.boolean().optional() }`.
    - Output: Returns `DoctorReport` bounded summary.
    - Keep tool description and schema concise to preserve MCP discovery byte budget.

### AC6: UI Diagnostics View (`packages/ui`)
- In `packages/ui`:
  - Add Diagnostics route `/settings/diagnostics` (and link from Sidebar or Settings).
  - Fetches `api.system.doctor.query()`.
  - Displays:
    - Overall status banner (`ok` in green, `warn` in yellow, `fail` in red).
    - Quick action button to re-run check (with optional toggle for `--live` probe).
    - Cards/accordions for each category (`system`, `harnesses`, `triggers`, `blockers`, `workflows`).
    - For each check: status indicator, check title, descriptive message, expandable details, and highlighted remediation steps for issues.

### AC7: Tests, Documentation & Changeset
- Automated tests in `tests/doctor.test.ts` verifying:
  - Database integrity, schema version, storage stats, and disk space checks.
  - Harness profile binary, version, cwd, allowedRoots, and live probe checks.
  - Active trigger lag and auto-pause detection.
  - Active blocker detection (H3 pauses, H12 stalls, needs_model holds).
  - Missing variable reference detection and unpublished draft surfacing.
  - CLI execution with `--json` and human-readable formatting, including exit code 1 on failure and 0 on ok/warn.
  - MCP tool registration and response over HTTP and stdio.
- Documentation updates:
  - `README.md`: document `interlock doctor` CLI usage and flags.
  - `docs/architecture.md`: document system diagnostics and health readiness checks.
  - `docs/v1.md`: document doctor capabilities.
  - `packages/mcp/src/server.ts`: updated tool registration and instructions.
- Add patch changeset for `@type_of/interlock`.

## UI Proposal for Diagnostics View
- **User Flow**: User clicks "Diagnostics" in sidebar navigation (or under Settings) -> UI loads doctor report via `api.system.doctor.query()` -> Displays summary stats and category breakdown. User can click "Run Live Probe" to include active harness model verification.
- **Layout & Placement**:
  - Header: "System Diagnostics & Readiness", overall status Badge (`OK`, `Warning`, `Failing Checks`), "Refresh" button, "Include Live Probes" toggle.
  - Category Sections: Mantine `Paper` / `Card` cards grouped by category (`System & Storage`, `Harness Profiles`, `Active Triggers`, `Active Blockers`, `Workflows & Dependencies`).
  - Check Row: Status icon (`Check`, `AlertTriangle`, `XCircle`), check title, message, expandable remediation box in subtle warning/error theme.
- **Loading / Empty / Error States**:
  - Loading: Mantine `Loader` or skeleton matching `RouteSkeleton`.
  - Error: Error alert with "Retry diagnostics" button.
- **Narrow-screen Behavior**:
  - Category cards stack vertically with responsive full-width wrapping.

## Decisions and Alternatives Considered
- **Read-only Safety**: `interlock doctor` strictly queries state and never executes destructive operations or modifies configurations.
- **Exit Code Convention**: Follows standard CLI convention (exit 0 on success/warnings, exit 1 on failure) so CI/CD pipelines can use `interlock doctor` as a pre-flight readiness gate.
- **Discovery Budget**: MCP tool description is kept succinct to prevent inflating MCP client prompt overhead.

## Open Questions
- None.
