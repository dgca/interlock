# Use the SDLC workflow v2

**SDLC workflow v2** takes a software change from a request to a reviewed commit, and optionally a pull request. Compared with the [original SDLC workflow](sdlc-workflow.md), Interlock checks each build and runs the check commands itself, two fresh reviewers work in parallel, review findings go back to the step that owns them, and a person is asked through native Human input whenever a decision or limit needs one. The original starter stays available and your copies of it are unchanged.

## Add it

Open **Workflows → Import → Starters**, select **SDLC workflow v2**, choose whether to set up the suggested board, and choose **Add to library**. This creates and publishes a copy without starting a run. From the CLI: `interlock import-starter sdlc-v2`.

The steps need a coding agent with file access, Git and the repository's tools: a [managed executor](managed-executors.md) or a [connected agent](connect-harness.md). The plan review and both change reviewers need fresh context: a new session or an isolated subagent. Pull requests need the repository's own tooling and credentials.

## Start a change

```json
{
  "request": "Fix the importer dropping board membership on reimport (issue #403).",
  "repoPath": "/Users/me/code/app"
}
```

| Input             | Behavior                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`         | Required. What to change and why. Paste the issue text when there is one.                                                                           |
| `repoPath`        | Absolute path of the Git checkout. Required unless the workflow gives each run its own Git worktree, which then takes precedence.                   |
| `size`            | `small` (default): plan, build, review. `standard`: adds a written spec and an independent plan review before any code.                             |
| `issue`           | Optional issue URL or identifier, used for naming and in the pull request.                                                                          |
| `baseRef`         | Commit or branch to start from. Defaults to the checkout's `HEAD`.                                                                                  |
| `taskDir`         | Directory for the spec, plan and notes, relative to the checkout. Defaults to `.tasks/<slug>`.                                                      |
| `checkCommands`   | Up to six commands that must exit 0. Interlock runs them after each build. When omitted, the plan proposes them from the repository's instructions. |
| `reviewPolicy`    | `auto` (default) asks a person only about open decisions or when review cannot settle the plan. `always` asks a person to approve every plan.       |
| `createPr`        | `false` by default. `true` pushes the branch and opens a pull request after the change passes review.                                               |
| `commitArtifacts` | `false` by default. `true` commits the spec and plan with the change.                                                                               |

## How a change moves

1. **Setup.** A Script resolves the checkout, the base commit and the task folder. No agent is needed.
2. **Spec** (standard only) and **plan**, written by one author session. The plan names the acceptance criteria and the check commands. Open decisions go to a person.
3. **Plan approval.** Under `auto`, a plan without open decisions goes straight to the build (small) or to a fresh plan reviewer (standard). Plan review findings go back to the spec or the plan. A person approves, asks for changes or stops; approval covers only the plan text they were shown.
4. **Build.** The same author session implements and commits. If it needs a decision mid-build, it returns its questions and a person answers them in a text field.
5. **Verify.** A Script checks the build result (the commit exists, descends from the base, is checked out, and nothing tracked is left uncommitted), then runs the check commands once at that commit. A failing command is retried once; a pass on retry is reported as flaky. Failing checks go back to the build once; after that, the reviewers decide whether the change caused them.
6. **Review.** A criteria reviewer and a code reviewer run in parallel, each with fresh context. The criteria reviewer reports every acceptance criterion as verified, unverified or a gap. The code reviewer looks at regressions, security, tests, conventions and documentation. Notes about the pull request go to `deliveryNotes`, not findings. Each finding has an owner:
   - `spec` or `plan` findings go back to that step; on a small change, spec findings go to the plan.
   - `build` findings go back to the build, which reports a resolution for each.
   - `environment` findings, for checks that fail for reasons the change did not cause, need proof and never hold the change.
7. **Delivery.** A Script confirms the checkout is still at the reviewed commit. With `createPr`, the author session pushes and opens the pull request; it does not wait for CI.

### Limits

Every loop has a limit. When one is reached, a person decides whether to continue or stop; failing checks are the exception, and go to the reviewers instead.

| Loop                        | Limit                                   |
| --------------------------- | --------------------------------------- |
| Plan result corrections     | 2, then plan approval                   |
| Plan reviews (standard)     | 3, then plan approval                   |
| Build result corrections    | 2                                       |
| Build question rounds       | 3                                       |
| Builds after failing checks | 1, then the reviewers judge the failure |
| Reviewer result corrections | 1 rerun of both reviewers               |
| Review rounds               | 3; continuing allows 3 more             |

A result correction is how the workflow repairs an agent result it cannot use, such as a plan file that does not exist or a commit that is not checked out. Contracts are kept simple so agents rarely fail them, and a Script explains what to fix instead of an open-ended retry.

### Context

Spec, plan, build and pull request steps share one continuity group, `author`, so they continue one session. The plan reviewer and both change reviewers use fresh context and no continuity group. Reviewers get the check results instead of rerunning passing checks.

## Read the result

The result keeps what was proven apart from what was done with it:

```json
{
  "outcome": "finished",
  "summary": "…",
  "taskDir": ".tasks/fix-reimport-3f2a1c",
  "verification": {
    "status": "passed",
    "baseCommit": "…",
    "reviewedCommit": "…",
    "reviewRounds": 2,
    "checksPassed": true,
    "checks": [
      {
        "command": "pnpm test",
        "status": "passed",
        "exitCode": 0,
        "attempts": 1
      }
    ],
    "criteria": [{ "id": "AC1", "status": "verified", "evidence": "…" }],
    "openFindings": [],
    "notes": []
  },
  "delivery": {
    "status": "pr_opened",
    "branch": "interlock/…",
    "prUrl": "https://github.com/…",
    "ci": "not_awaited",
    "notes": [
      "The pull request's own CI had not finished when this workflow ended."
    ]
  }
}
```

`outcome` is `finished` or `stopped`. `verification.status` is `passed`, `incomplete` (stopped after a review) or `not_reviewed`. `delivery.status` is `local`, `pr_opened`, `blocked` (a pull request was requested but not opened) or `not_attempted`. Minor findings left open are in `verification.openFindings`.

## Test changes to the workflow

`tests/sdlcStarterV2.test.ts` in the Interlock repository drives every edge of the template with scripted agent results and human answers against a temporary Git repository. MCP `workflow_simulation` cannot run this workflow, because fixture simulation does not support Parallel or Human input nodes; use a live run or comparison for your own copy.

## Run with few approvals

A managed Agent session with **Standard** permissions asks a person before it edits a file or runs a command. SDLC v2 ships a conservative [permission policy](permission-policy.md) that allows routine reading, editing and Git bookkeeping without asking. The policy applies only inside a run's own [Git worktree](managed-workspaces.md), so turn that on first:

1. Open the workflow, then **Workflow settings**.
2. Turn on **Give each run its own Git worktree** and enter the absolute path of your repository. Keep the branch template's `{runId}`.
3. Publish.

Each run then works on its own `interlock/<run id>` branch in a worktree under the Interlock data folder. `repoPath` is ignored while the worktree setting is on. Without it, supply `repoPath`; every Agent action then asks, as before.

When the run finishes, Interlock removes the worktree and keeps the branch. Planning notes in the task folder are untracked unless `commitArtifacts` is on; if the repository does not ignore that folder, Interlock keeps the worktree instead of deleting them. Ignore the folder (for example `.tasks/`) or remove the kept worktree yourself.

### First run

The bundled starter's policy applies on its first run without an approval step. Approval is needed when the policy arrives another way: a run of a copy imported from `workflows/sdlc-v2.json`, or a run after an agent changed the policy or worktree setting over MCP, waits at its entry with an **Approve permission policy** request in **Review**. Your own edit in **Workflow settings** applies without approval.

### What the policy allows

| Rule                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`, `edit`                                                                                                                                                                     | Agents read and write files only inside the worktree. Interlock still asks for anything under `.git`.                                                                                                                                                                                                               |
| `git status`, `git diff`, `git log` (with or without arguments), `git show *`, `git blame *`, `git rev-parse *`, `git ls-files *`, `git merge-base *`, `git branch --show-current` | Read-only Git. They run a program only if your own Git configuration names one (an external diff or text conversion), which an agent cannot edit under this policy. Interlock asks for `--ext-diff`, `-c` and `-C`.                                                                                                 |
| `git add *`, `git commit *`                                                                                                                                                        | The builder commits its work for review. `git commit` runs the repository's commit hooks. If your hooks live in the tree (for example `core.hooksPath` set to `.husky`), an agent can edit them and they run on its next commit: that is code execution. Remove `git commit *` for such repositories, or accept it. |
| `ls`, `pwd`, `cat *`, `head *`, `tail *`, `wc *`, `rg *`, `grep *`, `find *`                                                                                                       | Reading and searching. Every path argument must stay inside the worktree. Interlock asks for `find -exec`, `-delete` and `-fprint`, and `rg --pre`.                                                                                                                                                                 |

