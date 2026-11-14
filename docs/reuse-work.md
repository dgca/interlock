---
title: Reuse work
description: Start from existing procedures and share workflows, prompts, and configuration.
---

# Reuse work

Keep repeated procedures, instructions and settings in one place so every workflow can use them. This page covers starters, Workflow steps and child workflows, importing workflows, imported Scripts, syncing with a repository folder, board setup on import, saved prompts and variables.

## Start from a workflow

The starter picker offers ready-made procedures, such as the **SDLC workflow**, which plans, builds and reviews a software change. An added starter becomes your own copy. Adding one does not start a run or replace an existing workflow. See [Starter workflows](starter-workflows.md).

To reuse a procedure inside another workflow, add a **Workflow** step that invokes it. For example, several procedures can share one review workflow instead of each keeping a copy of its steps. Choose whether the caller waits for its result or starts it independently.

## Create a child workflow

A child workflow is a helper that belongs to one parent. It stays out of the main library and appears in the parent's **Child workflows** tab.

1. In the parent, open **Add node**, choose **Workflow**, select **Create child workflow** and enter a name.
2. Choose **Save and create child**. Interlock saves the parent draft with the new node and opens the child editor.
3. Edit and publish the child.
4. Choose **Use v1 in [node name]** to pin that version in the parent draft and return to the parent.
5. Connect the node and publish the parent.

You can also create a child from the **Child workflows** tab with **New child**, without adding a node. Save or discard Raw edits before creating a child.

- A draft can reference an unpublished child, but publication is blocked until the reference has a version.
- Later child publications do not change existing pins. Choose a newer version in node settings or from the child editor.
- Only the owner can reference a child. A child can invoke library workflows but cannot own or reference other children.
- The child editor links back to its owner and has its own URL and **Runs** tab.

The UI cannot yet move a workflow between parents, search children from the main library, or clone a parent with its children. Parent clone is disabled, and a parent with children cannot be deleted: delete unreferenced children first. Agents can adopt, reparent or release workflows over MCP while keeping their IDs and history; see [ownership changes](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#change-workflow-ownership).

## Publish a shared workflow and its dependents

Ordinary publication, including **Review & publish**, keeps the version pins of every workflow that calls the published one. To advance the callers too, publish with cascade:

```sh
interlock publish CHILD_ID --cascade
```

MCP `publish_workflow` accepts `{"id": "CHILD_ID", "cascade": true}`, and the shared API accepts the same option.

- The cascade follows references in each workflow's latest published definition, including archived workflows and Workflow steps inside Batches.
- It republishes each dependent once, children before parents, and leaves unrelated pins alone. Draft-only workflows and references found only in older versions are not included.
- Every dependent draft must match its latest published definition. Publish or discard definition edits first.
- A dependency cycle or any validation failure rejects the whole operation, including the requested publication.
- Dependent drafts get new revisions, so an editor holding an older draft must reload before saving.

Existing versions keep their exact pins, and existing runs stay pinned unless their [run version policy](https://github.com/dgca/interlock/blob/main/docs/workflow-execution.md#move-a-run-to-a-newer-version) accepts the new version at a safe boundary. New runs use the new versions; starting an explicit older version still uses its original dependencies. Contracts are checked during execution, so test changed child behavior before cascading it.

To preview and apply a whole bundle from a repository, use `interlock import bundle.json --dry-run`, then `interlock import bundle.json --publish --cascade`; see the [workflow commands](cli.md#workflows).

## Import workflows

Open **Workflows → Import**. The dialog opens on bundled **Starters** and also accepts a public GitHub folder, a local file, or pasted JSON. Every source shows a preview first, and importing never starts a run.

1. Choose **GitHub folder**, paste an HTTPS `github.com/OWNER/REPO/tree/REF/FOLDER` link and choose **Find workflows**. Branch names with slashes and commit links work.
2. Review each workflow's description, source file and dependencies. Included dependencies are listed under a disclosure.
3. Select the workflows and choose **Import workflow**, or **Import N workflows** for several.

For **Paste JSON**, paste a legacy workflow or portable bundle and choose **Preview workflow**. Invalid JSON and validation errors keep your text so you can correct it. **Local file** uses the same import rules unless the host disables it.

Importing one workflow opens it. Importing several returns to the library with the new workflows highlighted.

### What import keeps and rejects

- Selections import together. An invalid selection, or an existing workflow with different draft content, metadata, ownership, published version or saved prompt, rejects the whole selection and changes nothing.
- Portable bundles keep their IDs and pins. Legacy files create a new workflow each time.
- Identical definitions are unchanged, and draft position-only differences update only the saved layout.
- Reimport keeps the workflow's board membership.
- Every included schedule is disabled and its revision advances, even on an identical reimport. Schedules left out of the bundle are unchanged. See [workflow schedules](https://github.com/dgca/interlock/blob/main/docs/schedules.md).
- Variable-bearing bundles need a local binding, or explicit unset provisioning, in the preview. Config and Secret values are never exported. See [workflow variables](https://github.com/dgca/interlock/blob/main/docs/variables.md).

### GitHub folder limits

| Limit        | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Repositories | Public only. Private access, recursion and automatic updates are not supported. |
| Files        | Direct JSON files in the folder, at most 50                                     |
| Size         | 2 MiB per response or file                                                      |
| Timeout      | 60 seconds per request                                                          |

Discovery pins the preview to a commit. Invalid files cannot be selected but do not hide valid ones. Rate-limit messages include retry timing when GitHub provides it.

If an import response is lost, check the library before retrying, especially for legacy files: the import may have completed. A confirmed rejection says **Nothing imported**.

## Approve imported Scripts

Script steps and polling Script checks run as your user. Interlock asks a person before an imported Script runs for the first time.

1. Before you import, read every Script in the import preview.
2. When a run reaches an imported Script, it waits on a **Needs attention** request that shows the code.
3. Choose **Approve and run**, or run `interlock approve-script RUN_ID EXECUTION_ID`.

Approval covers that exact code in that workflow. Later runs, and edits you make, do not ask again. Workflows and Scripts that existed before this check was added stay approved.

### Choose which Scripts need approval

Open **AI Settings → Execution settings → Script approval**, or run `interlock script-approval` to read the setting and `interlock script-approval MODE` to change it.

| Option                         | CLI mode             | Which Scripts wait                                                                            |
| ------------------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| **Imported Scripts**           | `imports`            | Scripts from imported workflows. Scripts you or a connected agent write run without approval. |
| **Imported and agent Scripts** | `imports_and_agents` | Also Script content an agent adds or changes over MCP.                                        |
| **Off**                        | `off`                | None. Every Script runs without approval.                                                     |

Only a person can approve Scripts or change this setting; MCP callers are refused.

### Permission policies

A workflow [permission policy](permission-policy.md) from an import, or one an agent writes over MCP, waits the same way under any setting except **Off**. A new run holds at its entry with an **Approve permission policy** request. `interlock approve-script` approves it too.

### Workspace hooks

Hooks of a [managed Git workspace](https://github.com/dgca/interlock/blob/main/docs/managed-workspaces.md#hooks) are Scripts for approval too. An imported hook that is not yet approved holds the run at its entry with an **Approve workspace hook** request, and no worktree is created until a person approves it.

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

An import can suggest a board for its workflows. In the browser, use **Board setup** in the import preview; see [Boards](workflow-boards.md#set-up-a-board-during-import) for the choices.

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
