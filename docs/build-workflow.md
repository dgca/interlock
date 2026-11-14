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

To see every node type in one place, import [All nodes (demo)](https://github.com/dgca/interlock/blob/main/workflows/all-nodes.json) from the `workflows` folder and open its editors. It does not need to run.

## Pass data between steps

Steps exchange JSON. By default, a step receives the previous step's output. You can instead select fields from the original run input, an earlier result, or fixed values.

A JavaScript Script reads `input` and returns the next JSON value. Bash reads JSON from stdin and writes one JSON value to stdout.

**Contracts** describe the inputs and results a workflow or step accepts. Define the fields later steps depend on. Interlock validates actual data during execution; publishing alone does not prove that every connected contract is compatible.

## Add Human input to a workflow

A **Human input** step asks a person a question and waits for the answer. People answer from a [board](workflow-boards.md#find-work-and-answer-a-request) or **Runs → Needs attention**.

1. Choose **Human input** in the node picker.
2. Enter a question and choose **Text** or **Single choice**.
3. For each choice, enter a label and an output value. Turn on **Require comment** for choices that need an explanation.
4. In **Use input data in the request**, set input paths for the question, context or evidence to show.

For a plan review, bind the plan text and its revision, then use those paths in the evidence fields. Interlock captures the resolved content once per step visit. To approve a specific artifact, supply its content or an immutable revision reference.

A text answer becomes a string output. A choice answer becomes an object with `choice` (the configured output value) and an optional `comment`. To branch on the decision, connect a Branch node and select the `choice` path.

## Repeat steps for a list

A **Batch** runs the same item path once for each value in a list, then returns the results in input order.

```text
Entry → Batch
        ├─ [Start → Research item → End]
        └─ Out → Synthesis → Exit
```

1. Add a **Batch** node.
2. Inside the group, use **Add step** to add an Agent, Script or other step. The first step connects to **Start**.
3. Connect the last step of every branch to **End**, and connect **Out** to the next step.
4. In **List to process**, enter the path to an array such as `response.items`, or leave it blank when the whole input is the list.

For input `[3, 4, 5]`, a Script on the item path that returns `input * 2` produces `[6, 8, 10]` on **Out**.

Group members stay visible on the main canvas. Collapsing the group hides them for now, and moving it moves its members.

| Setting                | Values                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Maximum items**      | 1 to 10,000; 200 when unset. Larger lists fail before any item starts.                                                                                                       |
| **Items at a time**    | 1 to 50.                                                                                                                                                                     |
| **When an item fails** | **Fail and stop other items** (`all`) returns raw item outputs. **Collect successes and failures** (`collect`) returns one `{runId, status, output, error}` record per item. |

`maxItems`, `concurrency` and the workflow's `maxSteps` are separate limits: raising one does not raise the others. Each item run has its own step budget. Larger batches store more runs and can slow the engine and inspector; the maximum is a validation bound, not a throughput guarantee. See [Batch output](https://github.com/dgca/interlock/blob/main/docs/architecture.md#batch-output) for failed-item values.

## Edit faster

- **Undo** and **Redo** beside **Save draft** reverse up to 50 editor actions (Ctrl/Command+Z, Ctrl/Command+Shift+Z). Leaving the workflow or reloading clears this history. Undo never changes a published version.
- Scroll to pan, and pinch or hold Ctrl/Command and scroll to zoom. Hold Space and drag, or drag with the middle mouse button, to pan.
- Hold **Z** and drag across empty canvas to zoom to that area. Escape or releasing Z cancels.
- The **Tidy** button below **Fit View** arranges the graph. Its gear opens **Tidy mode** to choose **Dagre** (the default) or **ELK**. Tidy changes only positions and can be undone in one step.
- **Raw** shows the workflow's JSON. Choose **Save** or **Discard** beneath the editor before you return to **Visual**.

Node positions save automatically when you drag or tidy, without changing the draft content or creating a version.

## Archive or delete a workflow

- **Archive** moves a workflow out of the active library. You can restore it later.
- **Delete workflow**, in the menu beside **Run**, removes the workflow, its published versions and its run history after a confirmation.

Deletion is blocked while the workflow has owned child workflows, active runs, or references from other workflows. To remove only obsolete versions, use [version cleanup](https://github.com/dgca/interlock/blob/main/docs/version-cleanup.md).

## Keep reusable values separate

Saved **Prompts** hold instructions shared by Agent steps. **Variables** hold configuration and secrets that Script environments and Fetch headers can reference. See [Reuse work](reuse-work.md) for shared procedures and values.

Save the draft, publish a version, and try representative inputs. [Inspect each result](inspect-runs.md) before adding more steps. Use [testing and comparisons](testing-workflows.md) to check changes to an existing procedure.
