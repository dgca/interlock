# Interlock

Interlock is a local workflow editor and engine for AI agents. Define a procedure once, combine agent assignments with HTTP requests and JavaScript or Bash steps, and inspect each run in your browser.

Build workflows visually or edit their JSON definitions. Interlock validates inputs and results, runs scripts, and stores progress in SQLite. A connected agent can handle assignments through the Model Context Protocol (MCP), or Interlock can launch a configured Claude Code, Codex, or Pi harness automatically.

Workflow `maxActiveRuns` and stage exclusions can queue starts until capacity is available. Starts also support dependencies, priority, and atomic active-task policies. See [start admission](docs/idempotent-run-starts.md). Optional node stages and shared run waiting/actor fields support board projections and diagnostics. Add a readable title to external task correlation when starting a run. See [run projections](docs/agent-workflows.md#project-run-stages-and-waiting).

## Install and run

Requires **Node.js 24.13 or later** on **macOS or Linux**. Bash script nodes also require `/bin/bash`.

```sh
npm install -g @type_of/interlock
interlock
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310) in your browser. The package includes the engine, UI, CLI, and MCP tools. No separate build is required.

You can also start Interlock with `npx -y @type_of/interlock@latest` without a global installation. Both startup methods use the same HTTP MCP connection flow.

Workflow editors and run inspectors have bookmarkable URLs. Reloading restores the workflow or run, and browser Back and Forward follow your navigation. Each workflow has **Editor** and **Runs** tabs. The workflow Runs tab and its Active or History filter survive reload. Switching between Editor and Runs retains local edits. Unsaved draft edits still require saving; navigation asks before discarding them.

Keep the terminal running while you use Interlock. Closing the browser does not stop the engine. Press Ctrl+C in the terminal to stop it.

To stop a runaway tree, use **Cancel run tree** in its inspector and explicitly include detached descendants when needed. CLI and MCP provide the same bounded preview and atomic cancellation state. External work can still require stop reconciliation. See [cancel a run tree](docs/workflow-execution.md#cancel-a-run-tree).

## Run your first workflow

New libraries start empty. Open **Workflows → Import → Starters**, select **SDLC workflow**, and choose **Add to library** for a published procedure that plans, implements, and reviews a software change. It creates a task branch, saves planning artifacts, and commits the completed change. It finishes locally by default. Existing libraries keep their workflows when you upgrade. Nothing is added or run automatically.

The picker also offers **Evaluate workflow comparison**. Known existing copies have an **Open workflow** action; **Add another copy** is explicit. GitHub folders, local files and pasted JSON share the same import dialog and show a preview before importing. See [starter workflows](docs/starter-workflows.md).

For a standalone file import, use [workflows/sdlc.json](workflows/sdlc.json). In **Import → GitHub folder**, use `https://github.com/dgca/interlock/tree/main/workflows`, select **SDLC workflow**, and choose **Import workflow**. Review the imported draft and publish it before running. See [Import the SDLC starter](docs/sdlc-workflow.md#import-the-starter-into-an-existing-library) for local-file and CLI options.

For a node-editor reference, the same folder includes [All nodes (demo)](workflows/all-nodes.json), an optional example covering every current node type. Import it and inspect the editors without starting a run. See [Workflow examples](workflows/README.md).

Use a coding agent with access to your Git checkout, files, and development commands. The final review requires a fresh session or an isolated subagent without the implementation conversation. With connected-agent execution, your agent provides that reviewer. An enabled managed harness can launch a fresh review session.

1. Select **Connect with MCP** in the sidebar.
2. Follow the instructions for Codex, Claude, OpenCode, or another MCP client.
3. Restart or reconnect your client so it can discover the Interlock tools.
4. Open your target Git project in the agent and ask it:

   ```text
   Find the Interlock workflow "SDLC workflow" and run it with
   {"request":"Improve this project's setup instructions and verify the documented commands."}.
   Complete its assignments, pause for unresolved human decisions, and use
   a fresh session or isolated subagent for the final review.
   ```

5. Open **Runs → Active** and select the execution to follow its steps. Completed, failed, and cancelled executions appear in **History**.

Replace the example request with the change you want. The workflow resolves the target repository and artifact directory, follows that repository's instructions, and asks when a consequential decision remains unresolved. Set `reviewPolicy` to `always` to approve each planning artifact, or `createPr` to `true` to request PR delivery. Your agent's tool approval settings still apply. See [Use the SDLC workflow](docs/sdlc-workflow.md) for inputs, executor requirements, and resuming work.

The connection uses Streamable HTTP at `http://127.0.0.1:4310/mcp`, served by the same process as the UI and engine. Keep that process running. Upgrading and restarting at the same address preserves your agent configuration. The dialog also provides a stdio fallback for clients that need it. See [Connect a harness](docs/connect-harness.md) for configuration and the assignment loop.

## Install workflow skills

To audit an older workflow or compare two versions, install the optional skills from the project where your agent works.

```sh
npx skills add dgca/interlock \
  --skill interlock-migrate-workflows \
  --skill interlock-compare-workflows
```

See the [harness guide](docs/connect-harness.md#install-workflow-skills) for user-wide installation, harness selection, and manual setup.

## Run agents automatically

Open **Harnesses** in the sidebar to set the shared concurrent assignment limit, default Limited to 3 with an Unlimited option, optional per-profile limits, and configure an installed Claude Code, Codex, or Pi executable. Configurations start disabled. Set the working directory, default permissions, model and optional thinking effort, then enable the configuration. Model pickers load native choices and accept custom IDs; Use CLI default retains the harness’s own selection. Choose it in **Workflow settings → Default Agent executor** or override it in an Agent node’s **Execution → Executor** settings, save and publish. Workflow **Agent model** and **Thinking effort** can inherit harness defaults; Agent nodes can override both. Workflow **Agent permissions** can inherit the harness default or select **Read only**, **Standard** or **Full access**. Existing workflows keep connected-agent execution unless you opt in. If a managed harness refuses the model before task actions, the run waits for you to choose a replacement and retry the assignment. See [model recovery](docs/managed-executors.md#replace-a-refused-model).

Interlock launches ready assignments inside its existing server, including independently started workflows. A badge beside **Runs** and the **Needs attention** tab surface approvals, questions, model selection, and recovery checks. Permission requests and questions appear in the run inspector; stopping or losing a session requires explicit recovery before retrying. Installation detection makes no model calls and does not verify authentication. See [managed Agent execution](docs/managed-executors.md) for setup, native authentication requirements, MCP/CLI operations and limitations.

## Create a workflow

Select **New workflow** to create a draft. Use **Add node** to choose each step's type, then connect the nodes in execution order. Agent is selected initially; choose another type when needed.

Available nodes include entry and exit, Agent, Script, Fetch, Wait, External input, Branch, Workflow, and Batch. Branch unifies Condition and Switch authoring while retaining existing definitions. A Workflow node invokes a pinned published workflow once. It defaults to **Wait for result**. Choose **Start and continue** to return a run reference immediately while the invoked workflow runs independently, even after ordinary parent cancellation. See [Workflow execution](docs/workflow-execution.md). A Batch repeats a visible path for each item and collects the results in input order.

Node settings group the work, input, result and execution controls. Agent, Script, Fetch and waited Workflow steps can branch on an accepted result and construct forwarded fields using fixed values, missing-field defaults and nested objects. The engine validates and routes the raw result before shaping the output. See [Step data and result branches](docs/node-data.md).

Script settings offer **Background execution** for commands that must survive a server restart. A local supervisor enforces the deadline and records a durable result while Interlock is offline. Run inspection shows bounded progress; uncertainty requires explicit stopped reconciliation before retry. Foreground execution remains the default. See [Scripts and interruptions](docs/architecture.md#scripts-and-interruptions).

Script, Fetch and waited Workflow settings offer **Route on failure** to send structured error data through a **Failed** connector. Existing nodes still stop the run by default. See [failure routes](docs/failure-routes.md) for the error contract and limits.

Add a **Batch** and configure its items path and concurrency. Use **Add step** inside the group to create an Agent, Script, or other ordinary node. The first step connects to **Start** automatically. Connect additional steps within the group; connect the last step on every branch to **End**. Connect **Out** to the next step or Exit. The output route receives the ordered results after all items finish. Group members remain visible on the main canvas. Collapse hides them temporarily; moving the group moves its members.

```text
Entry → Batch
        ├─ [Start → Research item → End]
        └─ Out → Synthesis → Exit
```

For input `[3, 4, 5]`, a Script on the item path containing `return input * 2;` produces `[6, 8, 10]` on Out. An Agent can research each item directly on the canvas.

Leave **List to process** blank to use the complete input, or enter the path to an array such as `response.items`. Batches default to 200 items. Set **Maximum items** to a whole number from 1 through 10,000 to allow a larger list. Oversized input fails before any items start, with the actual count and limit in the error. **Items at a time** controls how many items run at once, from 1 through 50. Choose `all` to receive raw item outputs or fail and cancel unfinished items on an error. Choose `collect` to receive `{runId,status,output,error}` records. Both arrays retain input-item order. See [Batch output](docs/architecture.md#batch-output) for examples and failed-item values. Item paths can contain nested Batches and Workflow nodes, subject to ten nested levels.

For a 207-item backlog, set **Maximum items** to 250 and **Items at a time** to 3, then publish a new version. In Raw JSON or MCP, the Batch configuration is:

```json
{
  "id": "backlog",
  "kind": "batch",
  "label": "Process backlog",
  "itemsPath": "",
  "maxItems": 250,
  "concurrency": 3
}
```

This Batch accepts the whole input array and runs up to three items at once. `maxItems` counts the selected list, `concurrency` limits active item runs, and `maxSteps` bounds each run's node executions. Raising one does not raise the others. Input contracts can impose stricter bounds. Larger batches store more item runs and results and can slow the local engine and inspector; the maximum setting is a validation bound, not a throughput guarantee. Existing published versions retain their configured limit, or 200 when `maxItems` is absent. Nested Batches each enforce their own item limit.

In node settings, **Input → Source** defaults to **Previous step output**. Select **Choose fields** to build a named input object. **Expected format** describes the input structure the step accepts. When that contract is empty, the editor can suggest a shape from a connected predecessor or selected input fields. The suggestion does not change validation unless you choose **Use as expected format**. Typed inputs suggest paths in node settings and types for new Switch cases; paths remain editable. New fields default to **Previous step output**. Choose **Node output** to select a source node. Enable **Default if no completed output** to supply a value when the source has no completed output in the current run. The **Reads from** canvas label focuses the source. [Input binding rules](docs/agent-workflows.md#bind-original-input-into-later-steps) also apply to Advanced JSON, CLI, and MCP.

Configure input and output contracts in the node settings. Entry and Exit display the shared workflow input and output contracts. With a blank items path, Batch input must be an array; with a named path, the selected value must be an array. Use **Visual / Raw** to switch between the graph and its JSON definition. The raw editor checks JSON syntax and structure before saving. Publishing also checks the workflow's graph.

Agents can read `get_workflow` and apply small ordered changes with `edit_workflow` using the current draft revision. Edits save atomically and preserve unrelated fields. `validate_workflow` reports save errors, publication blockers, and conservative contract warnings without saving or publishing. See [atomic editing and preflight](docs/agent-workflows.md#edit-a-draft-atomically) for operations, deletion policies, no-op behavior, and diagnostic limits.

Select **Review & publish** when the draft is ready. The review compares the current definition, including unsaved edits, with the latest published version. It lists node, route, prompt, setting, contract, and layout changes; expand an item to inspect its values. A new workflow shows its first publication. Select **Publish version** in the review to save the draft and publish it, then **Run v1** to supply input and start a run. Each run uses a fixed published version. Editing a draft does not change an existing run.

Use **Undo** and **Redo** beside **Save draft** to reverse or restore up to 50 editor actions. The shortcuts are Ctrl/Command+Z and Ctrl/Command+Shift+Z; text fields keep their own typing undo. A drag, group move, deletion, connection change, or settings application counts as one action. Saving preserves history. Leaving the workflow, reloading the page, or loading an external draft clears it. Undo changes the editable draft, never a published version.

In Raw, **Save** beneath the code editor writes the workflow draft and records one history action. **Discard** restores the definition from when you entered Raw or last saved successfully, preserving earlier visual edits. Save or discard raw changes before returning to **Visual** or using workflow Undo and Redo. Failed saves retain your raw text.

The workflow editor and run inspector share navigation controls. Scroll to pan, pinch or hold Command/Control and scroll to zoom, and hold Space while dragging or drag with the middle mouse button to pan. Run graphs remain read-only; click a node to inspect its execution.

Hold **Z** and drag from empty canvas space to draw a zoom rectangle. Release the mouse to fit that area into view. Press **Escape** or release Z before releasing the mouse to cancel. A click without a drag does nothing. This shortcut is inactive in text fields and settings dialogs and does not add to Undo history.

The **Tidy** icon sits below **Fit View** in the canvas controls and runs your last chosen layout in one click. The gear beneath it opens **Tidy mode**, where you can choose **Dagre** or **ELK**. The choice is remembered in this browser across workflows and sessions; Dagre is the initial default. Choosing a mode leaves the layout unchanged until you click Tidy. ELK loads its layout engine on first use and keeps branch handles in order. Use either to arrange the whole workflow from left to right, including nested Batch contents, and fit it into view. Tidy uses expanded Batch sizes so groups have room when reopened. It accounts for output handle positions to reduce avoidable branch crossings. Complex graphs and loops may still have crossings. It changes only positions and can be undone in one step. Save the draft to keep the arrangement. Imported and agent-authored positions remain as supplied until you tidy them.

### Compare workflow behavior

Use the MCP [workflow testbench](docs/workflow-testbench.md) to save representative cases, preview and execute two published versions, and inspect execution, assertion and quality results alongside timing, reported cost and evaluation coverage. Existing Runs views label each comparison, case, baseline/candidate side and repetition, with counterpart navigation. These are real runs using managed or connected executors and normal Script and Fetch actions. Comparison configuration stays in MCP, including optional exact per-side prompt revisions and requested executor/environment references. Reports distinguish those requests from declared and usage-reported models. Publication remains separate.

For trusted local repository work, use [managed Git trials](docs/local-git-trials.md) to prepare a separate checkout per sample, route Scripts and Agent assignments to it, retain evidence and track cleanup. External executors must prevent outbound writes; the recipe is not an OS sandbox.

Choose the [evaluation starter](docs/workflow-evaluation.md) to grade retained comparison outputs with a fixed rubric, fresh artifact reviewers or frozen checks, and resumable judgment receipts. Its usage stays separate from the original trials.

Import the [workflow improvement starter](docs/workflow-improvement.md) for one inline prompt candidate, fixed tuning and separate acceptance cases, bounded trial budgets and a revision-bound adoption proposal. Experimental versions stay on a separate workflow; production remains unchanged.

Use [fixture simulation](docs/workflow-simulation.md) to test supported flat graphs with saved Agent, Script and Fetch outcomes without model calls or external effects. Simulated reports stay separate from live comparisons. Author cases with `interlock test-suite` and run or inspect them with `interlock simulation` or the grouped MCP tool.

### Create a child workflow

Use child workflows for helpers that belong to one parent. The main library shows library workflows only. Open a parent's **Child workflows** tab to find its helpers, including children not connected to a node.

In **Add node**, choose **Workflow**, select **Create child workflow**, and enter a name. **Save and create child** saves the parent draft and its new node together, then opens the child editor. Save or discard Raw edits before creating a child. The Child workflows tab also creates children without adding a node.

Edit and publish the child with the ordinary editor. Select **Use v1 in [node name]** to pin that version in the parent draft and return to the parent. Connect the new node and publish the parent. A reference to an unpublished child can be saved but blocks publication. By default, later child publications do not change existing pins. Select a newer version explicitly in node settings or from the child editor.

The child editor links back to its owner and retains its own stable URL and Runs tab. Only the owner can reference a child. Children may invoke library workflows but cannot own or reference other children. Ownership has one level; the existing ten-level execution limit still applies.

Existing workflows can be adopted, reparented or released through MCP while preserving their IDs, versions and history. See [ownership changes](docs/agent-workflows.md#change-workflow-ownership). The UI does not yet provide move controls, main-library child search, or parent cloning with children. Parent clone is disabled, and deletion rejects parents with children. Portable export includes owned children and dependencies. Delete unreferenced children first; published references can block child deletion. Archive the parent to hide it from the active library. Complete lifecycle operations are required before releasing this feature.

### Follow an execution

Open **Runs** to find active executions and past results. The live view shows step states and Batch item counts. Select a Batch child step, then an item, to inspect that item's input, output, and errors.

Starting a workflow with connected-agent execution does not launch an agent. When an assignment is ready, select **Copy instructions for agent** and paste the instructions into a connected agent conversation. The instructions resume the existing execution. **Waiting for an agent** means work is available; **Agent working** means an executor has claimed it.

Connected Agent **Model tier** optionally requests Max, Balanced, or Fast capability with either Context setting. Managed Agents select concrete **Model** and **Thinking effort**, inheriting node → workflow → harness configuration → native defaults. Connected executors choose the model; required session continuity and isolation take precedence. Run inspection separates requested tiers, declared selections, and usage-reported models. See [model tiers](docs/model-tiers.md).

Manual completion of unrestricted current-context assignments keeps claim credentials in page memory. Navigation within Interlock preserves the claim, but reloading or closing the page loses its token. An active lease must expire before the assignment can be reclaimed, and expiry consumes its configured recovery budget. See [manual claims](docs/connect-harness.md#manual-claims-in-the-ui).

Failed executions can be retried from the inspector. Retrying a failed Batch preserves successful items. Retrying Script or Fetch steps can repeat external side effects.

### Manage workflows

Agents can request the editor's Dagre Tidy layout during draft creation or updates with `layout: "tidy"`. Omitting it preserves the supplied positions. See [arrange drafts during authoring](docs/authoring-layout.md) for MCP, shared API, and CLI examples.

Archive a workflow to move it out of the active library, or restore it later. **Delete** is available from each workflow's menu in the library and from each card's menu in **Child workflows**. Inside a workflow, the three-dot menu beside **Run** contains **Workflow settings** and **Delete workflow**. A workflow with owned children must have them removed first. The dialog links to **Child workflows** when they block deletion. A confirmation dialog precedes removal of the workflow, its published versions, and run history. Active executions and references from other workflows also block deletion. Obsolete published callers can be removed through [explicit version cleanup](docs/version-cleanup.md) after a preview and informed agreement. Cleanup keeps run records. Removing a run's current bound definition removes its graph and retry capability until the original definition is restored from backup. Removing only an earlier execution's definition keeps the current graph available.

### Waits and unanswered assignments

Add a **Wait** node to pause for a duration or until a timestamp from input. The duration editor accepts milliseconds, seconds, minutes, hours, or days. Wait passes its input through unchanged and stores its deadline in SQLite. Cancel stops the wait; restarting resumes it from the original deadline.

To wait for something slow outside Interlock, such as an environment bootstrap or a CI run, choose **When a check passes**. The server runs a Script or Fetch check on an interval against the step input until the chosen output field equals the expected value, then continues with the input merged with the check output. The slow work runs outside the node; a check is a short probe, so a restart can repeat the check. If it declares resources, uncertain interrupted ownership must be reconciled first. An optional deadline aborts an in-flight check and routes the original input through **Timeout**. Disabling the deadline removes its connection when editor changes are applied. See [timers](docs/timers.md#polling-waits).

Agent settings include **Claim lease** (10 seconds to one hour, five minutes when unset). Workers can override this duration and must renew before expiry. Enable **Separate lease expiry budget** to count missed renewals separately from reported failures; reaching either limit fails the run. See [claim duration and expiry](docs/agent-workflows.md#claim-duration-and-expiry).

In Agent settings, enable **Route on unclaimed timeout** and set **If unclaimed for**. Connect **Result** to the successful continuation and **Timeout** to a reminder, escalation, or exit. Timeout receives the original input. Claiming stops the timer; a failed or expired claim starts a fresh timer when work becomes available again. This does not limit how long a claimed assignment can keep renewing its lease.

For a three-day reminder loop, route Timeout to a Script that sends the reminder and returns the original input fields with an incremented reminder count. Use a Condition to exit after the desired number or route back to the Agent. Fetch returns its HTTP response, so a Fetch-based reminder path must restore the request fields and counter before returning to the Agent. Each visit consumes a step; elapsed waiting time does not. See [timer configuration and execution rules](docs/timers.md).

Workflow-level routes can loop back to an upstream node other than Entry. The same run re-executes that node, bounded by `maxSteps`. Batch item paths must be acyclic and reach their owning Batch's End handle.

`maxSteps` allows 2 through 1000 steps per run and defaults to 100. Entry, Exit, and every node visit count, including explicit retries that create a new execution. A Batch counts once in its parent; each item has its own budget. For example, 200 items with three steps each fit a three-step item budget, with a separate three-step parent path of Entry → Batch → Exit. The independent Batch `maxItems` limit defaults to 200.

Run versions stay pinned by default. Opt into [compatible version upgrades](docs/workflow-execution.md#move-a-run-to-a-newer-version) to apply new publications before new steps. Explicit moves preview compatibility blockers and retain timestamped reasons; captured assignments finish under their original definition.

Standalone recurring Agent workflows can use an Exit with `continueAsNew:{maxRuns:100}` to pass a checkpoint into the predecessor's current published version with fresh step history. Runs remain pinned by default; explicit upgrades carry into the successor without resetting the chain cap. The chain retains captured prompts and budget consumption. Inspect lineage and stop it from any member. See [continue as new](docs/continue-as-new.md).

### Retry a task start safely

Optional `start_run.requestId` recovers the original run after repeated delivery or a lost response. `externalTask` links a run to a non-secret task identity for existing lookup tools. Old keys cannot recreate deleted history; deliberate new attempts use new keys. Optional [run tags](docs/idempotent-run-starts.md#tag-and-filter-runs) label ordinary and triggered runs with up to 16 string pairs. Filter Runs, MCP `list_runs`, or `interlock runs --tag repo=dgca/interlock` by exact pairs. Tags inherit through child runs and chains. See [idempotent run starts](docs/idempotent-run-starts.md) for MCP, CLI and retention rules.

### Coordinate shared resources

Agent, Script, Fetch, and polling Wait nodes can require exclusive named resources so cooperating steps share a checkout, browser, or device without overlap. Operations wait before launching, without spending execution timeouts. Interruption and cancellation retain uncertain reservations until the owner confirms it stopped. See [step resources](docs/work-resources.md) for scope, settings, and recovery.

### Resume an agent run

Use MCP `get_run_briefing` with the existing run ID for current progress, available and claimed work, blockers, Batch counts, deadlines, and result references. Detached trees have independent lifecycle counts, including after the requested run finishes. Use `get_run_result` to read one input or output path, and `wait_for_run_change` with the returned cursor to wait for a scoped change. Waits default to 30 seconds and stop after at most 60 seconds. These reads do not claim or execute work.

MCP `start_run` and `submit_result` default to `detail: "summary"`, and `list_work` defaults to `fields: "summary"`. Compact mutation responses contain lifecycle-scoped status, a wait cursor, bounded next work, and a suggested read-only next call. Use explicit `"full"` for definitions and execution payloads. UI and CLI calls return full responses. Consumers upgrading from 0.1 can follow the [MCP migration guide](docs/upgrading.md#mcp-response-defaults-in-02). See [compact mutation responses](docs/agent-workflows.md#continue-with-compact-mutation-responses).

See [run continuation operations](docs/agent-workflows.md#resume-a-run-with-a-briefing) for response bounds, cursor recovery, and cancellation. `get_run`, `list_work`, and existing CLI commands remain available.

### Switch nodes

Use **Switch** to choose among several named routes from one input value. Choose an input field, add cases with typed match values, and connect every named branch. Text matches can be entered without JSON quotes. The first matching case wins. Unmatched values fail the run unless you choose **Follow a fallback branch** under **When no case matches** and connect that branch. A missing path always fails the step. Switch passes its input through unchanged and supports input bindings. See [Switch routing](docs/switch.md) for an example and editing rules.

### Fetch nodes

Use **Fetch** to call an HTTP API through a form. Bind input fields into the URL, query parameters, headers, or JSON body, and preview the resolved request with sample input. The output contains `status`, `headers`, and `body`. See [Fetch requests](docs/fetch.md) for binding rules, response handling, and retries.

Use **Variables** to manage reusable configuration and credentials centrally.
Select variable references in Fetch headers or Script environment entries,
including polling checks. Rotating a value updates subsequent runs of published
workflows without republishing. Secrets use protected storage and have no read-back
action. Back up the separate encryption key alongside a separately stored database
backup. See [workflow variables](docs/variables.md) for management, capture,
redaction, and import requirements.

Individual body fields with a fixed value have typed controls, so text needs no JSON quotes and existing JSON values keep their types.

### External input

Use an **External input** node to pause a run for an answer from an integration. Set the **Submitted value** contract in **Result**. The integration submits an answer to the waiting execution, then accepts the exact revision to advance the run. See [Wait for an external answer](docs/external-input.md).

### Script nodes

New script nodes default to JavaScript. Read the incoming JSON value as `input` and return a JSON value for the next node. Top-level `await` is supported:

```js
const doubled = await Promise.resolve(input.number * 2);
return { number: doubled };
```

For input `{"number":21}`, this returns `{"number":42}`. Configure the node's contracts to accept these fields.

Bash scripts read JSON from stdin and must write one JSON value to stdout. Write diagnostic messages to stderr. JavaScript `console.log` messages go to stderr automatically.

To identify the current run, read `process.env.INTERLOCK_RUN_ID` in JavaScript
or `"$INTERLOCK_RUN_ID"` in Bash. Script checks in polling Waits receive the
same context. See [Script execution context](docs/architecture.md#script-execution-context)
for execution IDs, retry attempts, and Batch item fields.

New Script nodes default to a 60-second timeout. Set **Timeout** in **Execution** to allow between 100 milliseconds and one hour.

A thrown error, nonzero exit, timeout, or invalid output fails the script step. Scripts are not retried automatically.

The library **Import** dialog opens on bundled **Starters** and also accepts pasted JSON, local JSON files, and public GitHub folder links. **Paste JSON** accepts a legacy workflow or portable bundle. Paste the document, choose **Preview workflow**, then **Import workflow** after reviewing it. Invalid JSON and server validation errors keep the text available for correction. Choose **GitHub folder**, paste an HTTPS `github.com/OWNER/REPO/tree/REF/FOLDER` URL, and select **Find workflows**. Review each workflow's description, source file, and dependencies, then select the workflows and choose **Import workflow**, or **Import N workflows** for multiple selections. Branch names containing slashes and commit links are supported. Discovery reads direct JSON files only and pins the preview to a commit. Invalid files remain unselectable and do not hide valid workflows.

GitHub selections import together. Any invalid selection or differing existing draft, metadata, ownership, published version, or saved prompt rejects the whole selection without changing the library. Portable bundles retain their IDs and pins. Identical workflow definitions are unchanged, but every included schedule is disabled and its revision advances, even on an identical reimport. Import recalculates its next slot and interval anchor, clears automatic pause, resets its failure count and last measured lag, and preserves local runs and fire history. Schedules omitted from the bundle are unchanged. Legacy files create a new workflow each time. Import saves definitions and prompts without starting runs. Local files remain available under **Local file** unless disabled by the host. Paste JSON and local files use the same import operations and conflict rules. GitHub import supports public repositories only, with at most 50 direct JSON files and 2 MiB per response or file; requests time out after 60 seconds. Private authentication, recursion, and automatic updates are not supported. Variable-bearing portable bundles require explicit local binding or unset provisioning in import preview. Format 7 also carries webhook configurations and their Secret requirements, always imported disabled. Format 8 also carries lifecycle-event configurations and their source workflow dependencies, always imported disabled. Neither Config nor Secret values are exported. See [workflow variables](docs/variables.md).

Folder metadata uses GitHub's public API; file downloads use raw GitHub URLs pinned to the resolved commit. Rate-limit feedback includes retry timing when GitHub provides it. If an import response is lost, inspect the library before retrying, especially for legacy files: the import may have completed. A confirmed rejection reports **Nothing imported**. A library refresh failure after success does not undo the import.

Scripts execute with your user account's filesystem, environment, and network access. They are not sandboxed, so review scripts before running imported workflows.

For embedded UI settings, see [Configure the embedded UI](docs/embedded-ui.md).

## Storage and configuration

Interlock listens on `127.0.0.1:4310` and stores workflows and runs in `~/.interlock/interlock.db`. Restarting the server retains saved data. Scripts use the directory where you started Interlock as their working directory.

Use **Runs → History → Clean up history** to preview and delete selected run trees while keeping their workflows and versions. CLI and MCP expose the same [manual history cleanup](docs/history-cleanup.md), including protection reasons and storage figures. There is no automatic age or count limit. Idle scheduling uses indexed active-run and assignment lookups, and unchanged waiting steps do not write or wake continuation readers. Retained history still uses disk space, and inspecting large run trees or evaluating their budgets costs more work.

To change the port, script working directory, or database path:

```sh
interlock --port 4400 --workdir /path/to/project --db /path/to/interlock.db
```

`INTERLOCK_WORKDIR` and `INTERLOCK_DB` provide defaults for the corresponding flags. Flags take precedence.

When using another port, copy the HTTP MCP URL from the connection dialog. Set `INTERLOCK_URL` for CLI commands and the legacy stdio bridge.

```sh
INTERLOCK_URL=http://127.0.0.1:4400 interlock workflows
```

HTTP MCP clients use the engine address with `/mcp` appended, such as `http://127.0.0.1:4400/mcp`.

## Use the CLI

With the engine running, open another terminal:

```sh
interlock workflows
interlock workflow WORKFLOW_ID
interlock start WORKFLOW_ID '{"name":"pikachu"}'
interlock run RUN_ID
interlock usage RUN_ID
interlock report
```

Replace `WORKFLOW_ID` with an ID from `interlock workflows` and `RUN_ID` with the run ID returned by `interlock start`. Match the input to your workflow's contract. Starting a run with agent assignments makes those assignments available for a connected agent to claim and complete.

Executor scripts can use `interlock work --summary` to route assignments by `rootWorkflowId`. `interlock renew WORK_ID TOKEN` reuses the original claim duration; add `'{"leaseSeconds":300}'` to request a specific duration. See [assignment discovery and claim renewal](docs/agent-workflows.md) for fields, bounds, and compatibility details.

Executors can report measured token usage and costs for each claim attempt. Measuring observers can report ended attempts without claim tokens; their snapshots take precedence in totals and budgets without double counting. The run inspector, `interlock usage`, and MCP expose totals and attribution with unknown or partial coverage when data is missing. See [usage reporting](docs/usage-reporting.md). Optional [run budgets](docs/run-budgets.md) gate new Agent claims by attempt count or reported usage.

Run `interlock report` to evaluate workflow performance and cost over a bounded window, including run and stage durations, admission and human wait times, claim wait splits by new versus continuing sessions, failure and stall reliability metrics, model spend/coverage, and terminal exit outcomes. Also available via UI **Reports** (`/report`) and MCP `workflow_report`.

JSON arguments also accept `@filename`, such as `interlock start WORKFLOW_ID @input.json`. Run `interlock commands` for the full command list or `interlock --help` for server options.

### System health and readiness check

Run `interlock doctor` to verify system readiness before starting work or unattended pipelines:

```sh
interlock doctor
interlock doctor --json
interlock doctor --live
```

`interlock doctor` performs read-only diagnostics across SQLite integrity, schema version, free disk space, history size, enabled harness binaries and allowed roots, active trigger lag, pause holds, uncertain resource reservations, work stalls, and published workflow variable dependencies. Adding `--live` performs a live model connectivity check on enabled harnesses. The CLI exits with code 0 on passing/warning checks and code 1 on failure. These diagnostics are also accessible via UI **Diagnostics**, MCP `doctor`, and the shared API `system.doctor`.

## Current scope

Interlock is a local, single-user application. Agent steps use connected executors, manual submission, or opt-in managed Claude Code, Codex, and Pi sessions; script steps run in the engine. Managed harnesses use their native account and permission configuration.

Agent nodes can opt into [context continuity groups](docs/context-continuity.md) to declare a shared session within a run, with recorded handoffs when the session must change.

A connected executor supplies the tools, skills, and context isolation requested by a workflow. Interlock checks the executor's declared capabilities but does not install or provide them.

See [Scope and limits](docs/v1.md) for execution limits and unsupported features.

## Develop locally

From a source checkout, use Node.js 24.13 or later and pnpm 11.7:

```sh
pnpm install
pnpm dev
```

The development UI runs on [port 5173](http://127.0.0.1:5173), with the engine on port 4310. Stop any installed Interlock server using port 4310 before starting development.

Development stores data in `.interlock/interlock.db` inside the checkout. Installed copies use a separate database unless you pass `--db` explicitly. Run `pnpm build` followed by `pnpm start` to serve the built UI on port 4310 with the development database.

Validate changes with:

```sh
pnpm test
pnpm build
pnpm format:check
pnpm test:package
```

The build includes TypeScript checks. Tests cover workflow contracts, runtime behavior, and MCP over HTTP and stdio. The package test installs a local tarball into a temporary prefix and checks global and npx startup, the CLI, UI, both MCP transports, JavaScript execution, and claims across a restart. It does not publish anything.

## Project documentation

- [Domain language](CONTEXT.md)
- [Architecture and execution semantics](docs/architecture.md)
- [Scope and limits](docs/v1.md)
- [Harness integration](docs/connect-harness.md)
- [Create and reuse saved prompts](docs/prompts.md)
- [Reuse configuration and credentials](docs/variables.md)
- [Authenticated webhook triggers](docs/webhooks.md)
- [Lifecycle event triggers and quiescent teardown](docs/events.md)
- [Agent workflow operations, original-input and node-output bindings, and portable bundles](docs/agent-workflows.md)
- [Fetch requests](docs/fetch.md)
- [Upgrade and restore a database](docs/upgrading.md)
- [Release process](docs/releases.md)

## License

[MIT](LICENSE)

### Author children through MCP or the CLI

MCP create/update/publish accept `detail: "summary"` for compact acknowledgments; edit accepts `diagnostics: "summary"` for errors and new warnings with bounded samples of unchanged warnings. Authoring defaults remain full. CLI start/submit support `--summary`, and claim supports `--fresh` and `--lease`. See [agent workflow operations](docs/agent-workflows.md). MCP `create_workflow` accepts `ownerWorkflowId`. `list_workflows` returns compact summaries by default. Use `get_workflow` for one full draft or `includeDraft: true` for full workflow records and definitions. Its optional `ownerWorkflowId` filter works as follows: omit it for all workflows, set it to `null` for the library, or provide a parent ID for its children. Create and publish the child, then update the parent's draft with a Workflow node that pins the child's version. Include the parent's current `draftRevision` when saving. `list_workflows` and `get_workflow` also return `draftMatchesLatest`: true for a matching published definition, false for unpublished edits, and null before first publication. Draft revisions count saves; version numbers count publications.

The CLI accepts the same owner field in an import document:

```sh
interlock import '{"name":"Gather evidence","ownerWorkflowId":"PARENT_ID"}'
interlock workflows '{"ownerWorkflowId":"PARENT_ID"}'
interlock workflows '{"ownerWorkflowId":null}'
```

### Git-driven bundle sync and cascade publishing

Deploying workflow changes across environments supports atomic bundle sync with dry-run diffs and cascade publishing:

```sh
# Preview semantic differences against published definitions (ignoring layout and key order)
interlock import bundle.json --dry-run

# Import and publish workflows atomically in topological order
interlock import bundle.json --publish --cascade
```

`--dry-run` performs a read-only comparison against existing published definitions, ignoring diagram layout positions and object key ordering. `--publish --cascade` imports the bundle and publishes workflows in dependency order within a single transaction, updating downstream workflow node version references atomically.

Use MCP `preview_workflow_ownership` and `set_workflow_owner` to move an existing workflow. Only the proposed owner may reference it in any draft or retained published version. Explicit old-version cleanup can remove obsolete caller blockers after informed agreement. Release uses `ownerWorkflowId: null`. An import without an owner remains a library workflow. A draft Workflow node can use `"version": null` until its target is published. A published reference always uses a positive version number.

### Publish a shared workflow and its dependents

To publish a shared workflow and advance all its published callers, run:

```sh
interlock publish CHILD_ID --cascade
```

MCP callers can use `publish_workflow` with `{"id":"CHILD_ID","cascade":true}`. The shared API accepts the same `cascade` option. Ordinary publication, including the editor's review and publish flow, keeps parent pins unchanged.

The cascade follows references in each workflow's latest published definition, including archived workflows and references inside Batches. It advances references to affected workflows and republishes each dependent once, children before parents. Unrelated pins stay unchanged. Draft-only workflows and references found only in older versions are excluded.

Dependent drafts must match their latest published definitions. Publish or discard any definition edits before cascading. A dependency cycle or any validation failure rejects the whole operation, including publication of the requested workflow. Successful cascades update dependent drafts and their revisions, so an editor holding an older draft must reload before saving.

Existing versions retain their exact pins. Runs remain pinned by default; an opted-in [run version policy](docs/workflow-execution.md#move-a-run-to-a-newer-version) can accept the new parent version at a safe boundary. New runs use the new versions by default; starting an explicit older version still uses its original dependencies. Contracts are checked during execution, so test changed child behavior before cascading it to callers.

Agent executors can [check candidate results before submission](docs/result-preflight.md) without renewing claims or advancing runs. Submission rechecks live state and returns bounded correction diagnostics when a result is rejected.

[Assignment size diagnostics](docs/assignment-size.md) show UTF-8 byte contributions and advisory warnings before claims. Agent previews accept sample inputs and upstream outputs, with unresolved values marked unknown. Payload values are omitted from reports.

Agent result checks can require output paths or compare them with captured assignment input before acceptance. See [result checks](docs/result-preflight.md#check-results-against-assignment-input).

Use **Pause library** or **Pause workflow** to add independent [pause holds](docs/work-holds.md). CLI `interlock pause`, `pause-holds`, and `resume HOLD_ID`, MCP `manage_pause`, and the shared API use the same persistent gate. Release only your exact hold ID; all applicable holds must clear before execution resumes. In-flight work can finish and pending input revisions remain accepted.

Agent assignments can [hold for external blockers](docs/work-holds.md) and resume with a fresh claim, without consuming failure or expiry allowances. Run inspection separates wall time from declared hold intervals.

### Periodic workflow starts

Manage durable interval or five-field cron schedules from each workflow's **Triggers** tab, `interlock triggers`, or MCP `read_workflow_triggers` and `manage_workflow_triggers`. New and imported schedules start disabled. Fires use idempotent starts, honor library/workflow named holds and admission limits, and expose missed fires, lag and optional automatic failure pause in inspection and **Needs attention**. See [workflow schedules](docs/schedules.md) for policies, input bindings and CLI examples. `interlock schedules` remains an alias.

The same controls manage [authenticated webhook triggers](docs/webhooks.md). Signed JSON events can start runs through ordinary admission, submit pending input revisions, or cancel or hold matching external tasks. HMAC authentication requires a Secret variable and signed delivery identity and event time. Delivery inspection retains bounded outcomes without payloads. Optional `interlock --hooks-port 4311` exposes only `POST /hooks/:triggerId` on a separate listener; UI, tRPC, and MCP remain loopback-only.

[Lifecycle event triggers](docs/events.md) use the same controls to react to completed, failed, cancelled, needs-attention, or stalled runs. Select one source workflow, its owned children, or the library. Terminal triggers can wait for the entire source tree to stop before teardown. Durable receipts and inherited trigger chains prevent repeated delivery and bound cascades. New and imported event triggers start disabled.

Use opt-in [stall thresholds and Agent attempt limits](docs/timers.md#stall-detection-and-active-attempt-deadlines) to surface unattended work in Needs attention. Configure local defaults through Harnesses, `interlock stalls` or MCP `manage_stalls`; workflow and node settings override them.
