# Use the SDLC workflow

The **SDLC workflow** starter takes a software change from a request to a reviewed commit, and optionally a pull request. It is three workflows: **SDLC workflow** plans, builds and delivers; **Plan review** reviews a plan with fresh context; **Change review** runs the check commands and then reviews the change with fresh context. It replaced the [original SDLC workflow](sdlc-workflow.md) in the starter picker; your copies of the original are unchanged.

## Add it

Open **Workflows → Import → Starters**, select **SDLC workflow**, choose whether to set up the suggested board, and choose **Add to library**. From the CLI: `interlock import-starter sdlc`. The earlier ID `sdlc-v2` still works. Nothing runs.

Each import publishes a new SDLC copy and its own copies of Plan review and Change review, owned by it and pinned to their version 1. Edit a helper and publish it, then update the SDLC step's pinned version to use your change. **Add another copy** creates another set of three. Each workflow keeps a permanent starter identity, so the picker finds your copy later; shipped template changes never overwrite it.

The steps need a coding agent with file access, Git and the repository's tools: a [managed executor](managed-executors.md) or a [connected agent](connect-harness.md). The plan and change reviewers need fresh context: a new session or an isolated subagent. Pull requests need the repository's own tooling and credentials.

## Start a change

```json
{
  "request": "Fix the importer dropping board membership on reimport (issue #403).",
  "repoPath": "/Users/me/code/app"
}
```

| Input             | Behavior                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`         | Required. What to change and why. Paste the issue text when there is one.                                                                      |
| `repoPath`        | Absolute path of the Git checkout. Required unless the workflow gives each run its own Git worktree, which then takes precedence.              |
| `size`            | `small` (default): plan, build, review. `standard`: adds a spec and an independent plan review before any code.                                |
| `issue`           | Optional issue URL or identifier, used for naming and in the pull request.                                                                     |
| `baseRef`         | Commit or branch to start from. Defaults to the checkout's `HEAD`.                                                                             |
| `taskDir`         | Directory for the spec and plan, relative to the checkout. Defaults to `.tasks/<slug>`.                                                        |
| `reviewPolicy`    | `auto` (default) asks a person only when the plan has open decisions or review cannot settle it. `always` asks a person to approve every plan. |
| `createPr`        | `false` by default. `true` pushes the branch and opens a pull request after the change passes review.                                          |
| `checkCommands`   | Up to six commands Interlock runs before every review. When omitted, the plan proposes them and they run without a prompt.                     |
| `commitArtifacts` | `false` by default. `true` commits the spec and plan with the change.                                                                          |

## How a change moves

1. **Setup.** A Script resolves the checkout, the base commit and the task folder. No agent is needed.
2. **Spec** (standard only) and **plan**, written by one author session (`author` continuity group). The plan owns the acceptance criteria and names up to six check commands, unless the `checkCommands` input pins them. Open decisions go to a person.
3. **Plan approval.** A plan without open decisions goes to the build (small, `auto`) or to **Plan review** (standard). Plan review findings go back to the plan. A person approves, answers or asks for changes, or stops, through Human input; approval covers only the plan text they were shown.
4. **Build.** The author session implements and commits. It runs only focused tests, because Change review runs the full checks. If it needs a decision on scope, public behavior, compatibility or authorization, it returns its questions and a person answers in a text field.
5. **Change review.** Its `checks` Script runs the plan's check commands at the built commit, retrying a failure once and reporting a pass on retry as flaky. One fresh reviewer then gets the exit codes and output, checks each criterion and the diff, and does not rerun passing checks. A Script applies the verdict rules. Each finding has an owner:
   - `implementation` findings go back to the build, which reports a resolution for each.
   - `plan` findings go back to planning.
   - `environment` findings, for checks that fail for reasons the change did not cause, need proof and never hold the change.

   Notes that only apply after delivery, such as the pull request description, are limitations starting with "For delivery:", not findings.

6. **Delivery.** A Script confirms the checkout is still at the reviewed commit. With `createPr`, an agent pushes and opens the pull request; it does not wait for CI. The [pull request watcher](pr-watcher.md) can take over from there.

### Limits

Every loop has a limit, and a person decides what happens next:

| Loop                  | Limit | Then                                                                     |
| --------------------- | ----- | ------------------------------------------------------------------------ |
| Plan reviews          | 2     | Plan approval: approve as it stands, request changes or stop.            |
| Build question rounds | 3     | The limit checkpoint: continue with the build's recommendations or stop. |
| Review rounds         | 3     | The limit checkpoint: allow three more rounds or stop.                   |
| Failed check commands | 1     | Retry per command; the reviewer then judges the failure.                 |

Review rounds and question rounds share one checkpoint, **Continue past the limit?**, which shows why it was reached. Agent results that break their contract are rejected with diagnostics and corrected under the same claim; contracts avoid `allOf`, conditionals and lookaround so every harness can satisfy them.

## Read the result

`outcome` says what was delivered and `verification` what was proven:

| Field                      | Values                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`                  | `local_complete`, `pr_created`, `delivery_blocked` (a pull request was requested but not opened) or `stopped`.                              |
| `verification`             | `passed` when the reviewed commit passed review, `incomplete` when the change stopped first.                                                |
| `branch`, `reviewedCommit` | Where the reviewed change is.                                                                                                               |
| `prUrl`                    | The pull request, or `null`.                                                                                                                |
| `limitations`              | Minor findings left open, missing checks, "The pull request's own CI had not finished when this workflow ended.", and the reviewer's notes. |

