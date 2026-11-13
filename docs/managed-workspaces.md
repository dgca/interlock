# Give each run its own Git worktree

Set `workspace` on a workflow so that each run works in its own Git worktree on a new branch. Two runs against the same repository then never share a checkout. Workflows without `workspace` behave as before.

In the editor, open **Workflow settings** and turn on **Give each run its own Git worktree**. In a definition:

```json
{
  "workspace": {
    "repository": "/Users/me/code/app",
    "baseRef": "main",
    "branch": "agent/{runId}",
    "retention": "keep_on_failure",
    "hooks": {
      "afterCreate": { "command": "npm ci" },
      "beforeRemove": { "command": "git push origin HEAD" }
    }
  }
}
```

| Field        | Default             | Meaning                                                                                                                                                                            |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository` | required            | Absolute path of the repository root.                                                                                                                                              |
| `baseRef`    | `HEAD`              | Branch, tag or commit the new branch starts from.                                                                                                                                  |
| `branch`     | `interlock/{runId}` | New branch name. It must contain `{runId}`, so each run gets its own branch, and may use letters, digits, `.`, `_`, `-` and `/`.                                                   |
| `retention`  | `remove`            | When the run tree is quiescent: `remove` the worktree, keep it only if the run failed (`keep_on_failure`; a cancelled run is still removed), or always `keep` it.                  |
| `hooks`      | none                | `afterCreate` and `beforeRemove`, each `{ language, command, timeoutMs }`. The language defaults to Bash, as for Script nodes, and `timeoutMs` defaults to 60000 (maximum 600000). |

## Where runs work

The worktree is created under the Interlock data folder, beside the database, at `workspaces/<run id>`. The run starts its first step once the worktree is ready. If creation fails, that step fails with the Git error.

Agent and Script nodes, including polling Script checks, use the first of these that is set:

1. the node's own `cwd`
2. the run's worktree
3. the workflow's `cwd`

Agent work reports the worktree as `resolvedCwd`. Managed executors always accept the workspaces folder, even when `allowedRoots` is configured. Agent nodes in a [continuity group](context-continuity.md) keep the directory their session started in, which is the same worktree.

These runs share the worktree of the run that owns it:

- Batch items and Parallel branches.
- Continue-as-new runs share the first run's worktree.
- Invoked workflows, waited or detached, share their caller's worktree unless their own definition sets `workspace`, in which case they get their own.

Local Git trial comparisons use their trial checkout instead, and simulations create no worktree.

## Branches and your checkout

Interlock runs Git with argument lists, never through a shell, and with repository hooks turned off. It only creates new branches. A run fails if its branch already exists and that run did not create it. Interlock never changes your own checkout and never resets or deletes a branch. Removing a worktree keeps its branch and commits, so push or merge them as usual; delete branches you no longer need yourself.

## Cleanup

Interlock removes the worktree after the run tree is finished and [quiescent](events.md): no active or revoked claims, managed executions, or local or background operations remain. After cancelling a run tree in which an agent still held a claim, confirm that the claim stopped with `manage_work_resources` `release` (`confirmStopped: true`). The worktree is then removed. Removal discards uncommitted changes in the worktree.

Interlock only deletes a directory that sits directly inside the workspaces folder, is not a symlink, and has a matching ownership marker (`<run id>.owner.json`). Other directories there are never touched. At startup, Interlock:

- treats interrupted preparations as failed and retries interrupted removals
- removes marked worktrees that no record keeps
- runs `git worktree prune` in the repositories it tracks

If you retry a failed run, it reuses the worktree it kept, or creates a new one on the run's existing branch.

## Hooks

Hooks run in the worktree with `INTERLOCK_RUN_ID` and `INTERLOCK_WORKSPACE_PATH`, `_BRANCH`, `_REPOSITORY` and `_BASE_COMMIT` set. They also receive the same values as JSON on standard input. Their output is ignored.

- **`afterCreate`** runs before the run's first step. If it fails, preparation fails.
- **`beforeRemove`** runs before a ready worktree is removed. If it fails, the worktree is still removed and the error is recorded.

Hooks are Scripts for trust purposes. Import review lists them, and [Script approval](reuse-work.md#approve-imported-scripts) applies to them. If an imported hook is not approved yet, the run waits at its entry with an ordinary **Approve imported Script** request, and no worktree is created until a person approves it. Interlock never runs an unapproved hook. If a hook changes in a later version and is no longer approved, preparation fails, and removal keeps the worktree.
