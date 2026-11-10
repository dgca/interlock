---
title: Test and improve workflows
description: Check workflow routes with fixtures and compare published versions on saved cases.
---

# Test and improve workflows

Start with representative inputs and explicit expectations. A saved test suite can check output values and the routes a workflow takes. Keep cases for ordinary work, missing information, and failures you have seen.

Testing operations are available through MCP. The CLI also manages suites and runs fixture simulations. Ask your [connected agent](agents.md) to prepare the cases and inspect the results.

## Check contracts and routes

A fixture simulation substitutes supplied results for Agent, Script, and Fetch steps. It exercises contracts, data bindings, routing, and retries without model calls, shell commands, or network requests.

A passing simulation shows that those supplied results followed the expected path. It does not prove that a prompt, script, or real API produces those results. Unsupported workflow structures are rejected before execution.

## Compare real executions

A live comparison runs two published versions against the same saved cases. Preview the comparison through MCP before starting it. Scripts and requests perform their real actions, and Agent steps need a connected agent or configured automatic executor.

Review execution outcomes, assertion results, and quality judgments separately. A completed run can still miss an expectation. Compare timing and reported costs with [Reports](reports.md), keeping missing measurements in view.

Use the findings to [edit the workflow](build-workflow.md), publish another version, and repeat the comparison. Publication remains a separate decision.