The policy has no rule for package managers, test runners, `node`, `sed`, `awk` or `git push`: each can run arbitrary code (`pnpm test` runs whatever the repository's test script does, `sed` has an `e` command). `git grep` is also left out, because its `-O` option opens files with a program you name. When a builder runs a focused test, it asks.

The workflow avoids most of those requests by design:

- Interlock's `verify` Script runs the check commands after each build. Scripts run as Interlock, not as an agent, so they need no approval. The builder is told not to run the full check list, and reviewers are told not to rerun passing checks.
- Prompts steer agents to plain commands: no heredocs, `$` variables or command substitution, `cd`, `bash -c` or background jobs, and no files outside the repository such as `/tmp`. Interlock asks for all of those. Agents read with `cat`, `head`, `tail`, `rg` or `git show` rather than `sed` or `awk`.
- Every file the workflow writes stays in the worktree: notes and scratch files go in the task folder.

To allow your repository's own commands, add rules such as `{ "kind": "command", "pattern": "pnpm test *" }` in **Workflow settings → Permission policy**. Treat each as code execution: an agent that can edit files can change what the command runs. See [the policy's limits](permission-policy.md#limits).

Check commands come from the `checkCommands` input when you set it; otherwise the plan proposes them from the repository's own instructions and Interlock runs them without asking. The plan approval shows them. A plan's commands must be single plain commands; the workflow sends the plan back if one contains `$`, backticks, `;`, `|`, `&`, `<` or `>`. Set `checkCommands` yourself, or use `reviewPolicy: "always"`, when you do not want agent-chosen commands to run unseen.

## Compare v2 with the original

A paired live run on the same brief shows whether v2 earns its place. Interlock has not made one yet. To run one:

1. **Repositories.** Make two clones of the target repository at the same commit, one per arm, so the arms never share a checkout.
2. **Workflows.** Add both starters. In the v1 copy, change nothing. In the v2 copy, turn on **Give each run its own Git worktree** with the v2 clone as the repository and the shared commit as the start ref, and publish. Leave the v2 permission policy as shipped.
3. **Executor.** Use one managed profile for both arms, for example Codex with model `gpt-6.1-sol`, effort `medium` and **Standard** permissions, and select it as each workflow's executor.
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
       "unknownUsage": "allow",
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

   v2: the same, with `"workflowId": "V2_WORKFLOW_ID"`, `"requestId": "sdlc-compare-v2-1"`, `"arm": "v2"`, no `repoPath` (the worktree setting supplies the checkout), and `"size": "small"` or `"standard"` to match the brief. Set `checkCommands` in neither arm, so both plans choose their checks, or the same list in both.

   The cost maximum is in millionths of the currency: `5000000` is USD 5. Claude Code and Codex costs are derived from token counts with the run's price table; see [run budgets](run-budgets.md).

5. **Answer requests** in **Review** as a person would. Approve routine permission requests only after reading them; do not answer workflow questions differently between arms.
6. **Freeze and probe.** When both runs end, check each arm's final commit with the same independent probe: a test or script written for the brief that neither workflow saw.

Compare, per arm:

| Measure                           | Where                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Accepted by the independent probe | Your probe, run at each arm's final commit.                                                          |
| Approvals asked and auto-allowed  | `workflow_report` `approvals` (the report's **Permission approvals** section), per run.              |
| Tokens and cost                   | `get_run_usage`: input, cached input and output tokens, and reported or derived cost, with coverage. |
| Review rounds                     | v2: `verification.reviewRounds` in the result. v1: the number of `review` executions in `get_run`.   |
| Assignments                       | `get_run_budget`: the claim count against the 30-claim limit.                                        |
| Wall time                         | The run's start and end times in `get_run`; note separately how long it waited for a person.         |

A run that hits its budget waits with a budget reason; record that as the arm's outcome rather than raising the limit.

## Existing libraries

Adding v2 never changes copies of the original SDLC starter, and the picker keeps offering both under their own identities. Shipped template updates never overwrite your copy. See [starter workflows](starter-workflows.md).
