# Run comparisons in separate Git workspaces

Use `trialSetup` for trusted local repository tasks that need a clean checkout for each baseline, candidate and repetition. Interlock prepares the workspace before creating a sample root, supplies it to native Scripts and Agent assignments, and retains a patch and new files before cleanup. The original task input stays unchanged.

Git must be installed on the server machine. The source must be a local repository root with the selected commit already present. Capture a full commit ID before preview, for example with `git rev-parse HEAD`. Uncommitted source changes are excluded. Tracked symlinks and submodules are unsupported.

## Choose the execution policy

This recipe permits trusted local file work only. Do not use a workflow that updates GitHub, sends messages, changes a remote service, or requires production credentials. Native Fetch nodes and Fetch polling probes reject during preview, including in transitive child workflows. Ordinary comparisons retain their normal external effects.

Native Scripts receive a clean environment containing `PATH`, `LANG`, Git configuration guards and the three trial variables below. Checkouts have no origin remote, use independent Git object files and disable Git hooks. These measures prevent accidental reuse of the source checkout and inherited credentials. They do not block network calls, absolute filesystem paths, subprocesses or detached programs in arbitrary Script code. Review all Script bodies, including polling checks, before using this recipe. Keep their work inside the supplied directory and await their subprocesses.

For Agent work, the external harness must provide tools scoped to the supplied workspace and prevent outbound writes. For example, expose file operations confined to that directory, an allowlist of reviewed local commands, and no GitHub, browser, messaging, unrestricted shell or network tools. A generic coding-agent session with unrestricted tools does not satisfy this policy. Use an external sandbox if the task needs arbitrary code execution under enforced restrictions. Interlock does not build that sandbox or verify the restrictions. The `interlock-local-trials` skill declaration means the harness accepts this obligation; it is not evidence of containment.

## Preview and start

Add the same `trialSetup` to `preview_workflow_comparison` and `start_workflow_comparison`:

```json
{
  "suiteId": "SUITE_ID",
  "suiteRevision": 1,
  "baselineVersion": 1,
  "candidateVersion": 2,
  "trialSetup": {
    "kind": "local_git",
    "repository": "/absolute/path/to/repository",
    "commit": "FULL_CAPTURED_COMMIT_ID"
  }
}
```

Replace the placeholders with retained versions, a saved suite and a full 40- or 64-character lowercase Git commit ID. Start with the returned `confirmation` and a unique `requestId`. An uncertain start can be repeated with identical arguments and request ID. A different setup requires a new preview.

Each sample has a separate clone of that exact commit, even if the source branch changes later. Preparation reserves comparison capacity before a run exists. Failed preparation records `not_started` and an error without dispatching evaluated work. Interlock never substitutes its own working directory.

The server stores clones beside its database under `evaluation-trials/ENVIRONMENT_ID/workspace`. A programmatic in-memory Engine must supply an explicit `trialRoot`. The Git operations run outside database transactions and do not use shared worktrees, hardlinks, borrowed object databases, source Git hooks or remote fetching.

## Execute Agent assignments

Use the ordinary work/claim loop. Compact work lists and briefings include only `trialEnvironmentId`. Full assignments and claims include:

```json
{
  "trialEnvironment": {
    "id": "ENVIRONMENT_ID",
    "workspace": "/server/data/evaluation-trials/ENVIRONMENT_ID/workspace",
    "baseCommit": "FULL_CAPTURED_COMMIT_ID",
    "configurationId": "SIDE_CONFIGURATION_ID",
    "policy": "trusted_local"
  }
}
```

Before claiming, prepare the scoped executor described above. Declare `skills:["interlock-local-trials"]` alongside any other actual requirements. Execute in `trialEnvironment.workspace`; keep the original `input` as the task. Do not claim when your tools cannot honor the local-only policy. Renew the lease while working, stop all subprocesses before reporting success or failure, and submit bounded JSON evidence suitable for grading. Workspace paths alone are not durable artifacts.

