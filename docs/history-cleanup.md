# Clean up run history

Remove selected run trees without deleting their workflows or published versions. Cleanup is permanent. You can select trees manually or enable an automatic retention policy. It removes run values, executions, assignments, events, usage attempts, budgets, holds, context history, and settled managed execution/session records. It does not delete local harness profiles, native harness session files, backups or trial files.

## Use the browser

1. Open **Runs → History**, or the **History** tab in a workflow's Runs section.
2. Choose **Clean up history**.
3. Select a root workflow or a **Last updated before** cutoff, then choose **Preview history**. A cutoff includes a tree only when every run in it was last updated before that time.
4. Review the run counts, JSON data sizes, and protection reasons. Select eligible trees. Use **Next** to inspect another page; changing pages or filters clears the selection.
5. Acknowledge permanent history loss, then choose **Delete selected history**.
6. Read the deletion result and storage figures before closing the dialog.

Filters match root workflows. A child invocation cannot be removed independently of its parent tree, even when it uses another workflow. Detached descendants remain part of the cleanup tree. Rollover chains and their descendants are removed together, starting from the first chain member.

## Use the CLI or MCP

1. Preview candidates with the CLI:

   ```sh
   interlock run-history '{"action":"preview","workflowId":"WORKFLOW_ID","before":"2026-01-01T00:00:00Z","limit":20}'
   ```

   Replace `WORKFLOW_ID` with the root workflow ID. Omit `workflowId` or `before` to omit that filter. Use `offset` and `limit` to page through the exact `total`. Limits default to 20 and cap at 100. MCP exposes the same operation as `manage_run_history` with this object inside `request`.

2. Review each selected item's `rootRunId`, `runCount`, `collections`, `documentBytes`, `blockers`, and `canDelete`. Save any backup you need before deleting.
3. Copy each eligible root's confirmation into an explicit deletion request:

   ```sh
   interlock run-history '{"action":"delete","roots":[{"runId":"ROOT_RUN_ID","confirmation":"HASH_FROM_PREVIEW"}],"acknowledgeHistoryLoss":true}'
   ```

   Replace both placeholders with the reviewed root ID and its 64-character confirmation. One request accepts at most 100 unique roots. MCP uses `manage_run_history` with the same object inside `request`. Shared API callers use `runs.previewHistoryDeletion` and `runs.deleteHistory`.

4. If history or protections changed, preview again and review the new impact. Deletion rechecks every selected tree in one transaction and rejects the entire request on a stale confirmation or blocker. A lost response leaves the outcome uncertain; inspect the selected roots before trying again.

## Resolve protected history

