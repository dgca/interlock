# Coordinate Agent access to shared resources

Use exclusive named resources when cooperating Agent assignments must share a mutable checkout, browser session, device or local service. Names are shared across one Interlock library. Separate worktrees can use different names and run in parallel.

## Declare the names on Agent nodes

Add fixed names in the Agent editor's **Execution → Exclusive resources** field, or set `resources` through existing workflow authoring tools:

```json
{
  "resources": [
    { "source": "literal", "value": "checkout:integration" },
    { "source": "runInput", "path": "browserResource" }
  ]
}
```

Use the existing value-binding vocabulary: `literal`, `input`, `runInput`, `rootInput`, `itemInput` or `node`. The advanced editor preserves these bindings. `input` reads the Agent's resolved input after input bindings; other sources retain their usual scope. Bindings resolve once when the assignment is created, without replacing task input. Missing sources, non-string names and duplicate resolved names fail before work is made available. Publication rejects invalid literal names and invalid binding scopes; incomplete drafts remain saveable.

Require at most eight names per assignment. Each name trims surrounding whitespace, is case-sensitive, and contains 1–120 characters without control characters. Use non-secret symbolic names. Keep the mapping from a name to a checkout, account or device in the local executor's configuration or instructions, rather than putting credentials or machine paths in portable definitions. Resource declarations survive workflow export; current reservations do not.

Declare the same name on every cooperating Agent assignment that uses the same mutable resource. A worker ID or session does not make ownership reentrant: another assignment from the same worker must wait too. Use isolated resources when parallel work is possible.

## Use the ordinary claim loop

Discover work, claim it, renew before expiry, and submit its result through the existing tools. Claiming atomically reserves all required names together with the work attempt and budget usage. A conflict grants nothing, reserves no subset, and consumes no attempt or budget. Reservations use deterministic name ordering; admission is first successful claim, with no FIFO or starvation guarantee.

Read `resources` and `executionInstructions` in the returned assignment. Stop using its resources and stop any associated subprocesses before submitting success or reporting cooperative failure. Accepted results and valid `fail_work` calls release reservations. Result validation errors retain the active claim and reservations. Identical accepted submissions and stale tokens cannot release a later owner's resources. Renewal keeps the same ownership.

Use `get_run_briefing` when discovery returns no work. `resourceBlocked` lists blocked assignments and the name, owning run/work ID, exact attempt and state for each conflict. These assignments are omitted from available work and compact `nextWork`. Normal contention uses `next:wait_for_change`; owner changes wake affected continuation readers. Resource blocking pauses the unclaimed deadline, including when combined with budget blocking or an external hold.

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

The release is atomic and applies only to the specified work ID and attempt. It rejects active reservations. Repeating it after release is harmless and cannot release a replacement owner's reservation. The confirmation is a declaration by the caller, not proof or process fencing. Inspection is read-only and excludes claim tokens and internal hashes. Briefing lists remain bounded by their existing limit.

Uncertain reservations remain visible from their owning run even after it fails or is cancelled. Reconcile reservations before deleting the owning history. Ordinary server restart preserves active, unexpired ownership and converts ended or expired claims conservatively. Full database backups carry reservations; portable workflow bundles do not. Do not discard reservation records or downgrade to a server that ignores them while workers can still be active.

For CLI callers, pass the inner request as JSON or `@file`:

```sh
interlock work-resources '{"action":"inspect","workId":"OLD_WORK_ID"}'
interlock work-resources '{"action":"release","workId":"OLD_WORK_ID","expectedAttempt":1,"actor":"factory-coordinator","confirmStopped":true}'
```

Shared API callers use `work.resources` with the same inner request.

## Keep other writers coordinated

These reservations cover cooperating Agent claims in one local library. They do not protect against Script/Fetch nodes, unmanaged processes, other libraries or external API clients. They do not terminate a worker, provide OS isolation, or guarantee exactly-once side effects. Use isolated workspaces and external enforcement where those are required. Native Script and Fetch behavior is unchanged.
