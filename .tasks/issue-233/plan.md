# Implementation Plan: H6 Custom Harness Definitions & Launcher Adapter (`harness: "custom"`)

## Reference
- **Intent**: [intent.md](./intent.md)
- **Specification**: [spec.md](./spec.md)
- **UI Design Specification**: [ui-design.md](./ui-design.md)
- **UI Design Decision**: [decision.md](./decision.md)

---

## 1. Code Areas & Boundaries

Per repository boundaries defined in `AGENTS.md`:
- `packages/core`:
  - `src/executors.ts`: Update `executorProfileSchema` to add `'custom'` to harness enum and define custom profile fields (`mode`, `transport`, `timeoutSeconds`, `env`, `headers`, `turnCommand`, `turnUrl`, `launchCommand`, `launchUrl`, `statusCommand`, `statusUrl`, `messageCommand`, `messageUrl`, `stopCommand`, `stopUrl`, `archiveCommand`, `archiveUrl`).
  - Add claim ticket schema and update worker/claim interfaces.
- `packages/runtime`:
  - `src/executors/contracts.ts`: Add custom harness types and contracts.
  - `src/executors/custom.ts`: Implement `customAdapter` supporting Direct Turn mode (subprocess CLI / HTTP POST) with envelope serialization and token interpolation, and Launcher mode invocation with one-time claim tickets, idempotency tracking, status polling, message delivery, stop, and archive hooks.
  - `src/executors/manager.ts`: Integrate `customAdapter`, manage claim ticket issuance and verification on `assertClaim`, launch idempotency, status check interval, and run completion archival.
  - `src/index.ts`: Update `Worker` interface to accept `claimTicket?: string` and pass to `this.executors.assertClaim(work, worker)`.
  - `src/executors/native.ts`: Include `customAdapter` in native/standard adapters or register dynamically.
- `packages/server`:
  - `src/router.ts`: Update `claim` input schema to accept `claimTicket?: string`.
- `packages/mcp`:
  - `src/server.ts`: Update `claim_work` tool schema and descriptions to accept `claimTicket` and document custom harness lifecycle in `manage_executors`.
- `packages/ui`:
  - `src/features/executors/KeyValueEditor.tsx`: Reusable key-value editor with template token chips.
  - `src/features/executors/CustomProfileDialog.tsx`: Modal dialog for custom harness configuration.
  - `src/features/executors/CustomProfileDialog.module.css`: Styles for modal cards, headers, token chips, and responsive layout.
  - `src/features/executors/Harnesses.tsx`: Add "custom" harness selection in Add Configuration, render custom profiles with mode badges (`custom: direct`, `custom: launcher`) and protocol summary, and open `CustomProfileDialog`.
  - `src/features/executors/Harnesses.module.css`: Badges and styling for custom profiles.
- `docs`:
  - `docs/managed-executors.md`, `docs/connect-harness.md`, `docs/architecture.md`, `docs/v1.md`.
- `.changeset`:
  - Patch changeset for `@type_of/interlock`.

---

## 2. Implementation Sequence & Acceptance Criteria Mapping

### Step 1: Core Schemas & Types (`packages/core`) [AC1, AC3]
- Extend `executorProfileSchema` to permit `harness: 'custom'` and optional configuration fields:
  - `mode: z.enum(['direct', 'launcher']).default('direct')`
  - `transport: z.enum(['subprocess', 'http']).default('subprocess')`
  - `timeoutSeconds: z.number().int().positive().optional()`
  - `env: z.record(z.string()).optional()`
  - `headers: z.record(z.string()).optional()`
  - `turnCommand: z.string().trim().min(1).max(4096).optional()`
  - `turnUrl: z.string().trim().min(1).max(4096).optional()`
  - `launchCommand: z.string().trim().min(1).max(4096).optional()`
  - `launchUrl: z.string().trim().min(1).max(4096).optional()`
  - `statusCommand: z.string().trim().min(1).max(4096).optional()`
  - `statusUrl: z.string().trim().min(1).max(4096).optional()`
  - `messageCommand: z.string().trim().min(1).max(4096).optional()`
  - `messageUrl: z.string().trim().min(1).max(4096).optional()`
  - `stopCommand: z.string().trim().min(1).max(4096).optional()`
  - `stopUrl: z.string().trim().min(1).max(4096).optional()`
  - `archiveCommand: z.string().trim().min(1).max(4096).optional()`
  - `archiveUrl: z.string().trim().min(1).max(4096).optional()`
