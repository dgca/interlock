# Pause library or workflow execution

Use **Pause library** in the persistent header or **Pause workflow** beside the workflow actions. Supply an actor label and reason. Every action creates an independent persisted hold. Open **Review holds** to inspect scope, actor, reason, creation time, and exact ID. **Release hold** releases only that record. Execution can resume when no applicable records remain.

Acknowledged creation closes and clears its form before status refresh. If refresh fails, **Retry refresh** reads the current holds without repeating the write. **Add another pause** deliberately starts a new blank form. A failed creation request preserves entered values.

A library hold applies to every workflow. A workflow hold applies to runs with that workflow ID, including Batch items. It does not propagate to an invoked workflow with a different ID. Already dispatched child work keeps its own scope. Actor labels describe the caller; they do not authenticate identity or restrict who can release a hold.

## Pause and release through CLI, MCP, or API

Create one library hold:

```sh
interlock pause '{"target":{"scope":"library"},"actor":"deploy-bot","reason":"Deployment in progress"}'
```

For one workflow, use `"target":{"scope":"workflow","workflowId":"WORKFLOW_ID"}`. Actor and reason are trimmed and required, with limits of 200 and 1000 characters. The returned record contains `id`, `scope`, optional `workflowId`, `actor`, `reason`, and server `createdAt`. Save its ID, then release that exact record after resolving your blocker:

```sh
interlock pause-holds '{"workflowId":"WORKFLOW_ID","limit":20}'
interlock resume HOLD_ID
```

`pause-holds` without a workflow ID lists library holds. With a workflow ID it lists applicable library and workflow records. Optional `scope` filters to `library` or `workflow`; the latter requires `workflowId`. Pagination uses `offset`, `limit` from 1 through 100, default 20, exact `total`, and `nextOffset`. Reads do not advance execution. Releasing an already released retained ID returns `applied:false`. Unknown IDs reject and never select another record. Creation deliberately creates a new record on every call, so retain each response and inspect after uncertain delivery.

MCP `manage_pause` accepts `request` with `action:"pause"` plus the creation fields, `action:"list"` plus list fields, or `action:"resume",id:"HOLD_ID"`. Shared API operations are `pauses.pause`, `pauses.list`, and `pauses.resume`. Resume returns `applied` and the retained hold with `releasedAt`. Records and released intervals persist locally and are excluded from portable workflow bundles.

## Execution and clocks while paused

Pauses block new claims and managed launches, the next step, Script/Fetch launches, polling checks, Wait advancement, and external-input acceptance. In-flight Agent, Script, Fetch, and polling operations may finish. A running polling check keeps its engine actor until settlement, including in waited-parent projections. The next boundary stays blocked. Manual starts may allocate a run whose first step waits for resume. Reads, editing, inspection, cancellation, and cleanup remain available. Input submissions and revisions remain accepted; releasing a pause does not accept pending input.

Blocked runs expose `waiting.kind:"pause"`, person actor, stable `since`, exact `detail.pauseCount`, and bounded reasons. Use the paginated hold operation for all records. An actively finishing step keeps its stage and actor. Work discovery and briefings omit paused assignments from available work. Inspection keeps their `pauseBlocked` metadata visible.

Unclaimed Agent timeout clocks suspend while paused, including overlap with other admission blockers. Wait and polling deadlines retain wall-clock meaning. An overdue wait advances after the pause clears. Existing claim leases still require renewal, and in-flight native operation timeouts continue to bound the running operation. Pause does not stop a process.

Runtime `PauseHolds.elapsed` and core `elapsedExcludingPausesMs` subtract the union of applicable persisted intervals, clipped to the queried period. Attempt usage groups expose `wallMs`, `pausedMs`, and `activeMs`, or null for legacy unknown claim times. Active time excludes declared pauses; it is not a measurement of model activity. Future retry windows, stall thresholds, and total Agent execution deadlines must use this calculation. Those features are not implemented here.

Recurring schedules evaluate these holds before firing and queued promotion. Deferred slots follow their missed-fire policy after all applicable holds clear. Re-enabling a schedule does not release a named hold. See [workflow schedules](schedules.md). Inbound webhooks and `interlock doctor` remain future capabilities.

---

## Hold Agent work for external blockers

Use an assignment hold when a provider limit or unavailable service prevents unfinished work from continuing. A hold records the blocker and a checkpoint reference, invalidates the current claim, and leaves upstream results intact. Other assignments keep their existing behavior.

