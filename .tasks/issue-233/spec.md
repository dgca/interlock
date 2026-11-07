# Specification: H6 Custom Harness Definitions & Launcher Adapter (`harness: "custom"`)

## Reference
- **Intent**: [intent.md](./intent.md)
- **Approved UI Design**: [ui-design.md](./ui-design.md)
- **UI Design Decision**: [decision.md](./decision.md)

---

## Acceptance Criteria

### AC1: Profile Configuration Schema & API Support (`harness: "custom"`)
- The profile schema in `@interlock/core` (`packages/core/src/executors.ts`) supports `harness: 'custom'`.
- A custom profile specifies:
  - `id`: unique profile identifier.
  - `name`: display label.
  - `harness: 'custom'`.
  - `mode: 'direct' | 'launcher'`.
  - `transport: 'subprocess' | 'http'`.
  - `timeoutSeconds?: number`.
  - `env?: Record<string, string>`.
  - `permissions?: 'standard' | 'read-only' | 'full-access'`.
  - `cwd?: string`.
  - `allowedRoots?: string[]`.
  - When `mode === 'direct'`:
    - `turnCommand?: string` (required if `transport === 'subprocess'`)
    - `turnUrl?: string` (required if `transport === 'http'`)
    - `headers?: Record<string, string>` (optional HTTP headers)
  - When `mode === 'launcher'`:
    - `launchCommand?: string` (required if `transport === 'subprocess'`)
    - `launchUrl?: string` (required if `transport === 'http'`)
    - `headers?: Record<string, string>`
    - Optional lifecycle hooks:
      - `statusCommand?: string` / `statusUrl?: string`
      - `messageCommand?: string` / `messageUrl?: string`
      - `stopCommand?: string` / `stopUrl?: string`
      - `archiveCommand?: string` / `archiveUrl?: string`
- Supported across UI, CLI (`interlock executor`), MCP (`manage_executors`), and server API endpoints.

### AC2: Direct Turn Mode Execution
- For assignments dispatched to a profile with `mode: "direct"`:
  - Interlock claims the assignment and launches/invokes the configured turn command or HTTP POST endpoint.
  - Assignment context JSON is passed via stdin (for subprocess) or JSON body (for HTTP POST):
    `{ idempotencyKey, workId, attempt, prompt, input, outputSchema, cwd, model, effort, permissions, sessionName, sessionId }`.
  - Environment variable interpolation replaces tokens (`$INTERLOCK_WORK_ID`, `$INTERLOCK_RUN_ID`, `$INTERLOCK_CWD`, etc.).
  - Output envelope parsed from STDOUT or HTTP JSON response:
    `{ output, sessionId?, model?, provider?, usage? }`.
  - `ExecutorManager` automatically manages claim lease renewal in the background during turn execution and submits the result upon completion.
  - Process exit with non-zero or HTTP error causes clean failure/retry per node policy.

### AC3: Delegated Claim-Ticket Mode (Launcher)
- For assignments dispatched to a profile with `mode: "launcher"`:
  - Interlock issues a cryptographically random, one-time `claimTicket` bound strictly to `workId` and `runId`.
  - Interlock executes the `launch` command or HTTP POST with launch payload including `{ idempotencyKey, workId, runId, claimTicket, prompt, input, cwd, ... }` and token interpolation in environment/args.
  - The external agent session presents this `claimTicket` when calling MCP `claim_work` (or shared API).
  - MCP `claim_work` verifies the ticket; if valid, grants the claim and invalidates or marks the ticket as claimed.
  - Any claimant attempting to claim without the ticket, or presenting an invalid ticket, is rejected.

### AC4: Launch Idempotency
- When `launch` is called with the same `idempotencyKey` (e.g. during retry, recovery, or reconnect), it returns the existing session handle or acknowledges the existing session without spinning up a duplicate container/subprocess.

### AC5: Status Polling, Message Delivery, and Recovery
- If `statusCommand` or `statusUrl` is defined, `ExecutorManager` polls session status periodically:
  - Allowed status values: `'working' | 'idle' | 'needs_attention' | 'ended'`.
- If status is `needs_attention` or `idle` beyond a threshold, Interlock can deliver nudges or prompts via `messageCommand` or `messageUrl`.
- If cancellation is requested on the run or work item, Interlock invokes `stopCommand` or `stopUrl`.

### AC6: Session Archival
- When the session's final assignment in the run finishes (or run terminates), Interlock invokes `archiveCommand` or `archiveUrl` to clean up containers, processes, or remote resources.

### AC7: Reference Custom Harness CLI Script & Contract Integration Tests
- A reference executable script `packages/runtime/test/fixtures/custom-harness-reference.js` (or `.ts`) demonstrating both Direct and Launcher modes.
- Integration tests in `packages/runtime` verifying:
  - Direct Turn mode with subprocess and HTTP mock.
  - Launcher mode with claim ticket verification, status polling, and archive call.
  - Ticket binding rejection on wrong workId or replay.

### AC8: UI Implementation in `packages/ui`
- Implements `CustomProfileDialog.tsx` and updates `Harnesses.tsx` according to `.tasks/issue-233/ui-design.md`:
  - Profile card displays `custom: direct` / `custom: launcher` badge and protocol summary.
  - Dialog supports 4 cards: General Information, Execution Mode & Transport, Endpoints/Commands/Hooks, Directory Containment & Security.
  - Key-value editor for environment variables and HTTP headers with token insertion chips.
  - Responsive design, full keyboard accessibility, inline error validation.

### AC9: Documentation & MCP Alignment
- Update:
  - `docs/managed-executors.md`
  - `docs/connect-harness.md`
  - `docs/architecture.md`
  - `docs/v1.md`
  - `packages/mcp/src/server.ts` tool descriptions and schemas for `manage_executors` and `claim_work`.
- Add a patch changeset in `.changeset/` for `@type_of/interlock`.

---

## UI Proposal Summary
As detailed in the user-approved [ui-design.md](./ui-design.md):
- **Listing**: In `Harnesses.tsx`, custom harness profiles render with a distinct purple accent badge (`custom: direct` or `custom: launcher`), protocol summary, enabled switch, and configure button.
- **Add Configuration**: The "Add configuration" section includes an option for `Custom Harness (harness: "custom")`. Selecting it provides a button to open `CustomProfileDialog`.
- **CustomProfileDialog**: 760px Mantine modal with 4 clean sections (General Info, Mode & Transport, Endpoints/Hooks, Security/Containment) with key-value table editor, template chips, and inline error banner.
