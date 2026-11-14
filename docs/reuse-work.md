---
title: Reuse work
description: Start from existing procedures and share workflows, prompts, and configuration.
---

# Reuse work

Keep repeated procedures and instructions in one place so you can use them across workflows.

## Start with a workflow

The starter picker offers published procedures you can add to your library. The **SDLC workflow** plans, implements, and reviews a software change. Imported starters become your own copies. Adding one does not start a run or replace an existing workflow.

Use a **Workflow** step to invoke a published procedure from another workflow. For example, several procedures can share a review workflow instead of maintaining separate copies of its steps. Choose whether the caller waits for its result or starts it independently.

## Approve imported Scripts

Script steps and polling Script checks run as your user. The import preview lists every Script an import contains so you can read the code first. After an import, a run that reaches an imported Script waits on a **Needs attention** request that shows the code. Choose **Approve and run** to continue, or run `interlock approve-script RUN_ID EXECUTION_ID`. Approval applies to that exact code in that workflow, so later runs and edits you make do not ask again. Scripts that you write, or that a connected agent writes over MCP, run without approval. Workflows and Scripts that existed before this check was added stay approved.

Choose which Scripts need approval in **Settings → AI → Execution settings → Script approval**, or with `interlock script-approval`. **Imported and agent Scripts** also holds Script content an agent adds or changes over MCP. **Off** runs every Script without approval. Only a person can approve Scripts or change this setting; MCP callers are refused.

A workflow [permission policy](permission-policy.md) from an import, or one an agent writes over MCP, waits the same way under any setting except **Off**: a new run holds at its entry with an **Approve permission policy** request, and `interlock approve-script` approves it too.

## Sync workflows with a repository folder

To review workflows in pull requests, start Interlock with `INTERLOCK_SYNC_DIR` set to a folder in your repository, for example `INTERLOCK_SYNC_DIR=./workflows interlock`. Sync is off when the variable is unset.

- **Publishing writes the file.** Each publish writes the workflow to `<workflow ID>.json` as a portable bundle, or to the file that already holds it. Keys are sorted and indented, so Git diffs show only what changed. Files carry the draft and what it references: names of required variables (never values, so Secrets stay local), saved prompts and Agent presets. Versions, triggers and run history stay local.
- **A changed file updates the draft.** When a file changes, for example after `git pull`, Interlock imports it into the draft with the same rules as any import: ownership is checked, saved prompts are not overwritten, and changed Scripts wait for [approval](#approve-imported-scripts). It never publishes, starts runs or enables triggers. A variable it does not know is added without a value. Writing a file does not import it again.
- **Problems change nothing.** A file that is not valid JSON or not a valid bundle, or that cannot be imported, keeps the last good draft and shows under **Runs → Needs attention** with the file name and reason. Fixing the file clears it.

Conflicts:

- **The draft has unpublished edits, including a rename, and the file changed too.** The file is not imported. Publish or discard the draft to load the file, or restore the file. Publishing keeps your edits as a version and does not overwrite the changed file; the file then loads into the draft.
- **Two files hold the same workflow.** Neither is imported until one is removed.
- **A file is deleted.** The workflow stays. The next publish writes the file again.
- **The folder does not exist.** Interlock reports it and checks again every few seconds. It does not create the folder.

## Set up a board during import

When an import includes board suggestions, open **Board setup** in the preview. Choose **Create suggested board** to review the proposed columns, or **Use existing board** to choose a destination column for each stage. **Skip board setup** keeps any existing local board membership and stage mappings.

For CLI imports, use the [workflow import commands](cli.md#workflows) to preview suggestions and pass a setup file. The file contains a `requestId` and a `choices` array. Each choice identifies a `suggestionId` and includes `expectedBoards`, keyed by workflow ID with the current board ID or `null`. Use `action: "create"` to create the suggested board. For `action: "existing"`, also supply `boardId`, `expectedRevision`, and `stageColumns`, keyed first by workflow ID and then by stage ID.

## Share instructions

Saved **Prompts** hold instructions that Agent steps can reuse. Keep shared review criteria in a saved prompt and describe the specific assignment on each step.

Runs capture the prompt revisions they use. Editing a prompt can update future runs without changing the instructions already captured by active runs. Published workflows can also pin prompt revisions.

## Reuse configuration and secrets

**Variables** hold reusable configuration values and credentials. Reference them explicitly in Script environments or Fetch headers. Agents do not receive saved variables automatically.

Use **Secret** for credentials. Stored secret values have no read-back action, so rotate them by replacing the value. Keep credentials out of prompts, workflow inputs, and returned results.

Continue with [Build workflows](build-workflow.md) or [Run agents](agents.md).