- Export custom harness helper validation functions.

### Step 2: Custom Adapter & Direct Turn Execution (`packages/runtime`) [AC2, AC7]
- Implement `customAdapter` in `packages/runtime/src/executors/custom.ts`:
  - `detect()` verifies command or endpoint availability.
  - Subprocess execution: spawns command with interpolated environment variables (`$INTERLOCK_WORK_ID`, `$INTERLOCK_RUN_ID`, `$INTERLOCK_CWD`, etc.) and feeds assignment JSON via STDIN; parses output envelope `{ output, sessionId?, model?, provider?, usage? }` from STDOUT.
  - HTTP execution: sends POST request to `turnUrl` with JSON body and custom headers; parses response JSON.
  - Lease renewal handled automatically by `ExecutorManager.checkJobs()`.

### Step 3: Delegated Launcher Mode & Claim Ticket Authorization (`packages/runtime`, `packages/server`, `packages/mcp`) [AC3, AC4, AC5, AC6]
- In `ExecutorManager`:
  - For launcher mode profiles, generate a unique `claimTicket` (UUID) bound to `workId`.
  - Execute `launchCommand` or `launchUrl` with payload containing `claimTicket`, `idempotencyKey`, `workId`, `runId`, `prompt`, `input`, `outputSchema`, `cwd`, etc.
  - Maintain an idempotency registry: identical `idempotencyKey` returns existing session handle.
  - `assertClaim(work, worker)`: if a claim ticket was issued for `workId`, require `worker.claimTicket === issuedTicket`. Reject any unauthorized claimant. Invalidate/consume ticket once claimed.
  - Lifecycle polling: check `status` hook periodically (`working` | `idle` | `needs_attention` | `ended`).
  - Nudge / prompt delivery via `message` hook when idle or requested.
  - Run / session cancellation: invoke `stop` hook.
  - Final assignment or run completion: invoke `archive` hook.
- In `packages/server/src/router.ts`:
  - Pass `claimTicket` parameter through `work.claim` mutation to `ctx.engine.claim`.
- In `packages/mcp/src/server.ts`:
  - Add `claimTicket` to `claim_work` schema and document ticket semantics.

### Step 4: Reference Custom Harness CLI & Integration Tests (`packages/runtime`) [AC7]
- Create reference script `packages/runtime/test/fixtures/custom-harness-reference.js`:
  - Implements direct subprocess turn mode and delegated launcher mode with lifecycle commands.
- Add comprehensive integration test suite `packages/runtime/test/custom-executor.test.ts`:
  - Direct Turn mode via subprocess CLI and HTTP.
  - Launcher mode: launch, claim ticket verification in MCP/engine, status polling, archive hook on completion.
  - Negative checks: invalid claim ticket rejected; replayed claim ticket rejected; wrong cwd blocked.

### Step 5: UI Implementation (`packages/ui`) [AC8]
- Implement `KeyValueEditor.tsx`:
  - Key-value row editing (name, value, delete).
  - Quick-insert token chips (`$INTERLOCK_WORK_ID`, `$INTERLOCK_RUN_ID`, `$INTERLOCK_CWD`, `$INTERLOCK_CLAIM_TOKEN`).
