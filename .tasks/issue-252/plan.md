# Plan: L4: Notifications

See [intent](intent.md) for scope, constraints, and authorization, and [spec](spec.md) for acceptance criteria (AC1–AC6).

## Code Areas
- **`packages/core`**:
  - `src/eventTriggers.ts`: Add `eventActionSchema` (`workflow` | `webhook`), update `eventConfigSchema` and `EventDelivery` outcome (`delivered`).
  - `src/workflowTriggers.ts`: Preserve `action` in `triggerConfig` serialization and discovery.
  - `src/transfer.ts`: Capture referenced `secretId` from webhook actions in portable bundle dependencies.
  - `src/notifications.ts`: Define `DesktopNotification` types and interfaces.
  - `src/index.ts`: Export new schemas and types.
- **`packages/runtime`**:
  - `src/eventTriggers.ts`: Implement outbound webhook dispatch with HMAC-SHA256 signing, header generation, timeouts, and delivery settlement.
  - `src/notifications.ts`: Implement desktop notification dispatcher with cross-platform native commands (`osascript`, `notify-send`, PowerShell) and test injection hook.
  - `src/index.ts`: Wire desktop notifications to the `Needs attention` state transitions in `pump()`.
- **`packages/server`**:
  - `src/start.ts`: Propagate desktop notification options from environment / config.
  - `src/router.ts`: Support notification triggers and inspection.
- **`packages/mcp`**:
  - `src/server.ts`: Verify trigger descriptions and keep tool discovery strictly under the 300,000 bytes budget.
- **`docs` & Release**:
  - `docs/architecture.md`, `docs/v1.md`.
  - Changeset for `@type_of/interlock`.
- **Tests**:
  - `tests/notifications.test.ts`
  - `tests/eventWebhooks.test.ts`
  - `tests/transport.test.ts`

## Implementation Sequence
1. **Core Schemas & Types**: Update `packages/core/src/eventTriggers.ts`, `workflowTriggers.ts`, `transfer.ts`, and `index.ts` to support `action` on event triggers and desktop notification contracts.
2. **Runtime Outbound Webhooks**: Implement outbound HTTP POST webhook dispatch in `packages/runtime/src/eventTriggers.ts` with HMAC-SHA256 signature computation, custom headers, timeout handling, and delivery outcome updates.
3. **Runtime Desktop Notifications**: Implement `packages/runtime/src/notifications.ts` and hook it into `Engine.pump()` when runs transition into `Needs attention`. Support mockable notifier in engine options.
4. **Server Integration**: Connect `INTERLOCK_DESKTOP_NOTIFICATIONS` in `packages/server`.
5. **Testing**: Add comprehensive unit and integration tests for trigger conditions, signature verification, error handling, auto-pause, and desktop notifications.
6. **Documentation & Changeset**: Update `docs/architecture.md`, `docs/v1.md`, and add a patch changeset for `@type_of/interlock`.
7. **Verification**: Run `pnpm test`, `pnpm build`, `pnpm format:check`, and transport budget checks.

## Negative Checks and Failure Modes
- **Invalid HMAC Secret**: Event trigger validation fails if `secretId` does not reference an existing `Secret` variable.
- **Network Failure & Timeout**: When the destination webhook is unreachable or times out, the delivery is marked `failed` with error details, the engine does not crash, and consecutive failures increment toward `autoPaused`.
- **Repeated Attention Pumping**: Repeated pump ticks while a run remains in `Needs attention` do not emit duplicate notifications.
- **MCP Discovery Budget**: Run `tests/transport.test.ts` to verify discovery remains strictly under 300,000 bytes.
