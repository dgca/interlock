# Schedule workflows

Open **Automations** in the sidebar, choose **New automation → Schedule**, and enter a name and timing. Select the workflow to start and fill in its input fields. **Enable when created** defaults off. Choose **Create** to save with the selected enabled state and open the saved automation directly. Schedule changes apply independently of workflow draft save and publication. Fires target the latest retained published version. Unpublished or archived workflows cannot enable schedules.

Intervals accept whole milliseconds from 30000 through 31536000000. Creation and timing changes anchor interval slots. Cron requires exactly five fields, minute, hour, day of month, month, and weekday, plus an IANA time zone. The shared cron-parser calculation handles daylight saving transitions. Macros, seconds fields and hashed jitter are rejected. Restricted day-of-month and weekday fields use the parser's OR semantics. Preview shows three calculated times for current settings; inspection shows the persisted next slot.

## Choose run policies

`overlapPolicy` defaults to `skip`, which suppresses a fire while any run from the trigger is queued, running or waiting. `queue` accepts at most one pending run, waiting for prior runs from the trigger to end regardless of success. Public `after` dependencies still require success and are a separate admission gate. `allow` accepts additional starts subject to workflow capacity and named holds. Disabling or deleting a schedule preserves existing active and queued runs.

The UI creates schedules with `missedFirePolicy: "skip"` and leaves existing policies unchanged on edit. CLI and MCP also support `run_once`. `missedFirePolicy` defaults to `skip`. A due slot more than five seconds late, or a slot deferred by a named pause, is missed. Skip advances to the next future slot. `run_once` attempts the latest overdue slot once, then advances to the future. There is no catch-up burst after sleep or downtime. Re-enabling skip advances overdue slots; re-enabling run_once can attempt work on the next engine tick. Changing timing resets the anchor and discards old due slots.

Library and workflow named holds block fires and queued promotion. Re-enabling an automatically paused schedule clears only its automatic pause and resets its failure count. It never releases named holds. Release only the exact hold you own through workflow pause controls, CLI, or MCP.

## Bind run input

`config.input` is literal JSON, limited to 64 KiB. The UI uses the latest published input contract, or the current draft contract before first publication. Your inputs stay available while the contract refreshes or you retry a failed read. Saving waits for the current contract. Labels may use schema titles; saved JSON uses the exact property keys. Complex values use JSON entry. Existing metadata bindings remain unchanged on form edits. A binding to a top-level input makes that field read-only; nested bindings leave the containing JSON field editable so literal sibling values can be changed and validated. Optional `config.bindings` maps `scheduledAt`, `firedAt`, `triggerId` and `previousRunId` to explicit dot-separated object paths. Bound values replace template values. Bindings require an object input and distinct, non-overlapping paths without prototype keys. `previousRunId` is null before the first accepted run, then identifies the previous accepted run from this trigger.

Each fire commits its captured input, published version, run receipt, outcome and next slot atomically. Its RunStarts request ID is `schedule:<triggerId>:<slotIso>`. Restart or competing fire attempts cannot start another run for the same slot. This start guarantee does not make multiple competing server processes supported for other engine execution.

Optional `config.tags` captures static run tags on every accepted fire, with the [ordinary 16-pair and 64-character bounds](idempotent-run-starts.md#tag-and-filter-runs). Updating tags affects future runs. Existing runs keep their capture. Tags transfer with trigger configuration.

## Inspect and recover

Inspection shows last fire, next slot, failure count, applicable holds, fire lag and recent outcomes. Queued outcomes retain acceptance time and eventual admission time. Lag measures scheduled slot to actual admission, including queued waiting. At 60 seconds or more, an enabled schedule creates an independent **Needs attention** item. Lag does not disable the schedule; a later on-time accepted fire clears measured lag.

By default, failed runs never pause a schedule. Optional `pauseAfterConsecutiveFailures` accepts a positive whole number up to 10000. Failed admissions and failed scheduled runs increment the counter once. Completed scheduled runs reset it. Cancellations and policy skips are neutral. Terminal runs are observed once in fire order within a scheduler tick. Automatic pause has a visible reason and its own attention item, including failures that created no run row.

Fire inspection retains up to 200 settled outcomes plus pending runs. Pages default to 20 and cap at 100. Deleted run history displays as unavailable while the fire remains inspectable. Deleting a schedule removes its configuration and fire history, preserving existing runs and RunStarts tombstones.

Portable format 5 exports configuration with `enabled:false`, without operational history. Import always disables included schedules, including identical and forced reimports. Each included schedule revision advances; its next slot and interval anchor reset at import time, and automatic pause, consecutive failures and last measured lag clear. Existing local fire history, prior-run links and runs remain. Schedules absent from the bundle are unchanged. Existing differing schedule configuration requires explicit `force`; identities cannot move to another workflow. Older bundle formats remain supported. Explicitly inspect and enable schedules after import.

## Use the CLI and MCP

Read operations are `list`, `inspect`, `preview`, and `attention`. Writes are `create`, `update`, `enable`, `disable`, and `delete`. Create defaults to `enabled:false`. Optional create-only `enabled:true` performs enablement validation in the same transaction. If it fails, no trigger is created. Imports remain disabled regardless of this option. List accepts optional `workflowId`, `kind`, case-insensitive `search` over automation and workflow names, and `status` of `all`, `enabled`, `disabled`, or `attention`. Search is trimmed and capped at 200 characters. Filters apply before pagination. `counts` covers the workflow/kind/search scope before status filtering. Enabled excludes automatic pauses; attention includes enabled automatic pauses and excessive schedule lag. Compact rows include `actionType` and `lastActivity` with time, outcome, and optional run identity/status, without input or delivery payloads.

Writes other than create require the current `expectedRevision` from inspection. Update replaces the complete configuration. After a revision conflict, keep edits and inspect before reconciling.

```sh
interlock triggers read '{"action":"list","workflowId":"WORKFLOW_ID"}'
interlock triggers manage '{"action":"create","workflowId":"WORKFLOW_ID","config":{"name":"Heartbeat","timing":{"type":"interval","intervalMs":120000},"input":{},"tags":{"repo":"dgca/interlock"},"overlapPolicy":"skip","missedFirePolicy":"skip"}}'
interlock triggers read '{"action":"inspect","id":"TRIGGER_ID"}'
interlock triggers manage '{"action":"enable","id":"TRIGGER_ID","expectedRevision":1}'
interlock triggers read '{"action":"preview","timing":{"type":"cron","expression":"0 9 * * 1-5","timeZone":"America/Denver"}}'
```

`interlock schedules` remains an alias. The same JSON requests work with MCP `read_workflow_triggers` and `manage_workflow_triggers` inside `request`. Shared API callers use `triggers.read` and `triggers.manage`; typed UI reads also expose `list`, `inspect`, `preview`, and `attention`. No tool runs a fire immediately outside its schedule. The same trigger API supports [lifecycle events](events.md); use list `kind:"schedule"` to select schedule records.