Native JavaScript and Bash Scripts, polling Script checks, Batch item runs, and invoked workflows use the same sample workspace. Different samples never share it. Scripts receive `INTERLOCK_TRIAL_ID`, `INTERLOCK_TRIAL_WORKSPACE` and `INTERLOCK_TRIAL_BASE_COMMIT`. Omitted Script language retains legacy Bash behavior. Invoked detached runs retain the environment and delay cleanup until they finish.

## Inspect evidence and cleanup

Read `read_workflow_comparisons` with `request.action:"report"`. Each managed sample has compact `trial` state and a `trialRef`. Progress reports count preparation failures, cleanup pending and cleanup blocked. Comparison completion records execution and observations; it does not imply cleanup completed.

For local paths and bounded failure details, use:

```json
{
  "request": {
    "action": "trial",
    "id": "COMPARISON_ID",
    "sampleId": "SAMPLE_ID"
  }
}
```

The receipt includes environment, setup and side configuration identities, base commit, preparation and cleanup states, workspace path, and retained artifact paths. Reports omit ownership tokens, file contents and logs. Paths must be accessible from the executor or evaluator machine; a remote harness needs its own artifact transfer.

After all sample descendants stop, Interlock captures `changes.patch` against the original commit, including staged and committed tracked changes, plus non-ignored untracked regular files. It then removes only the owned workspace. Grading can read these retained exports after cleanup. Ignored build/dependency files, logs and arbitrary external files are not captured. Git output is limited to 16 MiB per operation, artifacts to 32 MiB combined and 1,000 untracked files. Individual Git operations time out after 120 seconds. Exceeding a limit or encountering an unsupported file retains the workspace with a blocked receipt.

If cleanup is blocked, inspect `cleanupError` and preserve any evidence you need before changing retained files. Correct the cause, then call:

```json
{
  "request": {
    "action": "cleanup_trial",
    "id": "COMPARISON_ID",
    "sampleId": "SAMPLE_ID"
  }
}
```

Claim cancellation, lease expiry and process interruption can leave a worker alive. A managed Agent lease expiry cancels its entire sample tree instead of making another attempt available. Restart cancels samples with interrupted native work, pending polling checks or claimed Agents. Pending Script checks are treated conservatively because a lost process may still be running a probe. Interrupted preparation fails without allocating a root; interrupted cleanup remains blocked. These states require the harness to stop and reconcile uncertain workers. Only after verifying that they stopped, include `"quiescent":true` in the cleanup request. This confirmation does not stop processes by itself. Cleanup still waits for active descendants and native jobs to close.

Cleanup retries are idempotent. Ownership markers and derived paths guard deletion, including replacement by symlinks. Missing or stale ownership blocks cleanup rather than granting permission to delete another directory. Do not repair a marker blindly. Inspect and resolve the retained directory with the server stopped if ownership cannot be established.

Explicit run retries are unsupported for managed trials. Start a new comparison for a new complete trial. Workflow deletion is blocked while any of its managed cleanup remains unfinished. Once cleanup completes, deleting the workflow removes database receipts but retains the exported artifacts and ownership directory. Archive needed exports, then remove those completed environment directories yourself when they are no longer useful. There is no automatic export retention policy in this increment.

## Try the local example

Import [local-git-trial.json](../workflows/local-git-trial.json) as a draft. It contains one reviewed JavaScript step that reads and changes only `trial-fixture.txt`, validates the managed workspace variables and returns the before/after text. It has no external calls. An ordinary start fails before reading or writing the fixture.

1. Create a disposable Git repository containing a committed `trial-fixture.txt` with `original` as its contents.
2. Publish the imported workflow as version 1.
3. Change the Script's `baseline` string to `candidate`, then publish version 2.
4. Save a suite for that workflow with input `{}` and one representative case.
5. Preview and start versions 1 and 2 with the disposable repository's absolute root and captured commit.
6. Wait until comparison execution and cleanup finish. Both results have the same `before` value. Their `after` values and retained patches differ. The source fixture remains unchanged.

This example needs no Agent, model account, remote service or production data. Use [fixture simulation](workflow-simulation.md) when you need effect-free structural checks instead of live local execution.
