# Hold Agent work for external blockers

Use an assignment hold when a provider limit or unavailable service prevents unfinished work from continuing. A hold records the blocker and a checkpoint reference, invalidates the current claim, and leaves upstream results intact. Other assignments keep their existing behavior.

Stop the executor's external activity before holding it. Interlock coordinates claims; it cannot suspend an external process or undo its side effects. Keep credentials and provider error dumps out of reasons and checkpoint references.

## Hold the current assignment

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

## Resume after resolving the blocker

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

## Inspect blockers and history

`list_work` omits held work. Existing briefings show compact held references and the `external_hold` blocker. `next:inspect_hold` calls for inspection and explicit resolution; compact mutation responses include `heldWork` when needed. Full run inspection includes blocker details and the twenty most recent intervals per affected assignment.

Read older intervals through the same tool:

```json
{ "action": "history", "workId": "WORK_ID", "offset": 0, "limit": 20 }
```

History reads do not pump timers, renew claims, or write state. Limits default to 20, range from 1 through 100, and offsets range from 0 through 1,000,000. `items`, `total`, and `nextOffset` support pagination. Intervals record server `heldAt`, optional `endedAt`, actors, category, reason, checkpoint reference, assignment attempt, and hold revision. End reasons distinguish `resumed` and `cancelled`.

`wallMs`, `declaredHeldMs`, and `elapsedExcludingHoldsMs` describe the assignment since it became available, including a current hold. They do not measure actual model active time or change historical benchmark timings. Terminal assignments stop accumulating elapsed time. Workflow deletion removes associated intervals; portable workflow bundles exclude run and hold state. Holds use additive document records and optional fields without a database schema migration.
