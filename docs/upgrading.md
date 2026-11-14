---
title: Upgrading
description: Install a new Interlock version, understand database upgrades, and restore a backup.
---

# Upgrade Interlock

Upgrading installs a new package and lets Interlock upgrade its database on the next start. This page covers the install, what the database upgrade does, how to go back, and release changes that need action from you.

## Install an update

1. Stop the running Interlock server with Ctrl+C.
2. Record the installed version:

   ```sh
   interlock --version
   ```

3. Install the update:

   ```sh
   npm install -g @type_of/interlock@latest
   ```

4. Start `interlock` with the same `--db` and `--workdir` options as before.

Only one server can use a database at a time. A second server started on the same database exits with an error naming it.

### What happens on the first start

Interlock checks the database before it seeds a starter, resumes runs or accepts requests. If the schema needs an upgrade:

1. It writes a SQLite backup beside the database.
2. It applies all pending migrations in one transaction.
3. It prints the backup path.

If the backup or a migration fails, startup stops with an error. A failed migration rolls back its changes, and the error includes the backup path.

Schema upgrades are one-way. Interlock does not run reverse migrations, and a version that predates your schema refuses to open the database:

```text
Cannot open Interlock database /path/to/interlock.db. Database schema 22 is newer than this Interlock supports (20). Install a newer Interlock version or restore a backup with its matching version.
```

Older releases without this guard may still open a newer database, so always revert with a matching backup.

### Where the database and backups live

| Copy        | Default database                          |
| ----------- | ----------------------------------------- |
| Installed   | `~/.interlock/interlock.db`               |
| Development | `.interlock/interlock.db` in the checkout |

`--db` or `INTERLOCK_DB` selects another file. Backups go in `<database-path>.backups/<timestamp>-v<old>-to-v<new>-<unique>/interlock.db`.

- Backups are made only when an existing database needs a migration. Fresh databases and ordinary restarts make none.
- Backups stay until you remove them. Keep the backup and the previous package version until you have checked the upgrade.
- A backup covers database state only, not files written by scripts or changes to external services.

### If the server will not start

- Startup checks whether the port is taken before it opens the database. Find the listener with `lsof -nP -iTCP:4310 -sTCP:LISTEN`, changing the port if needed.
- A locked-database error names the path and suggests stopping other instances.
- If a process was suspended with Ctrl+Z, `kill -CONT <pid>` lets it handle a pending termination signal.
- A separate engine needs both a different port and a different database.

## Restore a pre-upgrade backup

Restoring replaces the database with the snapshot. Changes made after the snapshot are lost. Stop every server using the database first.

1. Find the backup's `interlock.db` path in the startup output or the database's `.backups` directory. Ignore any `.partial` file left by an interrupted backup.
2. Move the current database and any matching `-wal` and `-shm` files together into a separate directory. Do not copy a backup over a database that still has old sidecar files beside it.
3. Copy the backup to the original database path. Leave the backup itself in place.
4. Install the package version you recorded before upgrading, for example:

   ```sh
   npm install -g @type_of/interlock@0.1.3
   ```

5. Start Interlock with the same database path and working directory.

## Before upgrading to 0.3.0

Upgrading to 0.3.0 deletes disabled workflow variables. Run `interlock doctor` first: it warns about each disabled variable and names the workflow drafts and retained versions that reference it. Enable a variable in **Variables** to keep it.

## Changes that need action

### MCP response defaults in 0.2

Interlock 0.2 changed the default responses of three MCP tools. In 0.1, omitted options return full inspection or assignments. In 0.2, they return summaries. Execution rules, stored workflows, UI responses and CLI responses are unchanged.

| Tool            | Keep full responses  | Summary response                                                                                  |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `start_run`     | Add `detail: "full"` | `runId`, `runStatus`, cursor, bounded next work, and suggested next call                          |
| `submit_result` | Add `detail: "full"` | Continuation fields plus `workId` and `workRunId`                                                 |
| `list_work`     | Add `fields: "full"` | Assignment identity, labels, ancestry, context requirements, attempts, and any unclaimed deadline |

To move to the summary defaults:

1. Replace reads of `response.run.id` and `response.run.status` with `response.runId` and `response.runStatus`.
2. Read final output with `get_run_result`, failure details with `get_run_briefing`, and full inspection with `get_run`.
3. Update saved scripts and agent instructions.
4. Restart the upgraded server, and refresh the client's discovered tools if it caches descriptions or schemas.

Details:

