---
title: Boards
description: Track runs by stage across workflows, answer requests, and hold queued starts.
---

# Boards

A board shows runs as cards in lanes, so you can see at a glance what each piece of work is doing and what needs you. Use one to follow work across several workflows, or to find and answer requests from people.

Interlock has three kinds of board:

| Kind                 | Lanes come from                                       | Workflows shown                                     |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Column board         | Columns you define. Steps bind to a column.           | Its member workflows. A workflow is on one at most. |
| Typed board          | A [board type](#use-a-board-type) and the run's state | Any workflows, tags or task systems you choose.     |
| Workflow stage board | The workflow's stages, in graph order                 | That workflow only. No setup.                       |

Cards never move by dragging. They change when run state changes.

## Set up a board

1. Open **Boards** and choose **New board**.
2. Name the board and add the stage columns. Edit their names and order in the form.
3. Select the workflows to include. If a workflow belongs to another board, the form names the board it moves from.
4. Choose **Create board**.

To edit a board later, change it and choose **Save changes** in the settings header. You can also change a workflow's board in **Workflow settings → Board**.

Membership applies to existing and future runs as soon as you save. It does not depend on publication, and reimporting a workflow keeps its board membership.

### Place steps in a column

1. Open a node's settings.
2. In **Stage**, choose a board column.
3. Publish the workflow.

Choosing a column binds the step to that column's ID, so renaming or reordering the column keeps the binding. Typing stage text instead creates a label for run summaries only, even if the text matches a column name.

A column cannot be removed while a draft, a retained version or a retained run uses it.

### If someone else saves first

If the board changed elsewhere before you save, the editor keeps your draft. Choose **Load latest** and confirm to replace your edits with the saved settings. If loading fails, your draft stays and you can try again.

If Interlock cannot confirm a save:

- After a create, check **Boards** for the new board before you start another draft.
- After an update, use **Load latest** to check the saved revision.

## Use a board type

A board type is a reusable layout: ordered lanes, the conditions that place a card in each lane, and the fields each card shows. A typed board computes every card's lane from run state each time it loads. Nothing is stored per card, so the board never drifts from the runs.

1. Open **Boards → Board types** and choose **New board type**. Start from **Coding**, **Design**, **Research** or **Blank**.
2. Edit the lanes. Each lane has conditions on **Stages**, **Status**, **Actor** and **Waiting on**. **Add alternative** adds another set of conditions to the same lane.
3. Add card fields: the task link, workflow, stage, waiting reason, actor, spend, age, tags, or a **Node result** path such as `open_pr.url`, read from that step's latest output.
4. Open **Boards → New board** and choose the type in **Layout**.
5. Choose which runs the board shows: some or all workflows, runs carrying every listed tag, and external task systems.

A card goes to the first lane whose conditions match. A lane without conditions takes every card an earlier lane did not. Cards that match no lane go to **Unmapped**.

### Match workflow stages to the type

Workflows whose stages use the type's names, such as Plan, Build and Review, land in the matching lanes without setup. For another workflow, open **Stage mapping** on the board and map its stage names to the type's stages. The workflow itself does not change.

A misnamed stage never fails validation. Its cards appear in **Unmapped**.

### How cards group runs

Runs that share an external task (system and ID) form one card. So do the runs of a continue-as-new chain. When a card spans several runs, one run places it:

1. a run waiting on a person, if there is one;
2. otherwise the newest active run;
3. otherwise the newest run.

Typed boards do not take workflow membership, so a workflow can appear on any number of them. Column boards keep working as before. A board type in use by a board cannot be deleted.

## See a workflow's stages

Every workflow has its own stage board. Open the workflow's **Runs** and choose **Stages**.

It shows one lane per stage in graph order, plus **Needs you**, **Done** and **Failed**. **Backlog**, **Queued**, **Cancelled** and **Unmapped** appear when they have cards. Runs started by another workflow's step appear on that workflow's cards instead.

## Find work and answer a request

The **Boards** page lists each board's workflows, with a badge when the board has unresolved requests. Search by name; **Clear search** restores the full list. Select a board name to see its runs.

1. Filter by workflow or **Status**. If no runs match, **Clear filters** returns to all workflows and statuses.
2. Select a run card to open its inspector, or use the card's review action to open its oldest unresolved request.
3. Read the question and any captured evidence. **Switch request** opens another request from the same run.
4. Answer. A response applies to one request.
5. Review the receipt for acceptance and any remaining requests.

In the request view, **Open run** selects the exact step. Returning to the board restores its filters and loaded column pages.

**Needs attention** counts unresolved requests in the selected workflows. A card can match it while another branch of the run keeps going. To find requests across the library and see automation alerts, use **Runs → Needs attention**.

When an answer does not go through:

- If another interface answered first, the request shows the accepted decision and keeps your unsent text for copying.
- If an acceptance hold blocks the answer, choose **Release acceptance hold**, then **Accept saved answer**.
- If a library or workflow pause blocks it, use **Open run** to inspect and release the pause.

## Act on a card

Open the card's menu. Each action is an ordinary run operation, applies to the run that places the card, and appears only when that run allows it. A board type chooses which actions its cards offer.

| Action              | What it does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Open run**        | Opens the run inspector.                                                             |
| Review link         | Answers the card's oldest request, as on column boards.                              |
| **Cancel run**      | Cancels the run tree with a reason, after the same preview as the inspector.         |
| **Move to backlog** | Holds a queued start with a reason. It stays queued and admission skips it.          |
| **Release**         | Returns a held start to admission. It starts when capacity and its conditions allow. |

### Hold a start in the backlog

A held start is the only kind of backlog item. There are no work items without a run.

- Start a run held: enter a **Hold reason** in the start dialog, or run `interlock start WORKFLOW_ID @input.json --hold "Waiting for design"`.
- Hold a queued run: `interlock board hold RUN_ID REASON`.
- Release it: `interlock board release RUN_ID`.

Only queued top-level starts can be held. Interlock has no per-run pause, so a run that has started cannot return to the backlog: cancel it, or pause its workflow. Child runs, comparison trials and scheduled starts cannot be held. Held time does not count as admission waiting in reports.

## Find a run by title

Give a run a title when you start it, and boards and **Runs** show it first:

- Browser: **Run title** in the start dialog.
- CLI: `interlock start WORKFLOW_ID @input.json --title TEXT`.
- MCP: `title` on `start_run`.
- Automations: **Run title** in their settings.

Without an explicit title, a card shows the external task title, then the workflow name.

## Add Human input to a workflow

A **Human input** step asks a person a question and waits for the answer, which then shows on the board.

1. Choose **Human input** in the node picker.
2. Enter a question and choose **Text** or **Single choice**.
3. For each choice, enter a label and an output value. Turn on **Require comment** for choices that need an explanation.
4. In **Use input data in the request**, set input paths for the question, context or evidence to show.

For a plan review, bind the plan text and its revision, then use those paths in the evidence fields. Interlock captures the resolved content once per step visit. To approve a specific artifact, supply its content or an immutable revision reference.

A text answer becomes a string output. A choice answer becomes an object with `choice`, the configured output value, and an optional `comment`. To branch on the decision, connect a Branch node and select the `choice` path.

## Set up a board during import

When an import includes board suggestions, open **Board setup** in the import preview. The preview lists the workflows each choice applies to.

- **Create suggested board** shows the name and column order before import. You can edit the name.
- **Use existing board** lets you review the local column for each authored stage. Choose **Leave unstaged** for a stage you want to leave unmapped.
- **Skip board setup** keeps existing local membership and stage mappings. Fresh imports start unassigned.

Interlock saves the workflow and the board setup together. Board setup does not start a run, and a workflow can run before its stages are mapped.

Older bundles can contain source column IDs without names or board suggestions. If the preview lists unresolved stages, assign a board and bind those steps to local columns in the workflow editor.

A stage mapping applies when a step enters the stage; existing stage entries keep the column they recorded. Moving a workflow to another board clears its previous mappings. To replace mappings without changing the published definition, reimport the bundle and choose **Use existing board** again.

## Read boards from the CLI, HTTP and MCP

The same lanes and cards are available everywhere.

```sh
interlock board view BOARD_ID
interlock board view --workflow WORKFLOW_ID --lane LANE --offset 0 --limit 30
interlock board types
interlock board save-type @type.json
interlock board save '{"name":"Delivery","typeId":"coding"}'
```

`--workflow` alone reads that workflow's stage board. `board save` creates a typed board; add `scope` to choose its runs.

| Interface | Read a board                                                                         | Board types                                                |
| --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| CLI       | `interlock board view`                                                               | `interlock board types`, `interlock board save-type`       |
| HTTP      | `GET /api/boards/view?id=BOARD_ID` or `?workflowId=`, with `lane`, `offset`, `limit` | `GET /api/board-types`; `POST /api/boards` creates a board |
| MCP       | `read_workflow_boards` with `request.action: "view"` and `id` or `workflowId`        | Read only through board views                              |

Board types are managed in the UI, the CLI and the shared API. See the [HTTP API](http-api.md) for request details.

## Manage boards through MCP

These tools manage column boards.

- Find boards: `read_workflow_boards` with `request.action: "list"` returns board IDs, workflow counts and attention counts, with `total` and `nextOffset`.
- Read one: `action: "settings"` with the board's `id` returns its revision, columns, protected column IDs and member workflows.
- Read its cards: `action: "get"` with the board `id` and a `column` ID. Use `queued` or `unstaged` for the built-in columns, and filter by `workflowId` or `status`. The response has totals for the filtered columns and cards for the requested column.
- Answer a card's request: pass the card's `request` as the `target` to `workflow_requests` with `action: "get"` to read the captured question and evidence.

`manage_workflow_boards` with `request.action: "save"` saves the board name, ordered columns and the complete list of member workflow IDs:

- To create a board, omit `id` and `expectedRevision`. If the response is lost, check the board list before retrying; repeating the create can add a duplicate.
- To update a board, pass its `id` and current `expectedRevision`. Keep the IDs of existing columns and omit IDs for new columns.
- To guard membership, supply `expectedBoards`, mapping each selected workflow ID to its observed board ID or `null` if unassigned.
- A save moves selected workflows from their previous boards and unassigns current members left out of the list.

To move or remove one workflow, use `action: "assign"` with `workflowId`, `boardId` and `expectedBoardId`. Use `null` for either board ID to mean no board.

If a revision or membership check fails, read the current state before saving again. Moving or unassigning a workflow clears its imported stage mappings. To map its stages on another board, reimport the bundle with board setup, or select local columns in the workflow draft and publish it.

## Reference

### Board view response

Each lane has an `id`, `name`, `total` and `cards`. A view of a column board returns its columns as lanes.

| Card field | Meaning                                     |
| ---------- | ------------------------------------------- |
| `id`       | `task:<system>/<id>` or `run:<root run ID>` |
| `runId`    | The run that places the card                |
| `runCount` | The number of runs the card spans           |

### Built-in board types

The **Coding**, **Design** and **Research** presets are built-in types with the IDs `coding`, `design` and `research`.

- `interlock board types` and `GET /api/board-types` list them with `builtIn: true` and revision 0.
- Creating a board from one, or saving one with `board save-type` and `expectedRevision: 0`, stores an editable copy under the same ID. Later changes to the preset never move an existing board's cards.
- A built-in type cannot be deleted. Deleting your saved copy brings the preset back.

### Lane conditions

Within one condition set, every condition present must match, and each list matches any of its values.

| Condition | Values                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `stages`  | Stage names, up to 50                                                                        |
| `status`  | `held`, `queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`                   |
| `actor`   | `agent`, `person`, `engine`                                                                  |
| `waiting` | Waiting kinds, as in the [HTTP API](http-api.md#status-fields) `waiting.kind`                |
| `tags`    | Run tags that must all match. Available in type JSON (`board save-type`), not in the editor. |

A `held` run is a queued start in the backlog.

### Limits

| Item                           | Limit                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Lanes per board type           | 30, with unique IDs; `unmapped` is reserved                                                                                               |
| Condition sets per lane        | 10                                                                                                                                        |
| Card fields per board type     | 12, with unique IDs                                                                                                                       |
| Typed board scope              | Up to 1,000 workflows and 50 task systems                                                                                                 |
| Finished runs on a typed board | The 100 most recently finished in the last 24 hours, plus every active run in scope. The board says how many it shows when more finished. |
| Board view page                | 30 cards per lane by default, at most 100. MCP `view` defaults to 10.                                                                     |
| MCP board list and column page | 30 by default, at most 100                                                                                                                |

### Card placement on column boards

- Each card follows one root run and its continue-as-new chain.
- Waited children, Batch items and Parallel branches contribute stage entries and requests. Detached runs get their own cards.
- A card keeps the last matching column it reached.
- A queued start appears in **Queued**. An admitted run with no matching entry appears in **Unstaged**.
- Finished runs keep their last placement and an outcome badge.
- Each column shows up to 20 finished runs without unresolved attention, for 24 hours. The full retained history is in **Runs**.

### Hold and release from MCP and HTTP

- MCP `start_run` and `POST /api/runs` accept `hold: { "reason": "..." }`.
- MCP `manage_pause` holds or releases a queued start with the actions `hold_start` and `release_start`.