Finish or cancel active runs and descendants before cleanup. [Tree cancellation](workflow-execution.md#cancel-a-run-tree) can explicitly include detached descendants in one operation. Wait for native operations to close after cancellation. Whole trees and chains retain the history needed by active budget scopes. Queued admission dependencies keep their prerequisite history until promotion or cancellation.

Reconcile resource reservations only after their workers stop. Uncertain reservations remain protected after cancellation or expiry. See [resource recovery](work-resources.md).

Managed Agent executions also block cleanup while active or interrupted, even if their run is cancelled. Stop the old harness and subprocesses, then reconcile that exact execution. Cleanup shares the existing managed deletion guard and removes settled attempts and run-local sessions with the tree. See [managed execution recovery](managed-executors.md#stop-and-recover).

Retained comparison sample trees and referenced evaluation runs are protected, including completed experiments. This first version does not cascade through comparison evidence. Incomplete ancestry or chain history also blocks cleanup.

Minimal start-request receipts survive as deleted tombstones. Repeating an old request ID rejects rather than creating replacement work. A deliberate new attempt uses a new request ID. See [start recovery](idempotent-run-starts.md).

## Interpret storage results

`documentBytes` and `removedDocumentBytes` measure stored JSON in UTF-8 bytes. They exclude indexes, SQLite overhead, retained start receipts, backups, and trial files. They are not estimates of reclaimed file space.

`storage.databaseBytes` reports SQLite's allocated pages. `storage.reusableBytes` reports whole free pages available for reuse; partially empty pages can contain additional reusable space. Deletion usually leaves the database file allocated so subsequent writes can reuse it. Offline SQLite `VACUUM` can return unused space to the filesystem, but requires maintenance time and spare disk space. Stop Interlock and preserve a backup before external database maintenance. See [SQLite compaction](https://www.sqlite.org/lang_vacuum.html).

Neither manual cleanup nor automatic retention runs compaction.

## Enable automatic retention

Library retention is disabled by default. Open **Harnesses → History retention**, choose **Enabled**, enter an age or count limit, and save. Workflow **Runs → History → Retention settings** offers **Inherit library policy**, **Disabled**, or **Override library policy**. Saving an enabled policy authorizes permanent scheduled deletion. Settings apply immediately without publishing a workflow. These local settings stay outside portable exports and imports.

A workflow override replaces the entire library policy. Disabling an override protects that workflow from library retention. Returning to inheritance removes the override. Scope follows the root workflow, including all invoked children regardless of their own settings. Archived workflows retain their policy and remain eligible for cleanup.

The library count pool contains all completed trees whose root workflows inherit the library policy. Each enabled workflow override has its own count pool. A completed tree has only terminal runs, including failed and cancelled runs. Active trees do not count. A detached descendant or rollover successor keeps its entire tree active until it ends.

`maxAgeDays` accepts whole days from 1 through 36500. A tree expires only when every member was last updated before the cutoff. `maxCompletedRuns` accepts 0 through 1000000 and counts whole trees, newest first by the most recent member update, then root ID. Zero retains no unprotected completed trees. If both limits are set, exceeding either limit selects a tree. Protected completed trees still count toward the limit, but never cause deletion of an otherwise retained newest tree.

The existing engine pump runs an overdue sweep after startup and checks every hour. Saving a policy makes the next check due immediately. A sweep removes at most 100 eligible roots in one transaction; eligible backlog retries after one minute. Recent terminal trees have a one-minute observation window. Pending trigger outcomes and lifecycle sources stay protected until observed or dispatched. All manual cleanup protections apply, including uncertainty, comparison evidence, detached descendants and chains. Protected history can keep the stored total above the configured count.

Failed sweeps roll back the entire deletion and record a bounded error, then retry after one hour. If the database cannot store that error, the running engine retains the error and retry deadline in memory. Restart uses the persisted deadline and rechecks current policies and protections. Cleanup never stops workers, reconciles ownership, or deletes durable start, webhook, or lifecycle-trigger receipts. Scheduled cleanup removes historical reports and usage for deleted runs, just as manual cleanup does.

### Configure through CLI, MCP or API

Read the current scope revision before saving:

```sh
interlock run-history '{"action":"settings"}'
interlock run-history '{"action":"configure","expectedRevision":0,"policy":{"maxAgeDays":30,"maxCompletedRuns":1000}}'
interlock run-history '{"action":"settings","workflowId":"WORKFLOW_ID"}'
interlock run-history '{"action":"configure","workflowId":"WORKFLOW_ID","expectedRevision":0,"policy":null}'
interlock run-history '{"action":"status"}'
```

Use the returned `revision` as `expectedRevision`; stale saves reject without changing the policy. Set `policy:null` to disable a scope. Set `policy:"inherit"` on a workflow to remove its override. An enabled policy requires at least one threshold. Settings return `policy`, `effectivePolicy`, `inherited` and the scope revision. MCP uses the same requests inside `manage_run_history.request`; no new tool is needed. Shared API callers use `runs.retentionSettings`, `runs.configureRetention`, and `runs.retentionStatus`.

Status returns `nextCheckAt`, a bounded `lastError`, `lastSweep` counts and removed JSON bytes, the interval and batch limit, and SQLite allocated and reusable bytes. It contains no run inputs, outputs or candidate lists. Use manual preview for individual tree blockers. Reusable pages reduce future database growth; allocated file size can remain unchanged. Offline VACUUM remains a separate maintenance operation.