Stop the executor's external activity before holding it. Interlock coordinates claims; it cannot suspend an external process or undo its side effects. Keep credentials and provider error dumps out of reasons and checkpoint references.

### Hold the current assignment

Read the assignment from a claim or full run inspection. Supply its current `attempt` and `holdRevision`, using zero if no hold revision exists:

```json
{
  "action": "hold",
  "workId": "WORK_ID",
  "expectedAttempt": 1,
  "expectedRevision": 0,
  "actor": "coordinator",
  "category": "provider_limit",
  "reason": "Provider allowance is temporarily unavailable.",
  "checkpointRef": "artifacts/checkpoint-1.json"
}
```

Pass this as `request` to MCP `manage_work_hold`, directly to API `work.hold`, or save it as `hold.json` for the CLI:

```sh
interlock work-hold @hold.json
```

Categories are `provider_limit`, `service_unavailable`, `credentials`, and `other`. Reasons contain 1–1000 characters, checkpoint references 1–2048, and actors 1–200, after trimming. The checkpoint is a reference supplied by the executor; Interlock does not read or restore it. An optional `token` validates a cooperative worker's live claim. The local coordinator may omit it, as with existing cancellation and budget controls. The actor is a declaration, not authenticated identity.

Mutations return `applied`, `workId`, `runId`, `status`, `attempt`, and `holdRevision`, without assignment contents or credentials. Stale attempts or revisions reject. Repeating the latest exact normalized change is a no-op with `applied:false`. Intervening hold/resume changes conflict; inspect rather than repeating an uncertain operation with new preconditions. Terminal work cannot be resumed.

### Resume after resolving the blocker

Managed model-refusal holds use **Choose a model** in the run inspector or `manage_executors` action `retry_model` with an explicit human-selected model. Generic resume cannot bypass that selection. See [Replace a refused model](managed-executors.md#replace-a-refused-model).

Use the current hold revision and attempt:

```json
{
  "action": "resume",
  "workId": "WORK_ID",
  "expectedAttempt": 1,
  "expectedRevision": 1,
  "actor": "coordinator"
}
```

The same MCP tool, API operation, or CLI command accepts this request. The run inspector also offers **Resume assignment**. Resumption makes work available; it does not claim it or replay external actions. Inspect the checkpoint and side effects, then claim with the required context and capabilities. Old tokens cannot renew, fail, or submit. Grouped work still requires its bound session or an explicit context handoff.

Holding claimed work ends that usage attempt as `held`. Successful claim counts remain monotonic and still count toward run budgets. A hold does not spend the Agent's failure or lease-expiry allowance. Optional `heldClaimCount` identifies released claims when interpreting the legacy combined allowance. A new claim can therefore have an attempt number above `maxAttempts` without exhausting recovery.

Available work retains its remaining unclaimed timeout while held. Claimed work resumes with a full unclaimed interval. Budget gates remain in force and can keep the interval suspended after resumption. Elapsed deadlines win at equality, including a deadline crossing after the engine's initial check. Holds and intervals survive restart. Cancelling a run closes affected holds; detached descendants keep their independent lifetime.

### Inspect blockers and history

`list_work` omits held work. Existing briefings show compact held references and the `external_hold` blocker. `next:inspect_hold` calls for inspection and explicit resolution; compact mutation responses include `heldWork` when needed. Full run inspection includes blocker details and the twenty most recent intervals per affected assignment.

Managed `needs_model` holds instead use `next:inspect_executor` to select a replacement. Their native process cleanup is confirmed before the hold is exposed, and the coordinator releases their resource reservations.

Read older intervals through the same tool:

```json
{ "action": "history", "workId": "WORK_ID", "offset": 0, "limit": 20 }
```

History reads do not pump timers, renew claims, or write state. Limits default to 20, range from 1 through 100, and offsets range from 0 through 1,000,000. `items`, `total`, and `nextOffset` support pagination. Intervals record server `heldAt`, optional `endedAt`, actors, category, reason, checkpoint reference, assignment attempt, and hold revision. End reasons distinguish `resumed` and `cancelled`.

`wallMs`, `declaredHeldMs`, and `elapsedExcludingHoldsMs` describe the assignment since it became available, including a current hold. They do not measure actual model active time or change historical benchmark timings. Terminal assignments stop accumulating elapsed time. Workflow deletion removes associated intervals; portable workflow bundles exclude run and hold state. Holds use additive document records and optional fields without a database schema migration.
