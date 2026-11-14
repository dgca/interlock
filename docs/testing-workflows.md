---
title: Test and improve workflows
description: Check workflow routes with fixtures and compare published versions on saved cases.
---

# Test and improve workflows

Start with representative inputs and explicit expectations. A saved test suite can check output values and the routes a workflow takes. Keep cases for ordinary work, missing information, and failures you have seen.

Open a workflow's **Tests** tab to create and edit suites and run their cases as fixture simulations, without an agent. The same operations are available through MCP, and the CLI also manages suites and runs simulations. You can also ask your [connected agent](agents.md) to prepare the cases and inspect the results.

## Edit a suite

**New test suite** opens the suite editor. Each case has a name, a stable case ID, workflow input (entered, or copied from one of the workflow's runs when you save), checks, simulation fixtures and optional quality guidance. A check either compares an output value (exists, equals, at least or at most) at a path of the workflow output or of one step's output, or expects a step to take a route. Fixtures are an ordered JSON list of step outcomes; see [fixtures](workflow-simulation.md#save-fixtures). Saving creates a new suite revision. If the suite changed elsewhere, your edits stay in the form and **Load latest** replaces them after you confirm.

## Run a suite

On a suite's page, choose a published version and select **Run all cases**. Cases run one at a time as fixture simulations. Each case shows its latest result: passed, failed or unsupported, every check with its reason, the routes it covered, and the routes it left untested. When every result used the same version, the summary also shows the routes that no case takes. A result from an earlier suite revision is marked with that revision.

## Check contracts and routes

A fixture simulation substitutes supplied results for Agent, Script, Fetch, Wait, Human input, and Workflow steps. It exercises contracts, data bindings, routing, and retries without model calls, shell commands, or network requests.

A passing simulation shows that those supplied results followed the expected path. It does not prove that a prompt, script, or real API produces those results. Unsupported workflow structures are rejected before execution.

## Compare real executions

A live comparison runs two published versions against the same saved cases. Preview the comparison through MCP before starting it. Scripts and requests perform their real actions, and Agent steps need a connected agent or configured automatic executor.

The **Tests** tab lists the workflow's recent comparisons. A comparison's page is read-only: it shows each side's runs, checks, median run times, reported cost and quality coverage, then each case, each sample with its result and checks and an **Open run** link, and the recorded quality judgments. Starting a comparison and recording judgments remain agent, MCP and API operations.

Review execution outcomes, assertion results, and quality judgments separately. A completed run can still miss an expectation. Compare timing and reported costs with [Reports](reports.md), keeping missing measurements in view.

Use the findings to [edit the workflow](build-workflow.md), publish another version, and repeat the comparison. Publication remains a separate decision.
