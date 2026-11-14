---
title: Test and improve workflows
description: Save test cases, check routes with fixture simulations, and compare published versions on the same cases.
---

# Test and improve workflows

A test suite saves representative inputs and what you expect from them. Use it to check that a workflow takes the routes you expect, without agents or side effects, and to compare two published versions on real runs.

Keep cases for ordinary work, missing information, and failures you have seen. You can build suites in the workflow's **Tests** tab, or ask your [connected agent](agents.md) to prepare cases and read the results.

## Create a suite

1. Open the workflow and select the **Tests** tab.
2. Choose **New test suite**.
3. Enter the suite's **Name** and an optional **Description**.
4. Fill in the first case (see below). Choose **Add case** for more.
5. Choose **Create suite**.

Each case has:

| Field                   | What to enter                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                | A readable name.                                                                                                                                                              |
| **Case ID**             | A stable ID. Results refer to it, so keep it when you rename the case.                                                                                                        |
| **Workflow input**      | **Enter input** in fields (or **Edit input as JSON**), or **Copy from a run** with a **Source run ID**. Saving copies that run's input; the run must belong to this workflow. |
| **Checks**              | What the result must show. See below.                                                                                                                                         |
| **Simulation fixtures** | A JSON array of step outcomes that stand in for real work.                                                                                                                    |
| **Quality guidance**    | What a reviewer should judge in live comparisons. Simulations ignore it.                                                                                                      |

### Checks

A check has a **Type**:

- **Output value**: look at a **Path** in the **Workflow output**, or in one **Step**'s output on a given **Visit**. Leave the path empty for the whole value. The **Condition** is **Exists**, **Equals**, **At least** or **At most**, with an **Expected JSON** value.
- **Route taken**: expect a **Step** to take a **Route** on a given **Visit**.

### Fixtures

Fixtures are an ordered list. Each has a `nodeId`, a `kind`, and an `output` or `error`. Agents save the same format with `save_test_suite`.

```json
[
  {
    "nodeId": "draft",
    "kind": "agent",
    "output": { "summary": "Updated the guide" }
  },
  { "nodeId": "checks", "kind": "script", "output": { "passed": true } }
]
```

See [Simulate workflow contracts and routes](https://github.com/dgca/interlock/blob/main/docs/workflow-simulation.md#save-fixtures) for every fixture kind.

### Edit a suite

Open the suite and choose **Edit suite**. **Save changes** creates a new suite revision.

If the suite changed elsewhere meanwhile, your edits stay in the form. **Load latest** replaces them with the saved suite after you confirm.

## Run a suite

1. Open a suite from the **Tests** tab.
2. Choose a **Published version**.
3. Select **Run all cases**.

Cases run one at a time as fixture simulations. The workflow must be published first.

Each case shows its latest result:

- **Passed**, **Failed** or **Unsupported**, with the reasons;
- every check with its reason;
- **Route coverage**, and **Untested routes** it left;
- **Tools called**, when the workflow has [tools for agents](agent-tools.md).

The summary counts results by state, and cases **Not run**. When every result used the same version, it also shows **Suite route coverage** and the routes no case takes. A result from an earlier suite revision is marked with that revision.

## What a simulation proves

A fixture simulation uses your fixtures in place of Agent, Script, Fetch, Wait, Human input and Workflow steps. It checks contracts, data bindings, routing and retries. It makes no model calls, shell commands or network requests.

A passing case shows that those results follow the expected path. It does not prove that a prompt, Script or real API produces them. Interlock rejects unsupported workflow structures before running.

## Compare two published versions

A live comparison runs two published versions against the same saved cases. Script and Fetch steps perform their real actions. Agent steps need a connected agent or a configured automatic executor.

1. Preview the comparison with MCP `preview_workflow_comparison`: suite, suite revision, baseline version and candidate version.
2. If the preview can start, call `start_workflow_comparison` with the same selection and its `confirmation`.
3. Let agents do the Agent work through ordinary claims.
4. Open the comparison from the **Tests** tab to read the report.

Starting a comparison and recording quality judgments are agent, MCP and API operations. The UI shows the results. See [Compare workflow behavior](https://github.com/dgca/interlock/blob/main/docs/workflow-testbench.md) for every option, including budgets and trial workspaces.

### Read the comparison report

The **Tests** tab lists the workflow's recent comparisons. A comparison's page is read-only. It shows:

- each side, **Baseline** and **Candidate**: runs, checks, **Median run time**, **Reported cost** and quality coverage;
- each case, with each sample's result and checks, and an **Open run** link;
- the recorded quality judgments.

Review run outcomes, check results and quality judgments separately. A completed run can still miss an expectation. Compare timing and reported cost with [Reports](reports.md), and keep missing measurements in view.

Use what you find to [edit the workflow](build-workflow.md), publish another version, and compare again. Publishing stays a separate decision.

## CLI

```sh
interlock test-suite '{"action":"list","workflowId":"WORKFLOW_ID"}'
interlock test-suite '{"action":"get","id":"SUITE_ID"}'
interlock test-suite @suite.json
interlock simulation '{"action":"run","suiteId":"SUITE_ID","suiteRevision":1,"caseId":"basic","version":1,"requestId":"sim-basic-1"}'
interlock simulation '{"action":"get","id":"SIMULATION_ID"}'
```

- `test-suite` actions: `create` with `workflowId` and `content`; `update` with `id`, `revision` and `content`; `get`; `list`.
- `simulation` actions: `run`, `get`, `list`, `capture`, `cancel`. Simulations use fixtures only and have no external effects.

## Limits

| Item                   | Limit            |
| ---------------------- | ---------------- |
| Cases in a suite       | 1–25             |
| Checks in a case       | 50               |
| Fixtures in a case     | 1,000            |
| Case input             | 64 KiB           |
| Whole suite            | 1 MiB            |
| Quality guidance       | 4,000 characters |
| Comparison repetitions | 1–10, default 1  |
| Comparison concurrency | 1–10, default 2  |

A case has either an input or a source run, never both. Case IDs must be unique within a suite.
