# Coordinate access to shared resources

Use exclusive named resources when cooperating Agent assignments, Scripts, Fetch requests, or polling checks must share a mutable checkout, browser session, device or local service. Names are shared across one Interlock library. Separate worktrees can use different names and run in parallel.

## Declare resource names

Add fixed names in the Agent editor's **Execution → Exclusive resources** field, or set `resources` on Agent, Script, Fetch, or polling Wait nodes through Raw or workflow authoring tools:

```json
{
  "resources": [
    { "source": "literal", "value": "checkout:integration" },
    { "source": "runInput", "path": "browserResource" }
  ]
}
```

Use the existing value-binding vocabulary: `literal`, `input`, `runInput`, `rootInput`, `itemInput`, `node`, or `execution`. The advanced editor preserves these bindings. `input` reads the step's resolved input after input bindings; other sources retain their usual scope. Bindings resolve once when the assignment or deterministic execution is created, without replacing task input. For a node binding with no completed output, set `sourceDefault` to a resource name. A missing source without a fallback, a non-string name, or a duplicate name fails before work becomes available or an operation launches. See [binding rules](node-data.md#build-step-input). Publication rejects invalid literal names and invalid binding scopes; incomplete drafts remain saveable.

Require at most eight names per assignment or deterministic step. Each name trims surrounding whitespace, is case-sensitive, and contains 1–120 characters without control characters. Use non-secret symbolic names. Keep the mapping from a name to a checkout, account or device in the local executor's configuration or instructions, rather than putting credentials or machine paths in portable definitions. Resource declarations survive workflow export; current reservations do not.

Declare the same name on every cooperating step that uses the same mutable resource. A worker ID or session does not make ownership reentrant: another assignment from the same worker must wait too. Use isolated resources when parallel work is possible.

## Use the ordinary claim loop

Discover work, claim it, renew before expiry, and submit its result through the existing tools. Claiming atomically reserves all required names together with the work attempt and budget usage. A conflict grants nothing, reserves no subset, and consumes no attempt or budget. Reservations use deterministic name ordering; admission is first successful claim, with no FIFO or starvation guarantee.

Read `resources` and `executionInstructions` in the returned assignment. Stop using its resources and stop any associated subprocesses before submitting success or reporting cooperative failure. Accepted results and valid `fail_work` calls release reservations. Result validation errors retain the active claim and reservations. Identical accepted submissions and stale tokens cannot release a later owner's resources. Renewal keeps the same ownership.

Use `get_run_briefing` when discovery returns no work. `resourceBlocked` lists blocked assignments or executions and each conflict's name, owning run ID, work ID or execution ID, exact attempt, and state. These assignments are omitted from available work and compact `nextWork`. Normal contention uses `next:wait_for_change`; owner changes wake affected continuation readers. Resource blocking pauses the unclaimed deadline, including when combined with budget blocking or an external hold.

## Reserve resources for deterministic operations

Script and Fetch steps reserve their complete set before launching. Their execution timeouts start after admission. Polling Waits reserve the set for each check and release it between checks. A queued check spends neither its probe timeout nor the polling Wait timeout. Other polling time retains its existing deadline behavior. Duration and timestamp Waits cannot declare resources.

A blocked execution exposes `resources` and `resourceBlocked` in run inspection. Run summaries report `waiting.kind: "resource"`; briefing blockers and `resourceBlocked` identify its `runId` and `executionId`. Ordinary contention has actor `engine`; uncertain ownership requires a stop declaration and uses `person`. No Agent assignment is created for a deterministic operation.

