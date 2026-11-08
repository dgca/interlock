# Specification: L4: Notifications

See [intent](intent.md) for background, scope, and authorization.

## Acceptance Criteria

- **AC1: Local OS Desktop Notifications for Needs Attention**:
  - Desktop notifications trigger when a run enters the actionable `Needs attention` state (tracked by `runAttention()` in the engine pump loop).
  - Notifications are opt-in and controlled via `INTERLOCK_DESKTOP_NOTIFICATIONS` (e.g. `1`, `true`, `yes`) or Engine option `options.desktopNotifications` (with support for an injectable notifier function `sendDesktopNotification` for deterministic testing).
  - Alerts display the workflow/run identity and the attention reason(s) (such as `approval`, `question`, `model`, `recovery`, `stalled`).
  - Alerts are de-duplicated: repeated poll ticks while a run remains in `Needs attention` do not emit duplicate notifications. Once an item leaves `Needs attention` and later re-enters, a new notification is emitted.
  - Native dispatch uses platform-appropriate commands without third-party dependencies (`osascript` on macOS, `notify-send` on Linux, PowerShell on Windows) in a non-blocking background spawn.

- **AC2: Outbound POST Webhook Action on Lifecycle Events**:
  - `EventConfig` supports an optional `action` field:
    - `{ type: "workflow" }` (default): triggers the target workflow, preserving existing M2 behavior.
    - `{ type: "webhook", url: string, secretId?: string, headers?: Record<string, string>, timeoutMs?: number }`: dispatches an outbound HTTP POST directly to the destination URL without requiring or running a handler workflow.
  - Webhook actions observe configured lifecycle event transitions (`completed`, `failed`, `cancelled`, `needs_attention`, `stalled`) according to the trigger's `scope` (library or workflow) and filters.
  - The request body contains the compact `EventPayload` (`eventId`, `type`, `occurredAt`, `runId`, `workflowId`, `version`, `externalTask`, `stage`, `waiting`, `failingNode`, `error`). No raw workflow data or tokens are transmitted.

- **AC3: HMAC Signature Generation and Headers**:
  - When `secretId` is provided, Interlock resolves the configured `Secret` variable and signs the JSON payload body with HMAC-SHA256.
  - Outbound requests supply:
    - `Content-Type: application/json`
    - `X-Interlock-Event`: the lifecycle event type (e.g. `needs_attention`, `stalled`, `completed`, `failed`, `cancelled`)
    - `X-Interlock-Delivery`: the delivery ID
    - `X-Interlock-Timestamp`: ISO timestamp of dispatch
    - `X-Interlock-Signature`: `sha256=<hex-digest>`
    - `X-Interlock-Signature-256`: `<hex-digest>`
    - Optional custom user headers specified in `action.headers`.
  - When `secretId` is omitted, requests are sent without HMAC signature headers.

- **AC4: Delivery Settlement, Timeouts, and Error Handling**:
  - Webhook requests use a configurable timeout (`timeoutMs`, default 5000ms).
  - Successful HTTP responses (status 200..299) set delivery `outcome: "delivered"`, settle the delivery (`settled: true`), reset `consecutiveFailures: 0`, and update `lastFireAt`.
  - Non-2xx HTTP responses, timeouts, or network errors set delivery `outcome: "failed"`, record `error: string`, settle the delivery, increment `consecutiveFailures`, and trigger `autoPaused` when `pauseAfterConsecutiveFailures` is reached.
  - Webhook delivery errors are isolated and never crash the engine pump loop or affect the source run.

- **AC5: Integration with M2 Lifecycle Trigger Guarantees**:
  - Outbound webhook event triggers share deduplication receipts `(eventId, triggerId)`, preventing re-delivery on restart or visible-log trimming.
  - Outbound webhook event triggers respect causal chain tracking (`maxTriggerDepth`, `triggerChain`), library/workflow pause holds (`pending_pause`), and `waitForQuiescence` (`pending_quiescence`).
  - Validation requires `secretId` to reference a valid `Secret` variable when specified. Webhook action triggers do not require a published handler workflow version.

- **AC6: Documentation, Release Artifacts, and MCP Budget**:
  - Update `docs/architecture.md` and `docs/v1.md`.
  - Add a patch changeset for `@type_of/interlock`.
  - MCP tool definitions remain strictly within the 300,000 bytes limit.

## Decisions and Alternatives

1. **Webhook Action vs Dedicated Notification Workflow**:
   - Running a handler workflow provides rich flexibility but adds substantial execution weight for simple chat/pager notifications. Adding `action: { type: "webhook", ... }` directly to M2 event triggers allows lightweight outbound webhooks while reusing the existing trigger lifecycle, event filtering, deduplication, and failure pause mechanics.
2. **Desktop Notification Placement**:
   - Desktop notifications run at the runtime engine pump boundary specifically when runs transition into `Needs attention`. Tracking transitions with `eventAttentionStates` ensures notifications fire exactly once per attention episode.
3. **Signing Scheme**:
   - Using HMAC-SHA256 with `X-Interlock-Signature` (`sha256=<hex>`) and `X-Interlock-Signature-256` (`<hex>`) matches industry standards (GitHub, Stripe) and allows receivers to verify authenticity and integrity securely.

## Open Questions
- None.