- Explicit full options work in 0.1.20 and 0.2, so consumers can add them before upgrading. `claim_work` returns the complete assignment in both versions.
- In a submission, `runId` identifies the continuation lifecycle and `workRunId` the immediate assignment run. Ordinary children continue at their outermost ordinary ancestor; detached work stops at its nearest detached ancestor.
- `nextCall` suggests a read-only call, or is null when claiming needs your own identity and capabilities.
- Do not repeat `start_run` to get more detail: it creates another run.
- This change needs no database migration. See the [summary execution flow](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#continue-with-compact-mutation-responses).

### Script node timeouts

New Script nodes that omit `timeoutMs` use 60 seconds. Saved drafts and published versions keep their stored timeouts, including the earlier 30-second default.

Set `timeoutMs: 30000` explicitly when importing or submitting an older raw definition that needs the earlier timing. A timeout above 120 seconds needs a release that supports the one-hour ceiling.

### Script execution context

Scripts and Script checks receive execution context in `INTERLOCK_` environment variables. If a script reads a service-supplied variable that now has a [context name](https://github.com/dgca/interlock/blob/main/docs/architecture.md#script-execution-context), move that value to a name outside `INTERLOCK_` and update the script. Explicit saved variable bindings take precedence.

### Bundled starters

Upgrades no longer add workflows automatically. Existing workflows, versions and runs stay, including earlier seeded SDLC copies.

Find bundled procedures in **Workflows → Import → Starters**, or with `interlock starters`. Deleting a copy leaves it absent until you import it again. Copy tracking and import receipts need no schema conversion, and portable bundles leave them out. See [starter workflows](starter-workflows.md).

### Workflow variables

Existing workflows and history need no value or key migration, and variable-free workflows behave as before.

- Startup creates no encryption key until the first variable value is stored.
- Values are stored as encrypted revisions, with a separate owner-only key file. Back up that key separately from database backups.
- Portable format 4 contains references and safe requirements, never values or keys. Earlier readers cannot use variable references.

See [workflow variables](https://github.com/dgca/interlock/blob/main/docs/variables.md) for provisioning, capture and restore.

### Claim leases

- New claims store an optional `claimLeaseSeconds` and reuse it when a renewal omits its duration.
- Existing claims need no conversion. A renewal without a duration uses 300 seconds. To keep that behavior for new claims, pass `leaseSeconds: 300` explicitly.
- Summary ancestry is derived from existing runs without a database rewrite.

### Agent expiry budgets

Optional Agent `maxLeaseExpiries` separates the lease-expiry budget from the explicit-failure budget, for work created with that published setting. Leaving it out keeps the combined attempt budget.

Counters and hashed expiry receipts need no database rewrite. Existing assignments without receipts cannot identify an old token as expired. Restart after upgrading, and refresh cached MCP tool definitions to discover the compact authoring options.

### Continuity groups and model tiers

- Optional Agent continuity groups add bindings and claim and handoff history without converting existing workflows or active ungrouped claims. Export and import carry the declarations without run session identities.
- Optional Agent model tiers and claim selections add compatible fields without a database rewrite. Existing attempts keep unknown attribution. Portable exports include tiers but not attempt declarations or usage.
- Restart Interlock and refresh MCP discovery to use the group operations, `context.tier` and claim `modelSelection`.

## Database schema changes

Every upgrade below takes the normal pre-upgrade backup first. Definitions, version pins, run history and ownership are kept unless the row says otherwise.

| Schema | Change                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2      | Indexes for finding runs by workflow, status and creation time.                                                                                                                                                                                                                                                                                                 |
| 3      | Continuation revisions and a parent-run index. Existing runs start at revision zero and get a revision when their state or assignments change. Restarting resets continuation cursors: fetch the returned snapshot and continue with its new cursor.                                                                                                            |
| 4      | Indexes for assignment status, owning run, resource admission, run chains and run-scoped documents. Needs extra disk space and takes longer on large databases. No manual steps or new retention limits.                                                                                                                                                        |
| 5      | Scheduling metadata for pending comparisons and active runs, kept in the same transaction as comparison and run writes, including retries and trial cleanup. Backfills existing state. [Manual history cleanup](https://github.com/dgca/interlock/blob/main/docs/history-cleanup.md) becomes available after restart; the upgrade itself never deletes history. |
| 6      | Index for managed Agent attention.                                                                                                                                                                                                                                                                                                                              |
| 7      | Index for the Runs list. Run records and execution history keep their format. Needs extra disk space and may take longer on large histories.                                                                                                                                                                                                                    |
| 8–11   | Indexes for pause holds, the admission queue, schedules and trigger fires, and unresolved stalls.                                                                                                                                                                                                                                                               |
| 12–13  | Indexes for webhook and event deliveries, and tracking of active background steps.                                                                                                                                                                                                                                                                              |
| 14     | Table of run tags for tag filters.                                                                                                                                                                                                                                                                                                                              |
| 15, 16 | Remove features that only existed in development builds. See [Development databases](#upgrading-unreleased-development-databases).                                                                                                                                                                                                                              |
| 17     | Tables for managed Agent transcripts.                                                                                                                                                                                                                                                                                                                           |
| 18     | Indexes for open Human input requests, uncertain background steps and board stage entries. Integration-owned External input waits are kept.                                                                                                                                                                                                                     |
| 19     | Tables for current run and assignment state, backfilled from existing records. Execution history, assignments and published definitions are kept.                                                                                                                                                                                                               |
| 20     | Index for Script approvals. Scripts already in drafts and published versions are recorded as approved.                                                                                                                                                                                                                                                          |
| 21     | Moves each run's step executions out of the run record into their own table. See below.                                                                                                                                                                                                                                                                         |
| 22     | Index of finished runs by finish time, which boards use to show the most recently finished runs. No stored data changes.                                                                                                                                                                                                                                        |

### Schema 21: executions in their own table

Schema 21 stores each step execution as its own row, keyed by run and position, instead of inside the run record. Run content does not change, and continuation cursors stay valid.

- Startup takes the usual backup before moving anything.
- The change is one-way. A build that predates schema 21 cannot read the upgraded database, and builds with the migration guard refuse to open it.
- To go back to an earlier version, [restore the backup](#restore-a-pre-upgrade-backup) made before the upgrade.

## Upgrading unreleased development databases

These migrations only affect databases created by development builds.

**Schema 15** removes inbound webhook triggers, outbound webhook event actions and their delivery records. These integrations were not part of `@type_of/interlock@0.2.13`.

- Runs, workflow definitions, variables, schedules, workflow-based event automations and durable event receipts stay.
- Bundle format numbers remain 1 through 10. Format 7 is reserved and no longer emitted. Bundles containing removed webhook configuration are rejected on import.

**Schema 16** clears obsolete provider-diversity constraints and blockers from assignment records. This feature was not published in `0.2.13`.

- Workflow definitions, published versions, prompt pins, model-alias captures and execution provenance do not change.
- New authoring and imports reject the removed Agent fields `distinctProviderFrom` and `candidateModels`. Remove them from development definitions before saving or importing again.

## Add a database migration

This section is for contributors. The schema version is independent of the npm package version. `packages/storage/src/migrations.ts` owns the ordered migration list, and the `migrations` table records completed versions.

Rules:

- Append the next consecutive version when a persisted format needs conversion. Never edit a migration that has shipped.
- Keep migration functions synchronous and limited to database changes. The runner owns the transaction and version records: do not commit transactions or cause external side effects.
- Preserve immutable published definitions, version pins and run history. Prefer compatible readers for optional fields when no rewrite is needed.
- A schema migration does not make an incompatible API or execution change backward compatible.

### Test it

Add a fixture from the preceding release and test the conversion, rollback and execution of its published workflows.

- `tests/migrations.test.ts` covers the runner with test-only future migrations, including a failed later migration and committed WAL data.
- The schema-v1 fixture was generated by the tagged 0.1.3 runtime.
- The schema-v2 fixture was generated by the published 0.1.13 CLI in a temporary database. It includes JavaScript and legacy Bash workflow pins, completed runs, events and a claimed Agent assignment, with its test claim token and deadline normalized. Tests check that records stay unchanged, that revisions persist across reopen, that claimed work continues, and that earlier script pins execute.
- The published 0.1.18 fixture in `tests/fixtures/testbench-previous-release.json` keeps the original schema SQL, JavaScript and omitted-language Bash versions, completed runs and an active claim. Testbench compatibility checks open it unchanged, resume its claim and run both script paths before comparing a previous pin. Workflow test suites and comparisons use new document collections and optional run context without converting existing schema-3 records.

### How the runner protects the upgrade

The runner uses SQLite's [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause) to make a consistent snapshot, including committed WAL data. After it takes the migration write lock, it checks `PRAGMA data_version` and refuses to continue if another connection committed during the backup. This protects the upgrade; it does not add support for several running servers.
