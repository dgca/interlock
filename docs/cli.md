---
title: CLI reference
description: Every interlock command, for the local engine, workflows, runs, boards and diagnostics.
---

# CLI reference

The `interlock` command starts the local engine and talks to a running one. Use this page to find a command and its flags; each section links to the guide for that feature.

## Start the engine

```sh
interlock [--port 4310] [--workdir PATH] [--db PATH]
```

With no command, `interlock` starts the engine, the UI and the HTTP MCP endpoint at `/mcp`. Keep the terminal open. Pending database migrations run at startup, with a backup before schema upgrades.

| Flag        | Default                                                                                    | Environment variable |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------- |
| `--port`    | `4310`                                                                                     | none                 |
| `--workdir` | Current directory, for Scripts                                                             | `INTERLOCK_WORKDIR`  |
| `--db`      | `<data-dir>/interlock.db` with `INTERLOCK_DATA_DIR`, otherwise `~/.interlock/interlock.db` | `INTERLOCK_DB`       |

Explicit flags take precedence over environment variables.
Set `INTERLOCK_DATA_DIR` to an absolute path to put the database, keys and API token, background Script spool, and managed worktrees in one directory. `--db` and `INTERLOCK_DB` override the database path. See [engine state locations](https://github.com/dgca/interlock/blob/main/docs/architecture.md#engine-state-locations).

### Operator config file

The engine reads one JSON object at startup. Set `INTERLOCK_CONFIG` to an absolute path to select a required file. Otherwise the engine looks for `config.json` under `INTERLOCK_DATA_DIR`, or beside the `keys` folder in the [user config directory](https://github.com/dgca/interlock/blob/main/docs/architecture.md#engine-state-locations). A missing file at either default location is valid. An unreadable or invalid file stops startup before the engine opens the database or writes state.

| Key            | JSON value                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requireToken` | Boolean. Defaults to `false` on loopback. The token is always required off loopback.                                                                   |
| `allowedRoots` | Array of absolute paths for shared dynamic working-directory checks. Defaults to no startup roots. Give at least one path; an empty array is rejected. |
| `logLevel`     | `debug`, `info`, `warn`, or `error`. Defaults to `info`.                                                                                               |
| `syncDir`      | Absolute path to a workflow sync folder. Sync is off by default.                                                                                       |

Each key is optional. For each setting, explicit startup options take precedence over environment variables, then file values, then defaults. Key names and file log levels are case-sensitive. When the file declares `allowedRoots`, the resolved startup list replaces saved shared roots. Changes to the saved shared roots are unavailable until the key is removed and the engine restarts. Per-harness roots follow their existing rules.

Edit the file on the engine host and restart the engine to apply changes. Keep it at a separate path from engine files such as the database and logs. Interlock never writes it. Client commands and the stdio bridge use the running engine and do not read the file.

## How commands work

- Commands print JSON, except `doctor` and `report`, which print readable text unless you add `--json`.
- A JSON argument is inline or `@filename`: `'{"request":"…"}'` or `@input.json`.
- Commands talk to `http://127.0.0.1:4310`. Set `INTERLOCK_URL` to use another engine:

  ```sh
  INTERLOCK_URL=http://127.0.0.1:4400 interlock workflows
  ```

- When the engine requires a token, commands and the MCP bridge read the same [API token file](https://github.com/dgca/interlock/blob/main/docs/connect-harness.md#api-token). Give them the engine's `INTERLOCK_DATA_DIR` if it is set.

| Command                    | Purpose                           |
| -------------------------- | --------------------------------- |
| `interlock --help`         | Server options and command groups |
| `interlock commands`       | Complete argument syntax          |
| `interlock COMMAND --help` | One command's argument syntax     |
| `interlock --version`      | Installed version                 |

## Connect an MCP client

```sh
interlock mcp [--profile all|execute|author|operate]
```

`interlock mcp` is a stdio MCP bridge to the running engine. Stdout is reserved for the MCP protocol. `--profile`, or `INTERLOCK_MCP_PROFILE`, limits the tools served; the default is `all`. HTTP clients use `/mcp/<profile>`. See [Connect with MCP](connect-mcp.md).

## Workflows

| Command                                     | Purpose                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `interlock workflows [SCOPE_JSON]`          | List the library. `{"ownerWorkflowId":"PARENT_ID"}` lists the workflows that parent owns; `null` lists unowned workflows. |
| `interlock workflow WORKFLOW_ID`            | Inspect a workflow and its draft                                                                                          |
| `interlock update WORKFLOW_ID JSON`         | Change metadata or replace the draft                                                                                      |
| `interlock edit WORKFLOW_ID JSON`           | Apply stable-ID edits to the draft atomically                                                                             |
| `interlock publish WORKFLOW_ID [--cascade]` | Publish a new version. `--cascade` also republishes, atomically, every workflow that depends on it.                       |
| `interlock export WORKFLOW_ID`              | Print a portable bundle                                                                                                   |
| `interlock archive WORKFLOW_ID`             | Archive a workflow, keeping its history                                                                                   |
| `interlock restore WORKFLOW_ID`             | Restore an archived workflow                                                                                              |
| `interlock delete WORKFLOW_ID --yes`        | Permanently delete a workflow                                                                                             |

- `update` and `edit` need the current `draftRevision` for draft changes. Add `"layout":"tidy"` to arrange the canvas, or `"preserve"` to keep saved positions. A layout-only change keeps the revision.
- `delete` removes the workflow, its history, and its local test suites, comparisons and simulations. Managed trial cleanup must finish first; retained trial files are not deleted. Use `archive` to keep history.

### Import

| Command                               | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `interlock import @workflow.json`     | Import a workflow definition or portable bundle |
| `interlock starters`                  | List bundled starters and your existing copies  |
| `interlock import-starter STARTER_ID` | Add a starter, or return your existing copy     |

A standalone workflow file creates a draft. A starter import creates a published copy. Neither starts work. See [Starter workflows](starter-workflows.md).

Flags for portable bundles:

| Flag                         | Effect                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                  | Preview semantic differences and board suggestions without importing                                                |
| `--publish`                  | Publish the imported workflows atomically                                                                           |
| `--cascade`                  | Also republish the workflows that depend on them, as `publish --cascade` does                                       |
| `--force`                    | Replace existing drafts. It cannot replace versions or shared prompts, move ownership, or restore deleted versions. |
| `--revisions JSON`           | Replace existing drafts, given their current draft revisions by workflow ID                                         |
| `--restore-deleted-versions` | Restore deleted versions. Requires their original definitions.                                                      |
| `--variable-bindings JSON`   | Bind or provision the variables the bundle requires                                                                 |
| `--board-setup JSON`         | Apply your board setup choices                                                                                      |

Flags for `import-starter`:

| Flag                 | Effect                                                                               |
| -------------------- | ------------------------------------------------------------------------------------ |
| `--copy`             | Add another copy, even if one exists. Board setup needs a new copy.                  |
| `--request-id KEY`   | Retry key. Without it, the CLI uses the board setup's `requestId`, or generates one. |
| `--board-setup JSON` | Apply your board setup choices                                                       |

To choose a board setup, preview with `interlock import @workflow.json --dry-run` or `interlock starters`, then pass the file:

```sh
interlock import @workflow.json --board-setup @setup.json
interlock import-starter sdlc --board-setup @setup.json
```

Keep the setup's `requestId` and arguments when retrying. See [Set up a board during import](reuse-work.md#set-up-a-board-during-import).

### Approve imported Scripts

| Command                                        | Purpose                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `interlock approve-script RUN_ID EXECUTION_ID` | Approve the imported Script, or permission policy, a waiting step runs |
| `interlock script-approval`                    | Show which Scripts need approval                                       |
| `interlock script-approval MODE`               | Set it to `imports`, `imports_and_agents` or `off`                     |

Review the code in the run's request before approving. See [Approve imported Scripts](reuse-work.md#approve-imported-scripts).

## Start runs

```sh
interlock start WORKFLOW_ID '{"request":"Review the setup instructions"}'
interlock start WORKFLOW_ID @input.json 2 --title "Setup review" --summary
```

The input must match the workflow's input contract. Append a version number to start that version; otherwise the latest published version runs. Starting a connected-agent run makes assignments available without launching an agent. See [Run agents](agents.md).

| Flag                               | Effect                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--title TEXT`                     | Run title, up to 200 characters                                                                              |
| `--summary`                        | Print a compact response with the next call to make                                                          |
| `--budget JSON`                    | Run budget policy. See [Run budgets](run-budgets.md).                                                        |
| `--request-id KEY`                 | Retry key. An identical retry returns the original run.                                                      |
| `--external-task JSON`             | Link the run to an external task, for correlation only                                                       |
| `--tag KEY=VALUE`                  | Tag the run. Repeat for more tags; each key once.                                                            |
| `--priority N`                     | Admission priority. Higher first, ties in order, default 0.                                                  |
| `--after JSON`                     | Wait for up to 32 referenced runs or chains to succeed before starting                                       |
| `--on-active-external-task POLICY` | `allow` (default), `reuse`, `reject` or `cancel_previous`. Values other than `allow` need `--external-task`. |
| `--version-policy POLICY`          | `pinned` (default) or `latest-compatible`                                                                    |
| `--hold REASON`                    | Keep the run queued in the board's Backlog until released                                                    |

When a start warning is set with `interlock prices start-warning`, the output includes `costProjection`, the median cost of recent runs. The CLI does not ask for confirmation.

## Inspect runs

| Command                                            | Purpose                             |
| -------------------------------------------------- | ----------------------------------- |
| `interlock runs --workflow WORKFLOW_ID --limit 20` | List recent runs of a workflow      |
| `interlock run RUN_ID [--full]`                    | Inspect execution state and results |
| `interlock work [RUN_ID] [--summary]`              | List available Agent assignments    |
| `interlock usage RUN_ID [OPTIONS_JSON]`            | Reported token usage and cost       |
| `interlock budget RUN_ID`                          | The run's budget policy and status  |

`work --summary` includes each assignment's `rootWorkflowId`, so executor scripts can route assignments by the workflow that started the tree.

`runs` without filters prints full runs, newest first, 1000 per page. With any filter it prints summaries. When a page is full, it tells you the `--after-run` value for the next page.

| `runs` filter                     | Selects                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `--workflow ID`                   | Runs of one workflow                                           |
| `--status STATUS`                 | Runs in one status                                             |
| `--tag KEY=VALUE`                 | Runs with a tag; repeat for more                               |
| `--request-id KEY`                | The run started with that key                                  |
| `--external-task JSON`            | Runs linked to an external task                                |
| `--chain ROOT_RUN_ID`             | Runs in one continue-as-new chain                              |
| `--root-only`                     | Top-level runs only                                            |
| `--input-path PATH --equals JSON` | Runs whose input has that value at the path; use both together |
| `--limit N`, `--after-run RUN_ID` | Page size and position                                         |

Above 64 KiB, `interlock run` omits fields over 1 KiB and lists their sizes. Add `--full` for the complete response. The limit applies to the compact JSON, so the indented output can be larger than 64 KiB. Agents read one step with MCP `get_run_result`. See [Inspect and manage runs](inspect-runs.md).

`usage` options: `includeDescendants`, `includeChain`, `groupBy` (for example `"attempt"`), `includeReports`, `limit`, `offset`.

## Manage runs

| Command                                                   | Purpose                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `interlock retry RUN_ID`                                  | Retry a failed run. For a failed Parallel group, retry the parent; successful branches are kept. |
| `interlock cancel RUN_ID [--chain]`                       | Cancel a run. `--chain` stops the latest successor from any chain member.                        |
| `interlock cancel-tree RUN_ID --preview [--offset N]`     | Preview cancelling the run and its descendants                                                   |
| `interlock cancel-tree RUN_ID --reason "Stopped by user"` | Cancel the run tree atomically                                                                   |
| `interlock set-budget JSON`                               | Change a run's budget: `runId`, `expectedRevision`, `budget` (`null` disables the local policy)  |
| `interlock run-version JSON`                              | Read or change which published version a run follows                                             |
| `interlock run-history JSON`                              | Opt-in retention and deletion of old run history                                                 |

- Detached descendants are independent. `cancel` leaves them running; `cancel-tree` includes them only with `--include-detached`. `--limit N` bounds a preview page.
- Inspect external effects and any stop-reconciliation requirements before retrying.
- `run-version` actions: `read` (with `runId`, `offset`, `limit`); `policy` (with `expectedRevision` and `pinned` or `latest-compatible`); `preview` (a newer version, optional `recapturePrompts`); `apply` (needs the exact preview confirmation and a reason).
- `run-history` actions: `settings`, `configure` (needs `expectedRevision`; `null` thresholds disable, or inherit for workflow overrides), `status`, `preview` (with `workflowId`, `before`, `rootRunIds`, `offset`, `limit`) and `delete` (needs the previewed roots with their confirmations and `acknowledgeHistoryLoss: true`). Workflows and published versions remain.

### Steps that need a person or a decision

| Command                                               | Purpose                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `interlock external-input JSON`                       | Human input and external callbacks: `status`, `submit`, `accept`, `hold` or `release`                                           |
| `interlock work-hold JSON`                            | `hold` or `resume` an Agent assignment (with the current attempt and revision), or read its `history`                           |
| `interlock work-resources JSON`                       | Inspect exclusive resources by `workId`, or `runId` and `executionId`; release an uncertain attempt after confirming it stopped |
| `interlock script JSON`                               | `inspect`, `stop` or `reconcile` a Script by `runId` and `executionId`. Reconcile needs `stopped: true` and a reason.           |
| `interlock context-group RUN_ID GROUP [OPTIONS_JSON]` | A context group's binding and history; `offset`, `limit`                                                                        |
| `interlock handoff-context JSON`                      | Hand a context group to another session: `runId`, `group`, `expectedRevision`, `session`, `actor`, `reason`, `checkpointRef`    |

## Work as an agent

Connected agents usually use MCP. These commands do the same from a shell.

| Command                                                                          | Purpose                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `interlock claim WORK_ID [WORKER_ID] [OPTIONS_JSON] [--fresh] [--lease SECONDS]` | Claim an assignment. The worker ID defaults to `cli`.                                                  |
| `interlock preflight WORK_ID TOKEN JSON`                                         | Check a result against the contract without submitting                                                 |
| `interlock submit WORK_ID TOKEN JSON [--summary]`                                | Submit a result                                                                                        |
| `interlock fail WORK_ID TOKEN ERROR`                                             | Report that the assignment failed                                                                      |
| `interlock renew WORK_ID TOKEN [OPTIONS_JSON]`                                   | Extend the claim, for example `{"leaseSeconds":3600}`                                                  |
| `interlock assignment-size JSON`                                                 | Measure an assignment by `workId`, or `workflowId` and `nodeId` with a sample; optional `warningBytes` |
| `interlock report-usage JSON`                                                    | Report cumulative token usage for an attempt or run                                                    |

- `claim` options: `leaseSeconds` (default: the Agent's `leaseSeconds`, otherwise 300), `freshContext`, `tools`, `skills`. `--fresh` attests an isolated context and `--lease` sets the lease; flags override the options JSON. Grouped work also needs `session: {executorId, sessionId}`. An optional `modelSelection: {tier, provider, model}` declares a selection, not usage.
- `report-usage` with the executor source (the default) needs the claim `token`. `source: "observer"` omits the token and needs an ended attempt; with `runId` it reports run-level usage. Observer figures take precedence in totals and budgets. Values are cumulative per source and stream; missing values stay unknown.

## Boards

| Command                                       | Purpose                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `interlock board view BOARD_ID`               | Read a board's lanes and cards                                                               |
| `interlock board view --workflow WORKFLOW_ID` | Read that workflow's stage board                                                             |
| `interlock board types`                       | List board types, including the built-in `coding`, `design` and `research`                   |
| `interlock board save-type JSON`              | Create or update a board type: `{"id"?,"expectedRevision"?,"type":{…}}`                      |
| `interlock board save JSON`                   | Create a board, `{"name","typeId","scope"?}`, or update one with `id` and `expectedRevision` |
| `interlock board hold RUN_ID REASON`          | Park a queued start in the Backlog                                                           |
| `interlock board release RUN_ID`              | Release a held start to admission                                                            |

Add `--lane LANE --offset N --limit N` to `board view` to page one lane. Saving a board with a built-in `typeId` stores an editable copy of that type:

```sh
interlock board save '{"name":"Delivery","typeId":"coding"}'
```

See [Boards](workflow-boards.md).

## Proposals

| Command                                                                                                                 | Purpose                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `interlock proposals list [--workflow ID] [--run ID] [--status open\|approved\|rejected\|all] [--offset N] [--limit N]` | The review queue                                                         |
| `interlock proposals get PROPOSAL_ID`                                                                                   | A proposal with its conflict state, proposed draft and simulation result |
| `interlock proposals create JSON`                                                                                       | Propose a change as a person                                             |
| `interlock proposals approve PROPOSAL_ID [--edits JSON]`                                                                | Apply the edits as a new draft revision. Never publishes.                |
| `interlock proposals reject PROPOSAL_ID REASON`                                                                         | Reject with a reason                                                     |
| `interlock proposals reapply PROPOSAL_ID`                                                                               | Move a stale proposal onto the current draft                             |
| `interlock proposals settings WORKFLOW_ID [JSON]`                                                                       | Read or save whether agents may propose, and what they may touch         |

See [Proposed workflow changes](workflow-proposals.md).

## Memory, variables and triggers

| Command                                           | Purpose                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `interlock memory read JSON`                      | `list`, `history` or `reviews`                                      |
| `interlock memory manage JSON`                    | `configure`, `add`, `edit`, `approve`, `reject`, `revert`, `delete` |
| `interlock memory work JSON`                      | An agent's `read` and `write` during a claim                        |
| `interlock variables read JSON`                   | List or inspect variable metadata                                   |
| `interlock variables manage JSON [--value-stdin]` | Create, update or delete variables                                  |
| `interlock triggers read JSON`                    | `list`, `inspect`, `preview`, `attention`                           |
| `interlock triggers manage JSON`                  | `create`, `update`, `enable`, `disable`, `delete`                   |

- Variable values never go in command-line JSON. Pipe them through `--value-stdin`, up to 16 KiB, with a `create` or `update` action. Secret values have no read-back.
- Triggers are schedules or events. Changes need `expectedRevision`. New triggers are disabled unless you pass `enabled: true`, and imported ones start disabled. `schedules` is an alias for `triggers`.

See [Workflow memory](memory.md) and [Automations](automation-guide.md).

## Test workflows

| Command                     | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `interlock test-suite JSON` | `create`, `update`, `get` or `list` saved cases with optional fixtures |
| `interlock simulation JSON` | `run`, `get`, `list`, `capture` or `cancel` a fixture simulation       |

Simulations use fixtures only and have no external effects. See [Test and improve](testing-workflows.md).

## Costs and prices

| Command                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `interlock prices`                      | Read the model price table new runs capture for derived cost                            |
| `interlock prices JSON`                 | Replace it: `{"expectedId":"…","table":{…}}`; `"table":null` restores the shipped table |
| `interlock prices start-warning [JSON]` | Read or set `{"threshold":{"currency":"USD","amountMicros":N}}`; `null` clears it       |

Above the threshold, the median recent run cost makes the UI ask before starting, and start responses include `costProjection`.

## Engine settings and holds

| Command                                | Purpose                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interlock executors [JSON]`           | Managed executors. Lists them by default; actions include `settings`, `save_settings` (concurrency, `defaultPermissions`, `allowedRoots` unless the [operator config](#operator-config-file) declares it; unset `defaultPermissions` means Full access), profiles, models, transcripts, messages, `stop` and `reconcile`. |
| `interlock launcher JSON`              | Pull launcher profiles: `credential`, `poll`, `complete`, `fail`. The credential comes from `INTERLOCK_LAUNCHER_CREDENTIAL` unless given.                                                                                                                                                                                 |
| `interlock stalls [JSON]`              | Stall monitoring. Reads settings by default; `configure` with `expectedRevision`, or `inspect` a run.                                                                                                                                                                                                                     |
| `interlock pause JSON`                 | Create a library or workflow hold with `target`, `actor` and `reason`                                                                                                                                                                                                                                                     |
| `interlock pause-holds [OPTIONS_JSON]` | List applicable holds; `workflowId`, `offset`, `limit`                                                                                                                                                                                                                                                                    |
| `interlock resume HOLD_ID`             | Release one exact hold; other holds remain                                                                                                                                                                                                                                                                                |

A pause holds gate boundaries and new claims without interrupting work in flight.

## Diagnose and report

| Command                                   | Purpose                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `interlock doctor`                        | Read-only readiness checks                         |
| `interlock doctor --json`                 | Machine-readable checks                            |
| `interlock doctor --live`                 | Also check model connectivity of enabled harnesses |
| `interlock report --workflow WORKFLOW_ID` | Workflow performance and cost report               |
| `interlock report --json`                 | Machine-readable report                            |

- `doctor` exits with code `1` for a failure, and `0` for passing checks or warnings. `--live` makes model requests, so use it only when you want them.
- `doctor` reports the running engine's data directory, database, protected-value key, API token, spool, and managed worktree paths. Each path includes the setting or default that selected it.
- It also reports the operator config path, whether the file was found at startup, and the effective startup values and sources of the four settings. The `allowedRoots` row shows the list in effect: the startup list, plus saved shared roots when the file omits `allowedRoots`. The report omits the API token itself.
- `report` also takes `--since` and `--until` (ISO datetimes), `--limit N` and `--tag KEY=VALUE`. Dates must stay within years 0000–9999 once rounded to UTC. See [Reports](reports.md) and [Troubleshooting](troubleshooting.md).

## Environment variables

| Variable                        | Effect                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERLOCK_DATA_DIR`            | Absolute directory for engine state. See [engine state locations](https://github.com/dgca/interlock/blob/main/docs/architecture.md#engine-state-locations). |
| `INTERLOCK_CONFIG`              | Absolute path to a required [operator config file](#operator-config-file).                                                                                  |
| `INTERLOCK_DB`                  | Database path. Takes precedence over `INTERLOCK_DATA_DIR` for SQLite.                                                                                       |
| `INTERLOCK_WORKDIR`             | Default Script working directory                                                                                                                            |
| `INTERLOCK_URL`                 | Engine that commands and `interlock mcp` talk to                                                                                                            |
| `INTERLOCK_MCP_PROFILE`         | Default tool profile for `interlock mcp`                                                                                                                    |
| `INTERLOCK_REQUIRE_TOKEN`       | `1` rejects API, MCP and event requests without the API token                                                                                               |
| `INTERLOCK_ALLOWED_ROOTS`       | Shared roots for dynamic working directories. Use a JSON array or a comma- or colon-separated list.                                                         |
| `INTERLOCK_SECRET_KEY_FILE`     | Absolute override for the variable encryption key file, including when `INTERLOCK_DATA_DIR` is set.                                                         |
| `INTERLOCK_LOG_LEVEL`           | `debug`, `info` (default), `warn` or `error`                                                                                                                |
| `INTERLOCK_SYNC_DIR`            | Sync workflow drafts with bundle files in a folder. See [Sync workflows](reuse-work.md#sync-workflows-with-a-repository-folder).                            |
| `INTERLOCK_OTEL_TRACES`         | `1` exports run traces to `OTEL_EXPORTER_OTLP_ENDPOINT`. See [OpenTelemetry traces](opentelemetry.md).                                                      |
| `INTERLOCK_LAUNCHER_CREDENTIAL` | Credential for `interlock launcher`                                                                                                                         |
