# Use Workflow Boards

## Set up a board

1. Open **Boards** and choose **New board**.
2. Name the board and add the stage columns. Edit their names and order in the form.
3. Select the workflows to include. If a workflow belongs to another board, the form names the board it moves from.
4. Choose **Create board**. To edit an existing board, use **Save changes** in the settings header. You can also change membership in **Workflow settings → Board**.

If the board changes elsewhere before you save, the editor keeps your draft. Choose **Load latest** and confirm to replace your edits with the current saved settings. If loading fails, your draft stays available and you can try again.

If Interlock cannot confirm creation, check **Boards** for the board before starting another draft.
If Interlock cannot confirm an update, use **Load latest** to check the saved board revision.

Membership applies to existing and future runs as soon as you save. It is independent of publication. Reimporting a workflow keeps its board membership. To place runs in a stage, open a node's settings, choose a board column in **Stage**, and publish the workflow. Selecting a column binds its ID. Typing stage text creates a label for run summaries, even if the text matches a column. Renaming or reordering a column preserves its bindings. A draft, retained version, or retained run can prevent column removal.

## Set up a board during import

When an import includes board suggestions, open **Board setup** in the import preview. The preview lists the workflows each choice applies to.

- **Create suggested board** shows the name and column order before import. You can edit the name.
- **Use existing board** lets you review the local column for each authored stage. Choose **Leave unstaged** for any stage you want to leave unmapped.
- **Skip board setup** keeps existing local membership and stage mappings. Fresh imports start unassigned.

Interlock saves the workflow and selected board setup together. Board setup does not start a run. A workflow can run before its stages are mapped. Older bundles can contain source column IDs without names or board suggestions. If the preview lists unresolved stages, you can assign a board and bind those steps to local columns in the workflow editor.

A stage mapping applies when a step enters the stage. Existing stage entries keep the column they recorded. Moving a workflow to another board clears its previous mappings. To replace mappings without changing the workflow's published definition, reimport the bundle and choose **Use existing board** again.

## Manage boards through MCP

Use `read_workflow_boards` with `request.action: "list"` to find board IDs, workflow counts, and attention counts. The response includes `total` and `nextOffset`. Use `action: "settings"` with the board's `id` to read its revision, columns, protected column IDs, and workflow membership.

Use `manage_workflow_boards` with `request.action: "save"` to save the board name, ordered columns, and complete list of member workflow IDs.

- To create a board, omit `id` and `expectedRevision`. If the response is lost, inspect the board list before retrying. Repeating the create can add a duplicate.
- To update a board, pass its `id` and current `expectedRevision`. Keep the IDs of existing columns and omit the IDs of new columns.
- Supply `expectedBoards` to guard membership changes. Map each selected workflow ID to its observed board ID or to `null` if it is unassigned. A save moves selected workflows from their previous boards and unassigns current members omitted from the list.

To move or remove one workflow, use `action: "assign"` with `workflowId`, `boardId`, and `expectedBoardId`. Use `null` for either board ID when it represents no board. If a revision or membership check fails, read the current state before saving again. Moving or unassigning a workflow clears its imported stage mappings. To map its stages on another board, reimport the bundle with board setup or select local columns in the workflow draft and publish it.

To see run cards, call `read_workflow_boards` with `action: "get"`, the board `id`, and a `column` ID. Use `queued` or `unstaged` for the corresponding built-in columns. Filter by `workflowId` or `status`. The response shows totals for the filtered columns and cards for the requested column. The page defaults to 30 cards and accepts up to 100. Pass a card's `request` as the `target` to `workflow_requests` with `action: "get"` to read the captured question and evidence.

## Find work and answer a request

The **Boards** page lists each board's assigned workflows and shows a badge when it has unresolved requests. Select a board name to see its runs. Search by name and use **Clear search** to restore the full library.

Filter the board by workflow or **Status**. If no runs match, **Clear filters** returns to all workflows and statuses. **Needs attention** counts unresolved requests in the selected workflow scope. A card can match this filter while another branch progresses. Use **Runs → Needs attention** to find requests across the library and review automation alerts.

Select a run card to open its inspector. Use the separate review action to open the oldest unresolved request, then **Switch request** to open another request from that run. Read the question and any captured evidence before answering. In the request view, **Open run** selects the exact step. Returning to the board restores its filters and loaded column pages.

A response applies to one request. Review the receipt for acceptance and any remaining requests. If another interface answers first, the request keeps the accepted decision visible and preserves your unsent text for copying. If an acceptance hold blocks the answer, select **Release acceptance hold**. Then select **Accept saved answer**. For a library or workflow pause, use **Open run** to inspect and release the applicable pause.

## Add Human input to a workflow

Choose **Human input** in the node picker. Enter a question and choose **Text** or **Single choice**. For each choice, enter a label and an output value. Enable **Require comment** on choices that need an explanation.

Use the node's input bindings to bring data from previous steps into the request. In **Use input data in the request**, set an input path for the question, context, or evidence you want to display. For a plan review, bind the plan text and its revision, then use those paths in the evidence fields. Interlock captures the resolved content once per step visit. For approval of a specific artifact, supply its content or an immutable revision reference.

A text answer becomes a string output. A choice answer becomes an object with `choice` and an optional `comment`. The `choice` field contains the configured output value. To branch on a decision, connect a Branch node and select the `choice` path.

## Find a run by title

Enter a **Run title** when starting a run in the browser, or pass `title` to MCP `start_run`. The CLI accepts `--title TEXT`. Automations can set **Run title** in their settings. Boards and Runs display the explicit title first, then the external task title, then the workflow name.

Each board card follows one root run and its continue-as-new chain. Waited children, Batch items, and Parallel branches contribute stage entries and requests. Detached runs get separate cards. A card keeps the last matching column it reached. A queued start appears in **Queued**. An admitted run with no matching entry appears in **Unstaged**. Finished runs keep their last placement and an outcome badge. Boards show up to 20 finished runs without unresolved attention per column for 24 hours. The full retained history is in **Runs**.
