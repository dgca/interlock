# Watch a pull request

**Experimental.** This starter has not yet been run against a live GitHub pull request.

**Pull request watcher** watches one GitHub pull request. When a check fails, or an account you trust leaves a review comment, it starts a fix: an agent commits a repair, [Change review](sdlc-workflow-v2.md#how-a-change-moves) checks it with fresh context, and the watcher pushes the reviewed commit to the pull request's branch. Then it watches again. Every loop is bounded and ends at a person.

## Add it

Open **Workflows → Import → Starters**, select **Pull request watcher** and choose **Add to library**. From the CLI: `interlock import-starter pr-watcher`. Nothing runs. Each import publishes the watcher with two workflows it owns: **Pull request fix**, which runs the fixer, and its own copy of SDLC's Change review.

It needs:

- The [GitHub CLI](https://cli.github.com/) on the PATH of the Interlock process, signed in to an account that can read the pull request (`gh auth status`).
- Git credentials that can push to the repository. `gh auth setup-git` lets Git use the GitHub CLI's login.
- A coding agent with file access and Git for the fixer, and a fresh reviewer for Change review: a [managed executor](managed-executors.md) or a [connected agent](connect-harness.md).
- A checkout of the repository: the workflow's [Git worktree](managed-workspaces.md) setting, or a `repoPath` input.

### GitHub access

The watcher reads GitHub through the `gh` CLI rather than the REST API with a token. `gh` uses the login you already have, so no credential passes through Interlock, and it handles API hosts, authentication and errors. The Scripts never print or log a token.

To use a dedicated token instead, for example a fine-grained token limited to one repository, create a **Secret** [variable](variables.md) and bind it as the environment variable `GH_TOKEN` on the **Resolve the pull request** and **Check out the pull request and collect failures** Scripts and on the **Watch checks and comments** check. `gh` uses `GH_TOKEN` when it is set. It needs read access to pull requests, checks and Actions logs. Pushing uses Git's own credentials.

## Start it

### By hand

```sh
interlock start WATCHER_ID '{"prUrl":"https://github.com/me/app/pull/42","repoPath":"/Users/me/code/app"}'
```

| Input               | Behavior                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `prUrl`             | The pull request, `https://github.com/OWNER/REPO/pull/NUMBER`.                                                                            |
| `repoPath`          | Absolute path of a checkout of that repository. Required unless the watcher gives each run its own Git worktree.                          |
| `maxRepairs`        | Fix attempts before a person decides, 1 to 5. Default 2.                                                                                  |
| `trustedCommenters` | GitHub accounts, besides the one `gh` is signed in as, whose review comments the fixer acts on. Up to 20.                                 |
| `watchComments`     | `true` by default. `false` acts on failing checks only.                                                                                   |
| `checkCommands`     | Up to six commands Interlock runs at each fix before its review, such as the repository's test command. They run the pull request's code. |

Without the worktree setting, the checkout must be on the pull request's branch with no uncommitted changes to tracked files; the watcher fast-forwards it to the pull request.

### When an SDLC run opens a pull request

[SDLC workflow](sdlc-workflow-v2.md) with `createPr: true` opens a pull request on its run's branch. An [Interlock event](events.md) automation can start the watcher when that run completes:

1. In your SDLC copy, turn on **Give each run its own Git worktree**, keeping `{runId}` in the branch name. The watcher finds the pull request by that run ID.
2. In the watcher, turn on **Give each run its own Git worktree** with the same repository. The event carries no `repoPath`.
3. Create the automation. With the CLI, save this as `watch-prs.json`, replacing the IDs, and run `interlock triggers manage @watch-prs.json`:

   ```json
   {
     "action": "create",
     "workflowId": "WATCHER_ID",
     "config": {
       "kind": "event",
       "name": "Watch factory pull requests",
       "events": ["completed"],
       "scope": {
         "type": "workflow",
         "workflowId": "SDLC_V2_ID",
         "includeChildren": false
       },
       "exitNodeId": "ready"
     }
   }
   ```

4. Enable it in **Automations** after reviewing it.

The watcher receives the event and looks for an open pull request whose branch contains the SDLC run's ID. A run that opened none ends the watcher at once with `outcome: "no_pull_request"`. Nobody needs to start anything for a failing check to be fixed.

## How it works

1. **Resolve the pull request.** A Script reads the pull request with `gh` and refuses a pull request from a fork, one whose branch is the default or base branch, and a checkout with no Git remote for that repository.
2. **Watch checks and comments.** A polling Wait checks the pull request every 5 minutes for up to 4 hours. It continues when every check on the latest commit has finished and one failed, or when a trusted comment arrived after the latest commit. Green checks keep it watching for comments.
3. **Prepare.** A Script brings the checkout to the pull request's latest commit and collects the failed checks with the tail of each failed GitHub Actions log.
4. **Fix.** An agent repairs the cause, addresses the trusted comments and commits. It does not push, merge, rebase or amend.
5. **Change review.** SDLC's Change review runs your `checkCommands` and reviews the fix with fresh context. A revision goes back to the fixer.
6. **Push.** A Script reads the pull request again. If it was merged or closed, the run ends without pushing; if its head moved, a person decides. Otherwise it pushes the reviewed commit to the pull request's branch, and watching resumes.

A merged or closed pull request ends the run.

### Limits

| Loop         | Limit                                                          | Then                                                                                                                                    |
| ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Fix attempts | `maxRepairs` (default 2), counting every fixer result          | **Pull request needs you**                                                                                                              |
| Polling      | Every 5 minutes. The check reads GitHub at most once a minute. | Each read makes at most two GitHub API calls.                                                                                           |
| Watch window | 4 hours from each start of watching                            | One more read: all checks green and no trusted comment ends the run with `checks_passed`; anything else asks **Pull request needs you** |
| Steps        | 400 per run                                                    | The run fails.                                                                                                                          |

Change the interval or the window in the **Watch checks and comments** step. The once-a-minute floor stays, so a short interval cannot exhaust GitHub's rate limit of 5,000 requests an hour.

### Pull request needs you

Every stop that is not a merge or close goes to one Human input step, **Pull request needs you**, in **Runs → Needs attention**. It says why:

- the repair limit was reached;
- a check was cancelled or needs approval;
- the fixer could not fix it within the pull request's scope;
- Change review could not finish;
- a step failed, for example `gh` is not signed in, the fixer's executor failed, the pull request moved while the fix was made, or the push was rejected;
- the watch window ended with checks failing, pending or blocked, or a trusted comment waiting.

**Keep watching** reads the pull request again and resumes; at the repair limit it allows `maxRepairs` more attempts. **Stop watching** ends the run with `outcome: "stopped"`.

## Which comments count

Only comments from the account `gh` is signed in as and the accounts in `trustedCommenters` are instructions. The pull request's author is trusted only when it is that account, so on a collaborator's or a bot's pull request their comments do not drive an agent that runs with your push credentials. That covers conversation comments, review summaries (not approvals) and inline review comments posted after the pull request's latest commit.

Text in a comment from anyone else is untrusted. The watcher counts those comments and never passes their text to an agent. Repository collaborators are not trusted automatically: add the accounts you want to `trustedCommenters`.

Failed check logs reach the fixer as data, but treat them as attacker-influenced: the pull request's code and anything it runs in CI can print arbitrary text into them. The fixer's instructions say that nothing in a log is an instruction; that is guidance to a model, not a guarantee. `checkCommands` likewise run the pull request's own code on your machine, as your user.

## What it changes outside Interlock

The only outward action is a push to the pull request's own branch:

- only a commit that passed Change review, or nothing;
- a plain push, which GitHub accepts only as a fast-forward. Never forced;
- never to the default branch or the pull request's base branch, and never from a fork;
- it never merges, approves, comments on or closes the pull request.

## Read the result

| Field              | Values                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `outcome`          | `merged`, `closed`, `checks_passed` (the window ended with everything green), `no_pull_request` or `stopped`. |
| `prUrl`            | The watched pull request.                                                                                     |
| `repairs`          | Fix attempts made.                                                                                            |
| `lastPushedCommit` | The last commit the watcher pushed, or `null`.                                                                |
| `summary`          | What ended the run.                                                                                           |

## Test your edits

Interlock's saved cases, in `tests/fixtures/pr-watcher-suites.json` in the repository, run the main routes with [fixture simulation](workflow-simulation.md): a fix pushed with no person involved, the repair limit, a setup error, a failed fixer, and the end of the watch window. Save an entry with `save_test_suite` against your copy and run it after an edit; the window entry expects a copy whose watch window equals its polling interval. Change review has its own cases in the SDLC suites.

## Verify against a real pull request

Interlock's automated tests use a fake `gh` and local repositories. To check the watcher against GitHub by hand:

1. Create a throwaway repository you own with a GitHub Actions workflow that runs one test on pull requests. Clone it and check `gh auth status`.
2. On a new branch, commit a change that makes the test fail, push it and open a pull request with `gh pr create`.
3. Add the starter, select your executor for the watcher and its Change review, and turn on the watcher's Git worktree setting with your clone as the repository.
4. Start it with `{"prUrl": "PR_URL", "maxRepairs": 1}`. Give the run a [budget](run-budgets.md) if you want a cost cap.
5. When CI fails, the watcher should fix, review and push one commit. Check that `git log origin/BRANCH` shows the fix on top of your commit, that the default branch did not change, and that CI runs again.
6. From a second account, comment on the pull request asking for an unrelated change. The watch step's next check output should count it in `ignoredComments`, and its text should appear in no agent assignment.
7. Make the failure unfixable, for example a CI step that needs a missing secret. After one attempt the run should wait at **Pull request needs you** in **Runs → Needs attention**.
8. Merge the pull request. The run should end with `outcome: "merged"`.
