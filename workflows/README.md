# Import a workflow

These files are explicit imports. New libraries start empty; bundled SDLC, SDLC v2, pull request watcher, evaluator, GitHub issue intake and run notification choices are available in **Workflows → Import → Starters**. The same dialog supports GitHub folders, local files and pasted JSON, with a preview before import. See [starter workflows](../docs/starter-workflows.md).

| File                                                 | Workflow                     | Purpose                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [sdlc.json](sdlc.json)                               | SDLC workflow                | The same procedure offered by the bundled starter picker. See [Use the SDLC workflow](../docs/sdlc-workflow.md).                                                               |
| [sdlc-v2.json](sdlc-v2.json)                         | SDLC workflow v2             | Bundle of SDLC workflow v2 with its owned Plan review and Change review, as offered by the starter picker. See [Use the SDLC workflow v2](../docs/sdlc-workflow-v2.md).        |
| [pr-watcher.json](pr-watcher.json)                   | Pull request watcher         | Bundle of the pull request watcher with its owned Change review, as offered by the starter picker. See [Watch a pull request](../docs/pr-watcher.md).                          |
| [all-nodes.json](all-nodes.json)                     | All nodes (demo)             | Inspect every current node editor using a fictional mission briefing. Importing also adds its owned **Format crew badge** helper.                                              |
| [local-git-trial.json](local-git-trial.json)         | Local Git trial example      | Reviewed local Script for independent comparison workspaces. See [managed Git trials](../docs/local-git-trials.md).                                                            |
| [evaluate.json](evaluate.json)                       | Evaluate workflow comparison | Grade retained artifacts using a fixed rubric and record resumable receipts. See [workflow evaluation](../docs/workflow-evaluation.md).                                        |
| [github-issue-intake.json](github-issue-intake.json) | GitHub issue intake          | Scheduled poll that starts one run per labeled GitHub issue and swaps its label, as offered by the starter picker. See [GitHub issue intake](../docs/integration-starters.md). |
| [improve.json](improve.json)                         | Improve one workflow prompt  | One bounded experiment and adoption proposal, with a pinned owned evaluator. See [workflow improvement](../docs/workflow-improvement.md).                                      |
| [parallel-checks.json](parallel-checks.json)         | Parallel checks (demo)       | Count checks and look for a test check in parallel. See [Parallel groups](../docs/parallel.md).                                                                                |

## Import from GitHub

1. Open **Workflows → Import → GitHub folder**.
2. Enter `https://github.com/dgca/interlock/tree/main/workflows` and select **Find workflows**.
3. Select the example you want and choose **Import workflow**.
4. Open the imported draft. Double-click a node to inspect its settings. The Batch group has a **Settings** button.

Alternatively, download a JSON file and upload it through **Import → Local file**. From a repository checkout, the CLI accepts `interlock import @workflows/all-nodes.json`.

Importing does not start a run. The demo imports as a draft with a published owned helper so both Workflow editors have a valid target. Reimporting the unchanged demo bundle is a no-op; conflicting local edits are preserved by import conflict checks. The SDLC file creates a new draft on each import. Only publish a root draft if you want to run it.

## Inspect the demo

The demo covers Entry, Exit, Agent, Script, Fetch, Wait, Condition, Switch, Workflow, Batch, and Parallel. It includes JavaScript and Bash scripts, duration and timestamp waits, a polling check with a timeout, an unclaimed Agent timeout, and both Workflow execution modes. Contracts and earlier-node bindings populate the editors with representative settings.

Viewing editors requires no execution. If you choose to publish and run the demo, `{}` is a sample input. It fetches `https://example.com/`, formats and checks fictional crew badges, and offers an agent a briefing assignment. An automatic briefing is used if nobody claims it within 15 seconds. Claiming stops that timeout. No files are written by the example scripts.

When node types or editor modes change, update this demo in the same file and check its coverage against `nodeSchema` in `packages/core/src/index.ts`. Keep its owned helper and Workflow pins in the bundle.
