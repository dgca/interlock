---
title: Workflows and runs
description: Understand drafts, published versions, and the runs that execute them.
---

# Workflows and runs

A **workflow** defines a reusable procedure. A **run** executes that procedure with one set of inputs. You can run the same workflow repeatedly without rebuilding its steps.

For example, a review workflow might receive a repository and a request, assign the review to an agent, then pass its findings to another step.

## Draft, publish, run

Edit a workflow's **draft** to change its steps, connections, and settings. You can save unfinished work without making it runnable.

**Publishing** validates the graph and creates a numbered version. Start a run from a published version and supply its input. Saving further draft changes does not alter that publication. Runs keep their selected version by default.

In **Workflows**, create a procedure or import a starter. The bundled **SDLC workflow** plans, implements, and reviews a software change. Importing a starter adds your own copy; it does not start work automatically.

## Follow a run

The [run inspector](inspect-runs.md) shows the active step, waiting reasons, errors, and completed results. Select an execution to inspect the data it received and produced.

The engine handles code, HTTP requests, routing, and timers. Agent assignments need a [connected or automatically launched agent](agents.md). A waiting run may need an agent result, a human answer, or a deadline to pass.

Completed runs remain available for inspection. Start another run for new work. To continue unfinished work, return to its existing run.

Next, [build a workflow](build-workflow.md).
