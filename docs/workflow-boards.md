# Use Workflow Boards

## Set up a board

1. Open **Boards** and choose **New board**.
2. Name the board and add the stage columns. Edit their names and order in the form.
3. Select the workflows to include. If a workflow belongs to another board, the form names the board it moves from.
4. Save the board. You can also change membership in **Workflow settings → Board**.

Membership applies to existing and future runs as soon as you save. It is independent of publication. To place runs in a stage, open a node's settings, choose a board column in **Stage**, and publish the workflow. Selecting a column binds its ID. Typing stage text creates a label for run summaries, even if the text matches a column. Renaming or reordering a column preserves its bindings. A draft, retained version, or retained run can prevent column removal.

## Find work and answer a request

The **Boards** page lists each board's assigned workflows and shows a badge when it has unresolved requests. Search by board name and select **Open board** to see its runs.

Filter the board by workflow or **Status**. **Needs attention** counts unresolved requests in the selected workflow scope. A card can match this filter while another branch progresses. Use **Runs → Needs attention** to find requests across the library and review automation alerts.

Open an attention card to review its oldest unresolved request. Use the request selector to switch between requests from the same run. Read the question and any captured evidence before answering. Use **Open run** to inspect the exact step in the run inspector.

A response applies to one request. Review the receipt for acceptance and any remaining requests. If another interface answers first, the request keeps the accepted decision visible and preserves your unsent text for copying. If an acceptance hold blocks the answer, select **Release acceptance hold**. Then select **Accept saved answer**. For a library or workflow pause, use **Open run** to inspect and release the applicable pause.

## Add Human input to a workflow

Choose **Human input** in the node picker. Enter a question and choose **Text** or **Single choice**. For each choice, enter a label and an output value. Enable **Require comment** on choices that need an explanation.

Use the node's input bindings to bring data from previous steps into the request. In **Use input data in the request**, set an input path for the question, context, or evidence you want to display. For a plan review, bind the plan text and its revision, then use those paths in the evidence fields. Interlock captures the resolved content once per step visit. For approval of a specific artifact, supply its content or an immutable revision reference.

A text answer becomes a string output. A choice answer becomes an object with `choice` and an optional `comment`. The `choice` field contains the configured output value. To branch on a decision, connect a Branch node and select the `choice` path.

## Find a run by title

Enter a **Run title** when starting a run in the browser, or pass `title` to MCP `start_run`. The CLI accepts `--title TEXT`. Automations can set **Run title** in their settings. Boards and Runs display the explicit title first, then the external task title, then the workflow name.

Each board card follows one root run and its continue-as-new chain. Waited children, Batch items, and Parallel branches contribute stage entries and requests. Detached runs get separate cards. A card keeps the last matching column it reached. A queued start appears in **Queued**. An admitted run with no matching entry appears in **Unstaged**. Finished runs keep their last placement and an outcome badge. Boards show up to 20 finished runs without unresolved attention per column for 24 hours. The full retained history is in **Runs**.