Returned results and known operation failures release that exact execution attempt. A server interruption, cancellation, or unconfirmed stop retains uncertain ownership. Foreground Script and Fetch operations never replay automatically. An interrupted polling check cannot repeat until its old ownership is reconciled. A background Script keeps its reservation while its authenticated supervisor is recovered, then releases after its verified outcome. See [background Script recovery](architecture.md#scripts-and-interruptions).

A resource-protected Fetch whose dispatched request times out, loses its connection, or ends before the complete response is read retains uncertain ownership. The remote operation can continue after the client stops observing it. The ordinary Fetch fails terminally even with a Failed route configured. A polling Fetch records the error and waits on its uncertain resources, suspending its remaining Wait deadline instead of repeating the request. Confirm that the remote operation stopped before releasing its exact reservation; a client abort or a closed connection is insufficient. Fully observed HTTP errors and invalid JSON responses release resources normally, as do failures known to occur before request dispatch. Fetch operations without resource declarations retain their existing failure-routing and polling behavior.

## Reconcile an uncertain stop

Expiry, cancellation and a hold on claimed work invalidate the claim but do not prove the worker stopped. Interlock keeps its names reserved in `uncertain` state. This persists across restart and blocks both a replacement attempt and unrelated assignments requiring those names. Detached workers retain their normal independent lifetime when a parent is cancelled.

For recognized early managed model refusals, Interlock confirms native cleanup and releases the attempt's reservations automatically. Those assignments wait for [model selection](managed-executors.md#replace-a-refused-model), without requiring stop confirmation.

1. Inspect `resourceBlocked` and `resourceReservations` in the briefing, or call `manage_work_resources` with:

   ```json
   { "request": { "action": "inspect", "workId": "OLD_WORK_ID" } }
   ```

2. Stop the exact old attempt and its subprocesses, or obtain confirmation from the executor that they have stopped using every reserved resource. If it still has an active claim, hold or cancel it first. A deadline or cancellation response alone is insufficient.

3. Release that attempt's uncertain reservations:

   ```json
   {
     "request": {
       "action": "release",
       "workId": "OLD_WORK_ID",
       "expectedAttempt": 1,
       "actor": "factory-coordinator",
       "confirmStopped": true
     }
   }
   ```

4. Rediscover work and obtain a fresh claim. Resume held work separately or explicitly retry a failed step if needed. Release does not resume a run or grant a claim.

For a deterministic owner, inspect using `runId` and `executionId` instead of `workId`, then release its exact `resourceAttempt` from run inspection:

```json
{
  "request": {
    "action": "release",
    "runId": "OWNER_RUN_ID",
    "executionId": "OWNER_EXECUTION_ID",
    "expectedAttempt": 1,
    "actor": "factory-coordinator",
    "confirmStopped": true
  }
}
```

The inspection request is `{ "request": { "action": "inspect", "runId": "OWNER_RUN_ID", "executionId": "OWNER_EXECUTION_ID" } }`. Active operations reject manual release. Cancel or stop the owner and verify its processes and resource use first. For an uncertain background Script, `manage_script` stopped reconciliation also releases its matching reservations.

The release is atomic and applies only to the specified owner and attempt. It rejects active reservations. Repeating it after release is harmless and cannot release a replacement owner's reservation. The confirmation is a declaration by the caller, not proof or process fencing. Inspection is read-only and excludes claim tokens and internal hashes. Briefing lists remain bounded by their existing limit.

Revoked Agent attempts also retain `uncertainClaims`, including Agents without named resources. Inspect by `workId` and confirm the exact attempt stopped through the same `release` operation. Interrupted Fetch steps and polling Fetch checks retain `uncertainOperations` even without named resources. A foreground Script interrupted by server restart also retains an uncertain operation until its processes are confirmed stopped. Inspect and release the exact execution attempt through the same operation after verifying remote termination. These records block [quiescent event teardown](events.md#quiescent-teardown) until reconciliation.

Uncertain reservations remain visible from their owning run even after it fails or is cancelled. Reconcile reservations before deleting the owning history. Ordinary server restart preserves active, unexpired ownership and converts ended or expired claims conservatively. Full database backups carry reservations; portable workflow bundles do not. Do not discard reservation records or downgrade to a server that ignores them while workers can still be active.

For CLI callers, pass the inner request as JSON or `@file`:

```sh
interlock work-resources '{"action":"inspect","workId":"OLD_WORK_ID"}'
interlock work-resources '{"action":"release","workId":"OLD_WORK_ID","expectedAttempt":1,"actor":"factory-coordinator","confirmStopped":true}'
```

Shared API callers use `work.resources` with the same inner request.

## Keep other writers coordinated

These reservations cover cooperating Agent claims and declared deterministic operations in one local library. They do not protect against undeclared operations, unmanaged processes, other libraries, or external API clients. They do not terminate a worker, provide OS isolation, or guarantee exactly-once side effects. Use isolated workspaces and external enforcement where those are required.
