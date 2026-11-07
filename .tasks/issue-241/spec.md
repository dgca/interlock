# Lifecycle event trigger behavior

See [intent](intent.md) for scope, constraints and authorization.

## Acceptance criteria

- AC1. Event triggers use the shared trigger create, update, enable, disable, delete, list and inspect operations. Configuration selects one or more completed, failed, cancelled, needs_attention or stalled events, a library scope or a source workflow with optional owned children, and an optional completed Exit node filter. Enabling requires a published active target and a valid source. New triggers are disabled.
- AC2. A matching transition delivers a compact JSON input containing eventId, type, occurredAt, runId, workflowId, version, externalTask when present, stage and waiting when present, failing node when present, and a bounded error summary. No workflow inputs, outputs or raw event history are copied. Needs attention is a transition into the existing actionable attention state, not every inspection poll. Stall events retain the existing stall detector semantics.
- AC3. Every eventId and triggerId pair has a durable receipt. Restart, duplicate delivery and pruned visible logs cannot repeat its effect. Runs inherit a persisted triggerChain through child, detached and continued runs. A trigger in the chain is suppressed. maxTriggerDepth defaults to 2, accepts 1 through 20, and suppresses starts once the chain reaches the configured cap. Suppression appears in the delivery log.
- AC4. waitForQuiescence is valid only for terminal event selections. It defers dispatch until the source run and every descendant, including detached and continued runs, are terminal and no scripts, managed executions, active claims or uncertain ownership remain. Explicit reconciliation can release the gate. No automatic stop confirmation is inferred from a terminal parent.
- AC5. Target pauses and automatic failure pauses defer pending events. Starts use ordinary idempotent admission and latest published target version. Failed starts and failed handler runs count toward pauseAfterConsecutiveFailures. Successful handler runs reset the counter. Disable or deletion prevents pending dispatch. Reenable does not replay previously disabled-time events.
- AC6. Portable exports retain safe event configuration and dependencies. Imports disable triggers and reset local history and counters. Existing schedule and webhook paths remain compatible.
- AC7. UI, CLI and MCP use the shared union. List responses stay compact. Exact inspection exposes a paginated delivery log with outcome, event/source identity, resulting run and bounded error or suppression reason. History keeps at most 200 settled delivery rows while retaining dedupe receipts and pending work. Documentation describes selection, limits, pause behavior and quiescence.

## UI proposal

Extend the existing Triggers tab and editor with an Event kind. Reuse Mantine controls, the trigger table, revision protection, notifications and log pagination. Event controls select source scope/workflow, event kinds, optional Exit node, quiescence and depth. Hide unrelated schedule/webhook controls. Preserve existing loading, empty, save-error and success patterns. Keyboard focus follows the modal form order, and the current responsive stack and scrollable table apply on narrow screens. Human UI review remains deferred by queue authorization; automated checks and any available local rendering are build evidence.

## Decisions and risks

The target workflow receives the event object directly as its input. Source workflow scope uses current ownership when the event occurs. Trigger configuration uses events, scope, exitNodeId, waitForQuiescence, maxTriggerDepth and the shared failure threshold. Scope is library or workflow with includeChildren. A new trigger observes future transitions only. Pending deliveries retain the compact event and source causal chain, so edits cannot erase causal history.

Quiescence is deliberately conservative. An expired connected claim remains uncertain until the existing stop/reconciliation mechanism confirms that execution stopped. Operator reconciliation is required when the engine cannot prove termination. Trigger handlers start independently of source run cancellation and do not change ordinary descendant cancellation boundaries.

No unresolved product questions. These choices implement #241 and #223 without domain-specific tracker integrations.
