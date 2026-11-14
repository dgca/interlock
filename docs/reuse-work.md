---
title: Reuse work
description: Start from existing procedures and share workflows, prompts, and configuration.
---

# Reuse work

Keep repeated procedures, instructions and settings in one place so every workflow can use them. This page covers starters and Workflow steps, imported Scripts, syncing workflows with a repository folder, board setup on import, saved prompts and variables.

## Start from a workflow

The starter picker offers ready-made procedures, such as the **SDLC workflow**, which plans, builds and reviews a software change. An added starter becomes your own copy. Adding one does not start a run or replace an existing workflow. See [Starter workflows](starter-workflows.md).

To reuse a procedure inside another workflow, add a **Workflow** step that invokes it. For example, several procedures can share one review workflow instead of each keeping a copy of its steps. Choose whether the caller waits for its result or starts it independently.

## Approve imported Scripts

Script steps and polling Script checks run as your user. Interlock asks a person before an imported Script runs for the first time.

1. Before you import, read every Script in the import preview.
2. When a run reaches an imported Script, it waits on a **Needs attention** request that shows the code.
3. Choose **Approve and run**, or run `interlock approve-script RUN_ID EXECUTION_ID`.

Approval covers that exact code in that workflow. Later runs, and edits you make, do not ask again. Workflows and Scripts that existed before this check was added stay approved.

### Choose which Scripts need approval

Open **Settings → AI → Execution settings → Script approval**, or run `interlock script-approval` to read the setting and `interlock script-approval MODE` to change it.

| Option                         | CLI mode             | Which Scripts wait                                                                            |
| ------------------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| **Imported Scripts**           | `imports`            | Scripts from imported workflows. Scripts you or a connected agent write run without approval. |
| **Imported and agent Scripts** | `imports_and_agents` | Also Script content an agent adds or changes over MCP.                                        |
| **Off**                        | `off`                | None. Every Script runs without approval.                                                     |

Only a person can approve Scripts or change this setting; MCP callers are refused.

### Permission policies

A workflow [permission policy](permission-policy.md) from an import, or one an agent writes over MCP, waits the same way under any setting except **Off**. A new run holds at its entry with an **Approve permission policy** request. `interlock approve-script` approves it too.

## Sync workflows with a repository folder

Sync keeps workflow files in a folder of your repository, so you can review workflow changes in pull requests. Publishing writes a file; a changed file, for example after `git pull`, updates the draft.

1. Pick or create a folder in your repository, for example `workflows`. Interlock does not create it.
2. Start Interlock with `INTERLOCK_SYNC_DIR` set to that folder:

   ```sh
   INTERLOCK_SYNC_DIR=./workflows interlock
   ```

3. Publish a workflow. Interlock writes it to `<workflow ID>.json`.
4. Commit the file and open a pull request as usual.

Sync is off when the variable is unset.

### What publishing writes

- Each publish writes the workflow as a portable bundle to `<workflow ID>.json`, or to the file that already holds it.
- Keys are sorted and indented, so Git diffs show only what changed.
- A file holds the draft and what it references: names of required variables (never values, so Secrets stay local), saved prompts and Agent presets.
- Versions, triggers and run history stay local.
- Publishing replaces a file only when it holds exactly what Interlock last wrote or loaded. Any other edit to the file is kept and reported.

### What a changed file does

When a file changes, Interlock imports it into the draft with the same rules as any import:

- ownership is checked;
- saved prompts are not overwritten;
- changed Scripts wait for [approval](#approve-imported-scripts);
- a variable it does not know is added without a value.

It never publishes, starts runs or enables triggers. Writing a file does not import it again.

### Problems and conflicts

A problem never changes the draft. Interlock keeps the last good draft and reports the file name and reason under **Runs → Needs attention**. Fixing the file clears the report.

| Situation                                                                     | What happens                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File is not valid JSON, not a valid bundle, or cannot be imported             | Reported; the draft is unchanged.                                                                                                                                                                                           |
| File is a symbolic link, or larger than 5 MiB                                 | Not read; reported.                                                                                                                                                                                                         |
| The draft has unpublished edits (including a rename) and the file changed too | The file is not imported. Publish the draft or undo its edits to load the file, or restore the file. Publishing keeps your edits as a version, does not overwrite the changed file, and then loads the file into the draft. |
| Two files hold the same workflow                                              | Neither is imported until one is removed.                                                                                                                                                                                   |
| A file is deleted                                                             | The workflow stays. The next publish writes the file again.                                                                                                                                                                 |
| The folder does not exist                                                     | Reported. Interlock checks again every few seconds.                                                                                                                                                                         |

When sync is first turned on, a name or description that differs from the file counts as an unpublished edit.

## Set up a board during import

When an import includes board suggestions, open **Board setup** in the preview and choose one:

- **Create suggested board**: review the proposed columns and create the board.
- **Use existing board**: choose a destination column for each stage.
- **Skip board setup**: keep any existing local board membership and stage mappings.

From the CLI, preview suggestions with `interlock import @workflow.json --dry-run` (or `interlock starters`), then pass a setup file with `--board-setup`. See the [workflow commands](cli.md#workflows).

```json
{
  "requestId": "import-board-1",
  "choices": [
    {
      "suggestionId": "SUGGESTION_ID",
      "action": "create",
      "expectedBoards": { "WORKFLOW_ID": null }
    }
  ]
}
```

- Each choice names a `suggestionId` and `expectedBoards`: the current board ID, or `null`, keyed by workflow ID.
- `action: "create"` creates the suggested board. An optional `name` renames it.
- `action: "existing"` also needs `boardId`, `expectedRevision` and `stageColumns`, keyed by workflow ID and then stage ID.

## Share instructions

Saved **Prompts** hold instructions that Agent steps can reuse. Keep shared review criteria in a saved prompt, and describe the specific assignment on each step.

Runs capture the prompt revisions they use. Editing a prompt can update future runs without changing what active runs already captured. Published workflows can also pin prompt revisions.

## Reuse configuration and secrets

**Variables** hold reusable configuration values and credentials. Reference them explicitly in Script environments or Fetch headers. Agents do not receive saved variables automatically.

Use a **Secret** for credentials. Secret values cannot be read back, so rotate one by replacing its value. Keep credentials out of prompts, workflow inputs and returned results.

Continue with [Build workflows](build-workflow.md) or [Run agents](agents.md).
