# Implementation Plan: M4 Session Visibility: Name Templates, Deep Links & Live Tail

## Overview
This plan specifies the implementation steps, touched code areas, verification strategy, and risks for implementing Issue #243.

Reference [Intent](./intent.md) and [Specification](./spec.md).

---

## Code Areas & Touched Packages

1. **`packages/core`**:
   - `packages/core/src/executors.ts`:
     - Update `executorProfileSchema` to add optional `sessionNameTemplate`, `resumeCommandTemplate`, and `deepLinkTemplate`.
     - Update `ManagedExecution` to include `resumeCommand?: string` and `deepLink?: string`.
     - Update `managedWorkSummarySchema` and `ManagedWorkSummary` to include `sessionId?: string`, `resumeCommand?: string`, and `deepLink?: string`.

2. **`packages/runtime`**:
   - `packages/runtime/src/executors/templates.ts` (new module):
     - `evaluateSessionNameTemplate(template: string, context: TemplateContext): string`: Replaces `{{path.to.prop}}` tokens (e.g. `{{externalTask.id}}`, `{{node.label}}`, `{{run.id}}`), cleans control characters, trims, and bounds length.
     - `evaluateLinkTemplate(template: string, vars: Record<string, string>): string`: Replaces `{{sessionId}}`, `{{workId}}`, etc., ensuring safe URLs.
     - Sanitization helper that strips sensitive tokens (e.g. `INTERLOCK_CLAIM_TOKEN`, `INTERLOCK_CLAIM_TICKET`) from progress messages.
   - `packages/runtime/src/executors/contracts.ts`:
     - Update `HarnessResult` and `CustomTurnEnvelope` to support `resumeCommand?: string` and `deepLink?: string`.
   - `packages/runtime/src/executors/custom.ts`:
     - In `buildTokenMap`: include `INTERLOCK_SESSION_NAME`.
     - In `run`: interpolate session name, include in context payload and environment tokens.
   - `packages/runtime/src/executors/pi.ts`:
     - Pass `--session-name <evaluatedName>` when launching a new Pi session.
     - Populate default `resumeCommand: "pi --session " + sessionId`.
   - `packages/runtime/src/executors/claude.ts`:
     - Populate default `resumeCommand: "claude resume " + sessionId`.
   - `packages/runtime/src/executors/manager.ts`:
     - Evaluate `sessionNameTemplate` on custom launcher and direct turn dispatch.
     - Maintain bounded live message ring buffer (last 20 messages) in `record.logs`.
     - Populate `resumeCommand` and `deepLink` on `ManagedExecution` and `ManagedWorkSummary`.
     - Return `resumeCommand` and `deepLink` in `inspect(workId)`.

3. **`packages/server` & `packages/mcp`**:
   - Verify serialization through `packages/server/src/router.ts`.
   - Update `packages/mcp/src/server.ts` description or schemas if necessary to document session visibility fields.

4. **`packages/ui`**:
   - `packages/ui/src/features/executors/ManagedExecutionPanel.tsx`:
     - Prominent session details row: session ID badge, Copy button for `resumeCommand`, clickable link button for `deepLink`.
     - Prominent **Live progress** box displaying the 20-message tail for active/running and held executions.
   - `packages/ui/src/features/executors/ManagedExecutionPanel.module.css`:
     - Styles for session actions and live progress container.
   - `packages/ui/src/features/executors/CustomProfileDialog.tsx`:
     - Configuration inputs for `sessionNameTemplate`, `resumeCommandTemplate`, and `deepLinkTemplate` in Advanced settings.

5. **Documentation & Release**:
   - `docs/managed-executors.md`: Document session name templates, deep links, resume commands, and live tail.
   - `docs/architecture.md`: Note session visibility enhancements in Managed Execution section.
   - Add patch changeset for `@type_of/interlock`.

---

## Planned Implementation Sequence

1. **Contracts and Template Evaluation (`packages/core`, `packages/runtime`)**:
   - Add schemas and types in `packages/core/src/executors.ts`.
   - Implement template evaluation and sanitization in `packages/runtime/src/executors/templates.ts`.
   - Unit test template evaluation, missing properties fallback, sanitization, and credential safety.
2. **Adapter Integration (`packages/runtime`)**:
   - Wire evaluated session names to custom harness (direct & launcher) and Pi harness.
   - Support `resumeCommand` and `deepLink` in custom turn envelope and launcher status response.
   - Add default resume commands for Pi and Claude.
   - Update `ExecutorManager` launch, polling, inspect, and live log ring buffer.
3. **UI Implementation (`packages/ui`)**:
   - Add session visibility (ID, copy button, deep link) and live progress tail to `ManagedExecutionPanel`.
   - Add profile template configuration inputs in `CustomProfileDialog`.
4. **Integration Tests & Verification**:
   - Write comprehensive tests in `tests/sessionVisibility.test.ts`.
   - Run existing executor test suites (`tests/customExecutor.test.ts`, etc.).
   - Run typecheck and builds: `pnpm build`, `pnpm test`, `pnpm format:check`.
5. **Documentation & Changeset**:
   - Update docs and create patch changeset.

---

## Verification Plan & Mapped Acceptance Criteria

- **AC1 (Session Name Templates)**:
  - Unit test: Evaluate templates with complex run data (`{{externalTask.id}} {{node.label}}: {{externalTask.title}}`).
  - Unit test: Fallback to default name when template is empty or contains missing properties.
  - Integration test: Custom launcher receives evaluated `sessionName` in payload and `INTERLOCK_SESSION_NAME` in env.
- **AC2 (Native Session ID, Resume Command & Deep Link)**:
  - Unit test: Template evaluation for `resumeCommand` and `deepLink`.
  - Unit test: Direct harness return values take precedence over templates.
  - Verification: `inspect` returns `sessionId`, `resumeCommand`, `deepLink`.
- **AC3 (Bounded Live Tail Buffer)**:
  - Unit test: Progress messages beyond 20 are truncated to the latest 20.
  - Unit test: Live tail messages sanitize claim tickets and authorization secrets.
- **AC4 (API & MCP Inspection)**:
  - Verification: `manage_executors` `inspect` returns session info and logs.
- **AC5 (Security)**:
  - Negative check: Injected sensitive tokens in context are not reflected in templates.
  - Deep link validation: Rejects non-HTTP(S) protocol links.

---

## Representative UI User Journey

1. **Setup**: Operator configures a custom launcher or Pi harness with `sessionNameTemplate: "{{externalTask.id}} {{node.label}}"`.
2. **Execution**: Run starts with external task `GH-243` and Agent node `draft`.
3. **Inspection**:
   - In Run Inspector, operator clicks on the active Agent node.
   - The **Session** row shows the native session ID with a **Copy resume command** button and **Open in harness** link.
   - Clicking **Copy resume command** copies the command to clipboard and shows brief confirmation.
   - The **Live progress** box displays real-time progress messages (up to 20) with timestamps without needing to expand collapsed details.
