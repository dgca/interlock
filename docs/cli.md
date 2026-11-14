---
title: CLI reference
description: Common commands for the local engine, workflows, runs, and diagnostics.
---

# CLI reference

Workflow and run inspection commands print JSON. `doctor` and `report` default to readable text.

## Start the engine

```sh
interlock [--port 4310] [--workdir PATH] [--db PATH]
```

The defaults are port `4310`, your current directory for script execution, and `~/.interlock/interlock.db` for storage. `INTERLOCK_WORKDIR` and `INTERLOCK_DB` provide defaults for their flags. Explicit flags take precedence.

`INTERLOCK_URL` selects another engine for client commands:

```sh
INTERLOCK_URL=http://127.0.0.1:4400 interlock workflows
```

| Command               | Purpose                                |
| --------------------- | -------------------------------------- |
| `interlock --help`    | Server options and command groups      |
| `interlock commands`  | Complete argument syntax               |
| `interlock --version` | Installed version                      |
| `interlock mcp`       | Stdio MCP bridge to the running engine |

## Workflows

| Command                           | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `interlock workflows`             | List the library                       |
| `interlock workflow WORKFLOW_ID`  | Inspect a workflow and its draft       |
| `interlock starters`              | List bundled starters                  |
| `interlock import-starter sdlc`   | Add or find the SDLC starter copy      |
| `interlock import @workflow.json` | Import a definition or portable bundle |
| `interlock publish WORKFLOW_ID`   | Publish a new version                  |
| `interlock export WORKFLOW_ID`    | Print a portable bundle                |

Standalone workflow imports create drafts. Starter imports create published copies. Neither starts work automatically.

Imported Scripts wait for approval before their first run. Review the code in the run's request, then run `interlock approve-script RUN_ID EXECUTION_ID`. `interlock script-approval` prints which Scripts need approval; pass `imports`, `imports_and_agents` or `off` to change it. See [approve imported Scripts](reuse-work.md#approve-imported-scripts).

To inspect a portable bundle's board suggestions, run `interlock import @workflow.json --dry-run`. Use `interlock starters` for starter suggestions. When you have chosen the destination board setup, pass it as JSON or a file with `--board-setup`.

```sh
interlock import @workflow.json --board-setup @setup.json
interlock import-starter sdlc --board-setup @setup.json
```

Keep the setup's `requestId` and arguments when retrying. For starter imports, the CLI uses that key if you omit `--request-id`. Use `--copy` to apply board setup when the starter already has a local copy. See [board setup choices](reuse-work.md#set-up-a-board-during-import).

## Start and inspect runs

JSON arguments accept inline values or `@filename`. Match the workflow's input contract:

```sh
interlock start WORKFLOW_ID '{"request":"Review the setup instructions"}'
interlock start WORKFLOW_ID @input.json
```

Append a version number to select a publication, for example `interlock start WORKFLOW_ID @input.json 2`. Otherwise, start uses the latest published version.

When a start warning threshold is set with `interlock prices start-warning`, the start output includes `costProjection`, the median cost of recent runs. The CLI does not ask for confirmation.

| Command                                            | Purpose                               |
| -------------------------------------------------- | ------------------------------------- |
| `interlock runs --workflow WORKFLOW_ID --limit 20` | List recent workflow runs             |
| `interlock run RUN_ID`                             | Inspect execution state and results   |
| `interlock work RUN_ID --summary`                  | Inspect available Agent assignments   |
| `interlock usage RUN_ID`                           | Inspect reported token usage and cost |

Use IDs returned by commands. Starting a connected-agent run makes assignments available without launching an agent. See [Run agents](agents.md).

## Manage a run

| Command                                                   | Purpose                   |
| --------------------------------------------------------- | ------------------------- |
| `interlock retry RUN_ID`                                  | Retry failed work         |
| `interlock cancel RUN_ID`                                 | Cancel a run              |
| `interlock cancel-tree RUN_ID --preview`                  | Preview tree cancellation |
| `interlock cancel-tree RUN_ID --reason "Stopped by user"` | Cancel a run tree         |

Tree cancellation excludes detached descendants unless you add `--include-detached`. Inspect external effects and any stop-reconciliation requirements before retrying.

## Diagnose and report

| Command                                   | Purpose                              |
| ----------------------------------------- | ------------------------------------ |
| `interlock doctor`                        | Read-only readiness checks           |
| `interlock doctor --json`                 | Machine-readable checks              |
| `interlock report --workflow WORKFLOW_ID` | Workflow performance and cost report |
| `interlock report --json`                 | Machine-readable report              |

`doctor` exits with code `1` for a failure and `0` for passing checks or warnings. Add `--live` only when you want enabled-harness model connectivity checks; those make model requests.
