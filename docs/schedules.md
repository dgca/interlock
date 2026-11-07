# Schedule workflows

Open a workflow's **Triggers** tab, select **Add schedule**, and enter a name and timing. Create the schedule disabled, inspect it, then enable the exact schedule. Schedule changes apply independently of workflow draft save and publication. Fires target the latest retained published version. Unpublished or archived workflows cannot enable schedules.

Intervals accept whole milliseconds from 30000 through 31536000000. Creation and timing changes anchor interval slots. Cron requires exactly five fields, minute, hour, day of month, month, and weekday, plus an IANA time zone. The shared cron-parser calculation handles daylight saving transitions. Macros, seconds fields and hashed jitter are rejected. Restricted day-of-month and weekday fields use the parser's OR semantics. Preview shows three calculated times for current settings; inspection shows the persisted next slot.

## Choose run policies

`overlapPolicy` defaults to `skip`, which suppresses a fire while any run from the trigger is queued, running or waiting. `queue` accepts at most one pending run, waiting for prior runs from the trigger to end regardless of success. Public `after` dependencies still require success and are a separate admission gate. `allow` accepts additional starts subject to workflow capacity and named holds. Disabling or deleting a schedule preserves existing active and queued runs.

`missedFirePolicy` defaults to `skip`. A due slot more than five seconds late, or a slot deferred by a named pause, is missed. Skip advances to the next future slot. `run_once` attempts the latest overdue slot once, then advances to the future. There is no catch-up burst after sleep or downtime. Re-enabling skip advances overdue slots; re-enabling run_once can attempt work on the next engine tick. Changing timing resets the anchor and discards old due slots.

Library and workflow named holds block fires and queued promotion. Re-enabling an automatically paused schedule clears only its automatic pause and resets its failure count. It never releases named holds. Release only the exact hold you own through the existing pause controls.

## Bind run input

`config.input` is literal JSON, limited to 64 KiB. Optional `config.bindings` maps `scheduledAt`, `firedAt`, `triggerId` and `previousRunId` to explicit dot-separated object paths. Bound values replace template values. Bindings require an object input and distinct, non-overlapping paths without prototype keys. `previousRunId` is null before the first accepted run, then identifies the previous accepted run from this trigger.

Each fire commits its captured input, published version, run receipt, outcome and next slot atomically. Its RunStarts request ID is `schedule:<triggerId>:<slotIso>`. Restart or competing fire attempts cannot start another run for the same slot. This start guarantee does not make multiple competing server processes supported for other engine execution.

## Inspect and recover

Inspection shows last fire, next slot, failure count, applicable holds, fire lag and recent outcomes. Queued outcomes retain acceptance time and eventual admission time. Lag measures scheduled slot to actual admission, including queued waiting. At 60 seconds or more, an enabled schedule creates an independent **Needs attention** item. Lag does not disable the schedule; a later on-time accepted fire clears measured lag.

By default, failed runs never pause a schedule. Optional `pauseAfterConsecutiveFailures` accepts a positive whole number up to 10000. Failed admissions and failed scheduled runs increment the counter once. Completed scheduled runs reset it. Cancellations and policy skips are neutral. Terminal runs are observed once in fire order within a scheduler tick. Automatic pause has a visible reason and its own attention item, including failures that created no run row.

Fire inspection retains up to 200 settled outcomes plus pending runs. Pages default to 20 and cap at 100. Deleted run history displays as unavailable while the fire remains inspectable. Deleting a schedule removes its configuration and fire history, preserving existing runs and RunStarts tombstones.

Portable format 5 exports configuration with `enabled:false`, without operational history. Import always disables included schedules, including identical and forced reimports. Each included schedule revision advances; its next slot and interval anchor reset at import time, and automatic pause, consecutive failures and last measured lag clear. Existing local fire history, prior-run links and runs remain. Schedules absent from the bundle are unchanged. Existing differing schedule configuration requires explicit `force`; identities cannot move to another workflow. Older bundle formats remain supported. Explicitly inspect and enable schedules after import.

## Use the CLI and MCP

Read operations are `list`, `inspect`, `preview`, and `attention`. Writes are `create`, `update`, `enable`, `disable`, and `delete`. Writes other than create require the current `expectedRevision` from inspection. Update replaces the complete configuration. After a revision conflict, keep edits and inspect before reconciling.

```sh
interlock triggers read '{"action":"list","workflowId":"WORKFLOW_ID"}'
interlock triggers manage '{"action":"create","workflowId":"WORKFLOW_ID","config":{"name":"Heartbeat","timing":{"type":"interval","intervalMs":120000},"input":{},"overlapPolicy":"skip","missedFirePolicy":"skip"}}'
interlock triggers read '{"action":"inspect","id":"TRIGGER_ID"}'
interlock triggers manage '{"action":"enable","id":"TRIGGER_ID","expectedRevision":1}'
interlock triggers read '{"action":"preview","timing":{"type":"cron","expression":"0 9 * * 1-5","timeZone":"America/Denver"}}'
```

`interlock schedules` remains an alias. The same JSON requests work with MCP `read_workflow_triggers` and `manage_workflow_triggers` inside `request`. Shared API callers use `triggers.read` and `triggers.manage`; typed UI reads also expose `list`, `inspect`, `preview`, and `attention`. No tool runs a fire immediately outside its schedule. The same trigger API supports [authenticated webhooks](webhooks.md); use list `kind:"schedule"` to select schedule records.
