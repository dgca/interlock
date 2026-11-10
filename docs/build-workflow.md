---
title: Build workflows
description: Combine steps, pass data, and define the results your procedure needs.
---

# Build workflows

Build a workflow around the procedure you want to repeat. Give each step one clear job and connect the steps in execution order.

## Choose the work

An **Agent** step describes an assignment and the result it must return. Use **Script** for local JavaScript or Bash and **Fetch** for an HTTP request.

For example, a review workflow could fetch an issue, ask an agent to assess it, then branch on whether follow-up work is needed. Each step receives the information it needs and produces data for the next step.

Use **Branch** to choose a route, **Wait** to pause or poll, and **External input** to wait for an answer from an integration. A **Workflow** step invokes another published procedure. A **Batch** repeats an item path for a list and collects the results.

The workflow begins at Entry and finishes at Exit. New workflows label those boundaries **Workflow input** and **Return result**. Connect every required route before publishing.

## Pass data between steps

Steps exchange JSON. By default, a step receives the previous step's output. You can instead select fields from the original run input, an earlier result, or fixed values.

A JavaScript Script reads `input` and returns the next JSON value. Bash reads JSON from stdin and writes one JSON value to stdout.

**Contracts** describe the inputs and results a workflow or step accepts. Define the fields later steps depend on. Interlock validates actual data during execution; publishing alone does not prove that every connected contract is compatible.

## Keep reusable values separate

Saved **Prompts** hold instructions shared by Agent steps. **Variables** hold configuration and secrets that Script environments and Fetch headers can reference. See [Reuse work](reuse-work.md) for shared procedures and values.

Save the draft, publish a version, and try representative inputs. [Inspect each result](inspect-runs.md) before adding more steps. Use [testing and comparisons](testing-workflows.md) to check changes to an existing procedure.