- Implement `CustomProfileDialog.tsx`:
  - 4 clean cards according to approved design:
    1. General Information (name, slug ID).
    2. Execution Mode & Transport (Direct Turn vs Delegated Launcher; Subprocess vs HTTP; Timeout; Permissions; Environment variables).
    3. Endpoints & Commands / Hooks (dynamic based on mode; includes collapsible cards for status, message, stop, archive).
    4. Directory Containment & Security (cwd, allowedRoots).
  - Inline error validation banner.
- Update `Harnesses.tsx`:
  - Add "Custom Harness" in Add Configuration dropdown.
  - Render custom badges (`custom: direct`, `custom: launcher`) with purple accent and protocol summaries.
  - Clicking "Configure" opens `CustomProfileDialog`.
- Update `Harnesses.module.css` and add `CustomProfileDialog.module.css`.

### Step 6: Documentation & Changeset [AC9]
- Update `docs/managed-executors.md`, `docs/connect-harness.md`, `docs/architecture.md`, `docs/v1.md`.
- Update MCP descriptions in `packages/mcp/src/server.ts`.
- Create patch changeset `.changeset/custom-harness-definitions.md`.
- Verify `pnpm test`, `pnpm build`, `pnpm format:check`.

---

## 3. Risk Analysis & Targeted Failure Checks

| Risk / Failure Mode | Direct Verification Check | Expected Outcome |
| :--- | :--- | :--- |
| **Claim Ticket Forgery / Replay** | A rogue worker tries to claim a delegated assignment without a ticket or with a reused ticket. | Claim is rejected with `InterlockError('Claim ticket is required to claim this delegated assignment')` or `'Invalid claim ticket'`. |
| **Launch Idempotency Replay** | Launcher is called multiple times with the same `idempotencyKey` during network retries. | Launch endpoint or command is not duplicated; returns cached session handle. |
| **Subprocess Exit Error / Invalid JSON** | Direct mode subprocess prints non-JSON or exits with non-zero exit code. | Marked as attempt failure with captured stderr; failure budget deducted; does not crash server. |
| **Directory Containment Breach** | Custom profile or task resolves to a cwd outside `allowedRoots`. | Assignment blocked with `cwd_blocked` error and does not execute. |
| **Lifecycle Hook Failure** | Optional `status` or `archive` hook command fails or times out. | Logged without crashing executor lifecycle; archive failure recorded in diagnostics. |

---

## 4. Verification Ownership

- **Build Stage**:
  - Unit and integration tests in `packages/runtime/test/custom-executor.test.ts`.
  - Type checking and project builds (`pnpm build`).
  - Formatting checks (`pnpm format:check`).
  - Packaging smoke test (`pnpm test:package`).
- **Independent Review Stage**:
  - Verification of boundary isolation (core vs runtime vs server vs mcp vs ui).
  - Contract conformance between MCP, API, and UI.
  - Review of changeset and docs.

---

## 5. Representative Interactive UI Journey

- **Goal**: Configure a new custom harness profile in Direct Turn mode and verify listing.
- **Steps**:
  1. Navigate to Settings -> Harnesses in Interlock UI.
  2. In the "Add configuration" card, type name "Python Agent Worker" and select Harness "Custom Harness (`harness: "custom"`)".
  3. Click "Continue with Custom Setup…" button.
  4. The `CustomProfileDialog` modal appears (760px wide).
  5. Select Mode: "Direct Turn Mode", Transport: "Subprocess (CLI)".
  6. Enter Turn Command: `python -m my_agent.turn --work $INTERLOCK_WORK_ID`.
  7. Add an environment variable: `AGENT_ENV` = `production`.
  8. Click "Save configuration".
  9. Modal closes; the Harnesses list immediately displays the new profile with purple badge `custom: direct`, subtitle `Subprocess CLI · Turn: python -m my_agent.turn...`, and Enabled switch.
  10. Clicking "Configure" re-opens `CustomProfileDialog` with all saved settings intact.
