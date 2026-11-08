# Lifecycle event triggers

Event triggers start a workflow when a run completes, fails, is cancelled, needs attention, or stalls. They share trigger management with [schedules](schedules.md) and [webhooks](webhooks.md).

## Configuration

Create a trigger on the handler workflow. The handler receives the compact event object directly as its workflow input. The handler must have a compatible input contract and a retained published version before the trigger can be enabled. New triggers are disabled.

```json
{
  "action": "create",
  "workflowId": "HANDLER_WORKFLOW_ID",
  "config": {
    "kind": "event",
    "name": "Clean up finished work",
    "tags": { "pipeline": "cleanup" },
    "events": ["completed", "failed", "cancelled"],
    "scope": {
      "type": "workflow",
      "workflowId": "SOURCE_WORKFLOW_ID",
      "includeChildren": true
    },
    "waitForQuiescence": true,
    "maxTriggerDepth": 2,
    "pauseAfterConsecutiveFailures": 3
  }
}
```

Pass this request to `interlock triggers manage @event-trigger.json`, the shared API `triggers.manage`, or MCP `manage_workflow_triggers` inside its `request` field. The workflow's **Triggers** tab exposes the same controls. Inspect the trigger and use its current `revision` as `expectedRevision` for update, enable, disable, or delete. Update replaces the entire configuration. A trigger's kind cannot change.

| Field                           | Behavior                                                                                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`                        | One or more of `completed`, `failed`, `cancelled`, `needs_attention`, or `stalled`.                                                                                                                                                                                         |
| `scope`                         | `{ "type": "library" }` observes all workflows. `{ "type": "workflow", "workflowId": "…", "includeChildren": false }` observes one workflow. `includeChildren: true` also observes its currently owned child workflows.                                                     |
| `action`                        | Optional action object: `{ "type": "workflow" }` (default) starts the target workflow; `{ "type": "webhook", "url": "…", "secretId": "…", "headers": {…}, "timeoutMs": 5000 }` dispatches an outbound HMAC-signed POST webhook directly without running a handler workflow. |
| `exitNodeId`                    | Optional completed Exit node filter. Requires a workflow source scope and a completed-only selection. The ID must be an Exit in the source workflow's latest published version.                                                                                             |
| `waitForQuiescence`             | Defaults to `false`. Valid only when all selected events are terminal, meaning `completed`, `failed`, or `cancelled`.                                                                                                                                                       |
| `maxTriggerDepth`               | Integer from 1 through 20, default 2. Suppresses another trigger start when the source causal chain reaches this depth.                                                                                                                                                     |
| `pauseAfterConsecutiveFailures` | Optional integer from 1 through 10,000. Failed starts and failed handler runs count toward automatic pause. A successful handler resets the count. `null` disables automatic pause.                                                                                         |

Only future transitions observed while a trigger is enabled create deliveries. Enabling does not replay historical events. A `needs_attention` event means a run has entered the existing actionable attention state. Repeated reads do not create events. A `stalled` event follows the existing [stall detector](timers.md#stall-detection-and-active-attempt-deadlines), which preserves run status.

## Event input and causal chains

The event object contains `eventId`, `type`, `occurredAt`, `runId`, `workflowId`, and `version`. It includes source `tags`, `externalTask`, `stage`, `waiting`, a failing node reference, and an error summary when available. Text is bounded. Workflow inputs, outputs, claim tokens, and full event history are excluded.

The resulting run stores a `triggerChain` of trigger IDs. Child runs, detached descendants, and continued runs inherit that chain. A trigger already in the chain never fires again. Both repeated triggers and depth overflow produce a visible suppressed delivery. Durable `(eventId, triggerId)` receipts prevent repeated effects after restart or delivery-log trimming.

Optional `config.tags` labels handler runs with the [ordinary tag bounds](idempotent-run-starts.md#tag-and-filter-runs). Handlers use those configured tags rather than inheriting the source run's tags. Source tags remain in the event input.

Handler runs use ordinary idempotent starts and admission. A capacity limit can queue a handler. The latest published handler version is captured at dispatch. Library and target workflow pause holds defer pending deliveries. Automatic failure pauses also defer them. Disabling a trigger prevents pending dispatch, and deleting it removes its delivery state. Neither operation cancels handler runs already created.

## Quiescent teardown

A terminal parent can still have active detached descendants or uncertain external workers. With `waitForQuiescence: true`, a delivery waits until the source run tree has stopped, including child and continued runs, Scripts, managed executions, active claims, and uncertain ownership. Cancellation and lease expiry alone do not confirm that a worker stopped.

Inspect the source run briefing for bounded quiescence blockers. Stop and verify each owner before using its existing reconciliation operation. For connected Agent attempts, `manage_work_resources` with `action: "inspect"` and `workId` returns `uncertainClaims` even if the Agent declared no named resources. Uncertainty from an older attempt remains until that exact attempt is reconciled, even if a replacement is running. Its exact-attempt `release` requires `expectedAttempt`, `actor`, and `confirmStopped: true`. Interrupted Fetch steps and polling Fetch checks can also retain `uncertainOperations` without named resources. Inspect and release by exact `runId`, `executionId`, and `expectedAttempt` after confirming remote work stopped. Foreground Scripts interrupted by restart use exact-execution stop confirmation too. Managed sessions and background Scripts retain their existing stop and reconciliation operations.

A detached handler is independent of its source tree. Event triggering does not change ordinary run cancellation boundaries or terminate external processes. [Tree cancellation](workflow-execution.md#cancel-a-run-tree) can explicitly include detached descendants, but it preserves uncertain ownership and this full-tree quiescence gate. Logical cancellation alone never permits teardown. Cancellation lifecycle events commit with the selected run changes; normal handler dispatch can still follow those events.

## Inspection and portable bundles

Use `interlock triggers read '{"action":"list","kind":"event"}'` for compact discovery. Use `action: "inspect"` with one trigger ID for its configuration and delivery history. Reads default to 20 rows and accept at most 100, with exact totals and `nextOffset`. Inspection shows source/event identity, pending pause or quiescence, suppression reason, and handler run outcome. Started and queued describe admission, not successful completion.

Each trigger retains at most 200 settled delivery rows plus pending work. Dedupe receipts survive visible-log trimming. Event payloads and causal metadata retained for dispatch are not included in ordinary delivery history.

Portable format 8 includes event configuration and referenced source workflows. Every included trigger imports disabled, including forced imports. Operational history, dedupe receipts, causal chains, and local runtime state do not transfer. Import resets the included event triggers' local delivery history and pending state. Existing schedule and webhook history remains. Inspect imported source references and explicitly enable the trigger after publication.