## Test your edits

Each workflow can be checked with [fixture simulation](workflow-simulation.md), including the Human input steps: a `kind: "input"` fixture supplies the person's answer. Interlock's own saved cases, in `tests/fixtures/sdlc-v2-suites.json` in the repository, traverse every edge of all three workflows; each entry is keyed by the bundle ID of the workflow it tests. Save an entry with `save_test_suite` against your copy of that workflow and run it after an edit.

## Run with few approvals

On a default import, every Agent action asks a person, but the check commands Interlock runs before each review do not: they run as a Script with your permissions, not as an Agent action. When the plan chooses them and `reviewPolicy` is `auto` on a small change, nobody sees them before they run. Pin them with the `checkCommands` input, or use `reviewPolicy: "always"` to approve each plan first; plan approval lists the commands.

A managed Agent session with **Standard** permissions asks a person before it edits a file or runs a command. The starter ships a conservative [permission policy](permission-policy.md) on **SDLC workflow** and a narrower one on **Change review**. They allow routine reading, editing and Git bookkeeping without asking. **Plan review** runs its reviewer with **Read only** permissions, which a policy never widens. A policy applies only inside a run's own [Git worktree](managed-workspaces.md), so turn that on first:

1. Open **SDLC workflow**, then **Workflow settings**.
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

Without the worktree setting, a run must start from a checkout with no uncommitted changes to tracked files, so the checks test what was committed; the setup step refuses otherwise. A review round whose check commands were skipped cannot pass, and the result never reports `verification: "passed"` for it.

## Compare v2 with the original

A paired live run on the same brief shows whether v2 earns its place. Interlock has not made one yet. To run one:

1. **Repositories.** Make two clones of the target repository at the same commit, one per arm, so the arms never share a checkout.
2. **Workflows.** Add the SDLC starter, which is v2, and import the original from `workflows/sdlc.json` and publish it. In the v1 copy, change nothing. In the v2 SDLC copy, turn on **Give each run its own Git worktree** with the v2 clone as the repository and the shared commit as the start ref, and publish. Leave the shipped policies as they are.
3. **Executor.** Use one managed profile for both arms, for example Codex with model `gpt-6.1-sol`, effort `medium` and **Standard** permissions, and select it as the executor of v1, v2 SDLC, Plan review and Change review.
4. **Start** each arm with MCP `start_run` (or `interlock start`) and the same brief:

   v1:

   ```json
   {
     "workflowId": "V1_WORKFLOW_ID",
     "requestId": "sdlc-compare-v1-1",
     "tags": { "experiment": "sdlc-v2", "arm": "v1" },
     "input": {
       "request": "BRIEF",
       "repoPath": "/path/to/clone-v1",
       "taskDir": ".tasks/compare",
       "reviewPolicy": "auto",
       "createPr": false
     },
     "budget": {
       "scope": "tree",
       "limits": {
         "claims": { "max": 30, "warnAt": 24 },
         "cost": {
           "currency": "USD",
           "threshold": { "max": 5000000, "warnAt": 4000000 }
         }
       }
     }
   }
   ```

   v2: the same, with `"workflowId": "V2_SDLC_WORKFLOW_ID"`, `"requestId": "sdlc-compare-v2-1"`, `"arm": "v2"`, no `repoPath` (the worktree setting supplies the checkout) and `"size": "small"` or `"standard"` to match the brief.

   `scope: "tree"` counts Plan review and Change review runs too. The cost maximum is in millionths of the currency: `5000000` is USD 5. `unknownUsage` defaults to `allow`. Claude Code and Codex costs are derived from token counts with the run's price table; see [run budgets](run-budgets.md).

5. **Answer requests** in **Runs → Needs attention** as a person would. Approve routine permission requests only after reading them; answer workflow questions the same way in both arms.
6. **Freeze and probe.** When both runs end, check each arm's final commit with the same independent probe: a test or script written for the brief that neither workflow saw.

Compare, per arm:

| Measure                           | Where                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Accepted by the independent probe | Your probe, run at each arm's final commit.                                             |
| Approvals asked and auto-allowed  | `workflow_report` `approvals` (the report's **Permission approvals** section), per run. |
| Tokens and cost                   | `get_run_usage`: input, cached input and output tokens, and reported or derived cost.   |
| Review rounds                     | The number of `review` (v1) or `changeReview` (v2) executions in `get_run` `full:true`. |
| Assignments                       | `get_run_budget`: the claim count against the 30-claim limit.                           |
| Wall time                         | The run's start and end times in `get_run`; note separately how long it waited for you. |

A long run's `get_run` response can drop older executions above 64 KiB; pass `full: true` to count every round.

A run that reaches its budget waits and appears in **Runs → Needs attention** as **Run budget reached**. Record that as the arm's outcome rather than raising the limit.

## Existing libraries

Adding this starter never changes copies of the original SDLC workflow. The picker does not count an original copy as a copy of this starter, so it offers **Add to library**; a copy added earlier as SDLC workflow v2 shows **Open workflow**. See [starter workflows](starter-workflows.md).
