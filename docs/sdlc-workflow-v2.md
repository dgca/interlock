# Use the SDLC workflow v2

## Run with few approvals

A managed Agent session with **Standard** permissions asks a person before it edits a file or runs a command. SDLC v2 ships a conservative [permission policy](permission-policy.md) on **SDLC workflow v2** and a narrower one on **Change review**. They allow routine reading, editing and Git bookkeeping without asking. **Plan review** runs its reviewer with **Read only** permissions, which a policy never widens. A policy applies only inside a run's own [Git worktree](managed-workspaces.md), so turn that on first:

1. Open **SDLC workflow v2**, then **Workflow settings**.
2. Turn on **Give each run its own Git worktree** and enter the absolute path of your repository. Keep the branch template's `{runId}`.
3. Publish.

Each run then works on its own `interlock/<run id>` branch in a worktree under the Interlock data folder, and the builder commits on that branch. Plan review and Change review run in the same worktree, because invoked workflows share their caller's. `repoPath` is not needed while the setting is on. Without it, supply `repoPath`; every Agent action then asks, as before.

When the run finishes, Interlock removes the worktree and keeps the branch. Planning notes in the task folder are untracked unless `commitArtifacts` is on; if the repository does not ignore that folder, Interlock keeps the worktree instead of deleting them. Ignore the folder (for example `.tasks/`) or remove the kept worktree yourself.

### First run

The bundled starter's policies apply on its first run without an approval step. Approval is needed when a policy arrives another way: a run of a copy imported from `workflows/sdlc-v2.json`, or a run after an agent changed a policy or the worktree setting over MCP, waits at its entry with an **Approve permission policy** request in **Review**. Your own edit in **Workflow settings** applies without approval.

### What the policies allow

| Rule                                                                                                                                                                               | SDLC | Change review | Why                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`                                                                                                                                                                             | Yes  | Yes           | Agents read files only inside the worktree.                                                                                                                                                                                                                                                                         |
| `edit`                                                                                                                                                                             | Yes  | No            | The author writes the spec, plan and code. The reviewer must not change what it reviews. Interlock always asks before anything under `.git` is edited.                                                                                                                                                              |
| `git status`, `git diff`, `git log` (with or without arguments), `git show *`, `git blame *`, `git rev-parse *`, `git ls-files *`, `git merge-base *`, `git branch --show-current` | Yes  | Yes           | Read-only Git. They run a program only if your own Git configuration names one (an external diff or text conversion), which an agent cannot edit under this policy. Interlock asks for `--ext-diff`, `-c` and `-C`.                                                                                                 |
| `git add *`, `git commit *`                                                                                                                                                        | Yes  | No            | The builder commits its work for review. `git commit` runs the repository's commit hooks. If your hooks live in the tree (for example `core.hooksPath` set to `.husky`), an agent can edit them and they run on its next commit: that is code execution. Remove `git commit *` for such repositories, or accept it. |
| `ls`, `pwd`, `cat *`, `head *`, `tail *`, `wc *`, `rg *`, `grep *`, `find *`                                                                                                       | Yes  | Yes           | Reading and searching. Every path argument must stay inside the worktree. Interlock asks for `find -exec`, `-delete` and `-fprint`, and `rg --pre`.                                                                                                                                                                 |

Neither policy has a rule for package managers, test runners, `node`, `sed`, `awk` or `git push`: each can run arbitrary code (`pnpm test` runs whatever the repository's test script does, `sed` has an `e` command). `git grep` is also left out, because its `-O` option opens files with a program you name. When an agent runs a focused test, it asks.

The workflows avoid most of those requests by design:

- Change review's `checks` Script runs the plan's check commands before every review. Scripts run as Interlock, not as an agent, so they need no approval. The builder is told not to run the full list, and the reviewer is told not to rerun passing checks.
- Every agent is told to run plain commands: no heredocs, `$` variables or command substitution, `cd`, `bash -c` or background jobs, and no files outside the repository such as `/tmp`. Interlock asks for all of those. Agents read with `cat`, `head`, `tail`, `rg` or `git show` rather than `sed` or `awk`.
- Every file the workflow writes stays in the worktree: notes and scratch files go in the task folder.

To allow your repository's own commands, add rules such as `{ "kind": "command", "pattern": "pnpm test *" }` in **Workflow settings → Permission policy**. Treat each as code execution: an agent that can edit files can change what the command runs. See [the policy's limits](permission-policy.md#limits).

The plan proposes the check commands from the repository's own instructions, and Interlock runs them without asking. Use `reviewPolicy: "always"` to read the plan, including its verification section, before any code is written.
