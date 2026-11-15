---
title: Starter workflows
description: Add a bundled workflow to your library, or import workflows from GitHub, a file or JSON.
---

# Starter workflows

Starters are ready-made workflows that ship with Interlock. Add one when you want a working procedure without building it yourself. They work offline and need no developer checkout.

New libraries start empty. Upgrades never add, replace or change workflows in your library.

## Add a starter

1. Open **Workflows → Import**, or choose **Browse starter workflows** in an empty library.
2. Choose **Starters** and select one.
3. Review its purpose and requirements.
4. For **SDLC workflow**, choose a board setup (see below).
5. Choose **Add to library**.

Interlock creates and publishes your own copy. It does not start a run. Edit, publish, archive or delete the copy like any other workflow.

## The four starters

| Starter                          | ID                    | What it does                                                                                       | You need                                                             |
| -------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **SDLC workflow**                | `sdlc`                | Plans, builds and reviews a software change. Brings its own **Plan review** and **Change review**. | A coding agent and a fresh reviewer.                                 |
| **Pull request watcher**         | `pr-watcher`          | Experimental. Fixes failing checks and trusted review comments on a GitHub pull request.           | `gh` signed in, a coding agent and a fresh reviewer.                 |
| **Evaluate workflow comparison** | `evaluate-comparison` | Grades retained comparison results against a fixed rubric.                                         | A completed workflow comparison. Review mode needs a fresh reviewer. |
| **GitHub issue intake**          | `github-issue-intake` | Experimental. Starts one run of your workflow per open issue that has your label.                  | A `github_token` Secret, and a schedule you create.                  |

More detail for each:

- [SDLC workflow](https://github.com/dgca/interlock/blob/main/docs/sdlc-workflow-v2.md). Each copy gets its own published **Plan review** and **Change review**, owned by that copy. All three follow your default agent permissions, which are Full access until you choose one. Plan review and Change review ship with a read-only permission policy. Under Standard, every Agent action asks a person until you turn on the workflow's Git worktree. Plan check commands run unprompted; pin them with `checkCommands`.
- [Pull request watcher](https://github.com/dgca/interlock/blob/main/docs/pr-watcher.md). Gets its own copy of SDLC's **Change review**. Its one outward action is pushing reviewed fixes to the pull request's branch. It never force-pushes and never pushes to the default branch.
- [Evaluate workflow comparison](https://github.com/dgca/interlock/blob/main/docs/workflow-evaluation.md). Reads the results of a [workflow comparison](testing-workflows.md#compare-two-published-versions).
- [GitHub issue intake](https://github.com/dgca/interlock/blob/main/docs/integration-starters.md). On each issue it starts, it removes your label and adds a picked-up label. Adding it creates the `github_token` Secret without a value, or reuses one an earlier copy created. Set the value in **Variables** before the first run. It does not create an automation; add the schedule yourself.

## Set up a board for SDLC

SDLC suggests a **Software development** board with **Planning**, **Implementation**, **Review** and **Delivery** columns. When you add it, choose one:

- **Create suggested board**: create the board with those columns.
- **Use existing board**: map each stage to a column on a board you have.
- **Skip board setup**: add the workflow without a board. It still runs.

Board setup needs a new copy. See [Set up a board during import](reuse-work.md#set-up-a-board-during-import).

## Add a second copy

A starter you already added shows **Open workflow**. To create another copy on purpose, select **Add another copy** before adding.

- Existing copies are never overwritten or republished.
- A recognized copy that you never published stays a draft. Review and publish it on its workflow page.
- After you delete a copy, the starter stays absent until you import it again.
- A newer Interlock version may ship an updated starter. It changes what you can add, never your copies.

## Import from other sources

The same **Import** dialog also takes a GitHub folder, a local file or pasted JSON. See [Import workflows](reuse-work.md#import-workflows).

## CLI and MCP

```sh
interlock starters
interlock import-starter sdlc
interlock import-starter pr-watcher
interlock import-starter evaluate-comparison --copy --request-id review-copy-1
interlock import-starter github-issue-intake
interlock import-starter sdlc --board-setup @setup.json
```

- Without `--copy`, a known existing copy is returned instead of a new one.
- `--copy` asks for another copy. Board setup needs it when a copy already exists.
- Without `--request-id`, the CLI uses the board setup's `requestId`, or generates a key. Pass your own key and reuse it when you retry an uncertain import.
- `sdlc-v2` still selects the SDLC starter.

In MCP, list starters with `list_workflows`:

```json
{ "source": "starters" }
```

The default `list_workflows` call still lists your library. Each choice has its metadata, references to existing copies and the ID of its suggested board. Add `"starterId"` to read one choice with its full board setup. Choices never include definitions or prompts.

Import with `import_workflows`:

```json
{ "starterId": "sdlc", "requestId": "sdlc-import-1" }
```

Add `"copy": true` and a new key for another copy. With `boardSetup`, use the starter's `requestId` for both keys. See [board setup choices](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#choose-board-setup-on-import).

## Reference

### How copies are recognized

Interlock records which starter each imported copy came from. Edits and renames keep that link.

- Older manual copies are recognized by their current draft or a retained published version. Canvas positions and declaration order are ignored.
- Copies added as `sdlc-v2` count as SDLC copies.
- Copies of the original SDLC starter, which the picker no longer offers, do not. They stay unchanged, and adding SDLC creates a new copy beside them. The original is still importable from [`workflows/sdlc.json`](https://github.com/dgca/interlock/blob/main/docs/sdlc-workflow.md#import-the-original-workflow).
- A copy that was changed and renamed, with no retained matching version, cannot be recognized reliably.
- A display name alone never identifies a copy.
- Definitions that do not match the current schema are skipped during recognition. They stay unchanged and do not block starters. Other drafts and versions can still identify a copy.

### Request keys and retries

| Rule                 | Value                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| Key format           | Nonblank, opaque, case- and whitespace-sensitive, at most 120 characters   |
| Same key, same input | Returns the same copy, even after a restart                                |
| Conflicting reuse    | Rejected                                                                   |
| Deleted result       | Retrying a key whose copy was deleted is rejected                          |
| Failed creation      | Leaves no receipt; the key is not marked as used                           |
| Atomicity            | The receipt is saved together with creation, publication and copy tracking |

Interlock never changes a key to hide an uncertain history.

### Where this is stored

Copy links and retry receipts live in the library database. They survive ordinary deletion and a full database backup and restore. Portable bundles hold workflow definitions, not import history. Replacing the database, or restoring an older backup, loses the records that database does not hold.
