---
'@type_of/interlock': patch
---

Refresh Interlock's dark workspace and expand workflow automation, execution control, harness configuration, and reporting.

#### Workflow execution and reliability

- Queue workflow starts durably with priorities, dependencies, stage exclusions, and policies for active work on the same external task. Apply per-profile concurrency limits alongside the shared limit.
- Pause and resume workflows at execution boundaries. Preview and cancel run trees, optionally including detached descendants, while retaining recovery controls for uncertain external work.
- Run opted-in background Scripts across server restarts without replay. Extend exclusive resources to Script, Fetch, and polling Wait steps.
- Configure stall attention, pause-aware Agent deadlines, and managed recovery for transient failures or missing structured results. Bind working directories from run data within allowed roots.
- Opt active runs into compatible published updates at step boundaries, or preview explicit version moves while preserving captured work and execution history. Extend fixture simulation to waited children, virtual-time waits, timeouts, failure routes, and edge coverage.

#### Automations

- Schedule workflows with interval or cron timing, overlap and missed-fire policies, input bindings, and failure pauses.
- Start handler workflows from lifecycle, attention, and stall events, with durable deduplication. Terminal-event handlers can optionally wait for the source run tree to stop. Manage configurations, search, status, and activity in Automations. Updates and replacement imports clear omitted event filters. Imported schedules and event handlers remain disabled until explicitly enabled.

#### Harnesses and models

- Configure custom subprocess or HTTP harnesses and delegated launchers. Interlock passes command tokens as data, handles early exits without crashing, and stops owned process groups before retrying timed-out turns. Unconfirmed cleanup requires reconciliation. Inspect managed session names, resume commands, links, and live progress.
- Manage revisioned model aliases with ordered candidates in AI Settings. Runs capture alias revisions at startup; unavailable known aliases block new starts. Portable bundles retain alias requirements for explicit local configuration.
- Pin exact prompt revisions at publication and preserve them in portable bundles. Preview semantic bundle changes with CLI `--dry-run`, then import and publish atomically with optional dependent republishing through `--publish --cascade`.

#### Observability and diagnostics

- Inspect shared run stages, waiting reasons, and responsible actors. Bind engine-verified execution provenance and loop visit counts, and report observer usage outside claim attempts.
- Tag runs with exact key/value metadata and filter Runs and performance reports by matching pairs. Report workflow timing, queue and human wait, pause-adjusted durations, reliability, outcomes, and model spend with alias attribution and measurement coverage. Stage durations and Exit outcomes use each execution's recorded workflow version.
- Run read-only readiness checks through Diagnostics, `interlock doctor`, or MCP, with optional live harness verification.
- Configure opt-in automatic history retention by age and count, with workflow overrides. Cleanup skips protected run trees and preserves durable receipts. Automatic retention is off by default.

#### UI and editor

- Refresh workspaces with the Grid dark theme, IBM Plex fonts, consistent controls, responsive headers, and clearer forms and dialogs. AI Settings groups Harnesses, Model aliases, and Execution settings into task tabs.
- Default Runs to List and provide a separate Overview with Active runs first. Preserve filters and navigation context, keep history controls available in both views, and use anchored tag-filter popovers with removable conditions.
- Keep visited pages visible during background refresh, reuse cached harness settings, and load feature views and editors on demand. Open created and cloned workflows without false not-found screens, and refresh run and work views after cancellation. Expand long workflow descriptions in place and keep detail actions consistent.
- Save node positions automatically when dragging, tidying, or undoing layout changes. Retain arrangements across visits and content discard without changing the content revision or publishing. Raw edits, including positions, remain local until Save and can be discarded. Existing export formats carry the saved positions; published snapshots stay unchanged.
- Restore the pinned workflow version's output contract when switching a saved call from Start and continue to Wait for result.
- Remove variable enable/disable controls from the editor. Existing disabled variables remain disabled and can be restored through the CLI.

Installed packages exclude internal research documents. Upgrades back up existing databases before applying required migrations. Existing runs retain their version unless you opt into or explicitly apply a version update. See the [upgrade instructions](https://github.com/dgca/interlock/blob/main/docs/upgrading.md).
