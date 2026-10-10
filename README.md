# Interlock

Interlock is a local workflow editor and engine for AI agents. Define a procedure once, combine agent assignments with HTTP requests and JavaScript or Bash steps, and inspect each run in your browser.

Build workflows visually or edit their JSON definitions. Interlock validates inputs and results, runs scripts, and stores progress in SQLite. Your connected agent handles assignments through the Model Context Protocol (MCP).

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

## Run your first workflow

New libraries include a published **SDLC workflow** for planning, implementing, and reviewing a software change. It creates a task branch, saves planning artifacts, and commits the completed change. It finishes locally by default. Existing libraries are preserved when you upgrade.

For an existing library, import the starter from [workflows/sdlc.json](workflows/sdlc.json). In **Import → GitHub folder**, use `https://github.com/dgca/interlock/tree/main/workflows`, select **SDLC workflow**, and choose **Import selected**. Review the imported draft and publish it before running. See [Import the SDLC starter](docs/sdlc-workflow.md#import-the-starter-into-an-existing-library) for local-file and CLI options.

For a node-editor reference, the same folder includes [All nodes (demo)](workflows/all-nodes.json), an optional example covering every current node type. Import it and inspect the editors without starting a run. See [Workflow examples](workflows/README.md).

Use a coding agent with access to your Git checkout, files, and development commands. The final review requires a fresh session or an isolated subagent without the implementation conversation. Interlock coordinates the work but does not launch that reviewer itself.

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

## Create a workflow

Select **New workflow** to create a draft. Use **Add node** to choose each step's type, then connect the nodes in execution order. Agent is selected initially; choose another type when needed.

Available nodes include entry and exit, Agent, Script, Fetch, Wait, Condition, Switch, Workflow, and Batch. A Workflow node invokes a pinned published workflow once. It defaults to **Wait for result**. Choose **Start and continue** to return a run reference immediately while the invoked workflow runs independently, even after parent cancellation. See [Workflow execution](docs/workflow-execution.md). A Batch repeats a visible path for each item and collects the results in input order.

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

In node settings, **Input → Source** defaults to **Previous step output**. Select **Choose fields** to build a named input object. **Expected format** describes the input structure the step accepts. When that contract is empty, the editor can suggest a shape from a connected predecessor or selected input fields. The suggestion does not change validation unless you choose **Use as expected format**. Typed inputs suggest paths in node settings and types for new Switch cases; paths remain editable. New fields default to **Previous step output**. Choose **Node output** to select a source node; its **Reads from** canvas label focuses that source. [Input binding rules](docs/agent-workflows.md#bind-original-input-into-later-steps) also apply to Advanced JSON, CLI, and MCP.

Configure input and output contracts in the node settings. Entry and Exit display the shared workflow input and output contracts. With a blank items path, Batch input must be an array; with a named path, the selected value must be an array. Use **Visual / Raw** to switch between the graph and its JSON definition. The raw editor checks JSON syntax and structure before saving. Publishing also checks the workflow's graph.

Agents can read `get_workflow` and apply small ordered changes with `edit_workflow` using the current draft revision. Edits save atomically and preserve unrelated fields. `validate_workflow` reports save errors, publication blockers, and conservative contract warnings without saving or publishing. See [atomic editing and preflight](docs/agent-workflows.md#edit-a-draft-atomically) for operations, deletion policies, no-op behavior, and diagnostic limits.

Select **Review & publish** when the draft is ready. The review compares the current definition, including unsaved edits, with the latest published version. It lists node, route, prompt, setting, contract, and layout changes; expand an item to inspect its values. A new workflow shows its first publication. Select **Publish version** in the review to save the draft and publish it, then **Run v1** to supply input and start a run. Each run uses a fixed published version. Editing a draft does not change an existing run.

Use **Undo** and **Redo** beside **Save draft** to reverse or restore up to 50 editor actions. The shortcuts are Ctrl/Command+Z and Ctrl/Command+Shift+Z; text fields keep their own typing undo. A drag, group move, deletion, connection change, or settings application counts as one action. Saving preserves history. Leaving the workflow, reloading the page, or loading an external draft clears it. Undo changes the editable draft, never a published version.

In Raw, **Save** beneath the code editor writes the workflow draft and records one history action. **Discard** restores the definition from when you entered Raw or last saved successfully, preserving earlier visual edits. Save or discard raw changes before returning to **Visual** or using workflow Undo and Redo. Failed saves retain your raw text.

Hold **Z** and drag from empty canvas space to draw a zoom rectangle. Release the mouse to fit that area into view. Press **Escape** or release Z before releasing the mouse to cancel. A click without a drag does nothing. This shortcut is inactive in text fields and settings dialogs and does not add to Undo history.

The **Tidy** icon sits below **Fit View** in the canvas controls and runs your last chosen layout in one click. The gear beneath it opens **Tidy mode**, where you can choose **Dagre** or **ELK**. The choice is remembered in this browser across workflows and sessions; Dagre is the initial default. Choosing a mode leaves the layout unchanged until you click Tidy. ELK loads its layout engine on first use and keeps branch handles in order. Use either to arrange the whole workflow from left to right, including nested Batch contents, and fit it into view. Tidy uses expanded Batch sizes so groups have room when reopened. It accounts for output handle positions to reduce avoidable branch crossings. Complex graphs and loops may still have crossings. It changes only positions and can be undone in one step. Save the draft to keep the arrangement. Imported and agent-authored positions remain as supplied until you tidy them.

### Create a child workflow

Use child workflows for helpers that belong to one parent. The main library shows library workflows only. Open a parent's **Child workflows** tab to find its helpers, including children not connected to a node.

In **Add node**, choose **Workflow**, select **Create child workflow**, and enter a name. **Save and create child** saves the parent draft and its new node together, then opens the child editor. Save or discard Raw edits before creating a child. The Child workflows tab also creates children without adding a node.

Edit and publish the child with the ordinary editor. Select **Use v1 in [node name]** to pin that version in the parent draft and return to the parent. Connect the new node and publish the parent. A reference to an unpublished child can be saved but blocks publication. By default, later child publications do not change existing pins. Select a newer version explicitly in node settings or from the child editor.

The child editor links back to its owner and retains its own stable URL and Runs tab. Only the owner can reference a child. Children may invoke library workflows but cannot own or reference other children. Ownership has one level; the existing ten-level execution limit still applies.

This authoring flow does not yet support moving existing workflows, finding children from the main library search, or cloning parents with children. Parent clone is disabled, and deletion rejects parents with children. Portable export includes owned children and dependencies. Delete unreferenced children first; published references can block child deletion. Archive the parent to hide it from the active library. Complete lifecycle operations are required before releasing this feature.

### Follow an execution

Open **Runs** to find active executions and past results. The live view shows step states and Batch item counts. Select a Batch child step, then an item, to inspect that item's input, output, and errors.

Starting a workflow in the UI does not launch an agent. When an assignment is ready, select **Copy instructions for agent** and paste the instructions into a connected agent conversation. The instructions resume the existing execution. **Waiting for an agent** means work is available; **Agent working** means an executor has claimed it.

Failed executions can be retried from the inspector. Retrying a failed Batch preserves successful items. Retrying Script or Fetch steps can repeat external side effects.

### Manage workflows

Archive a workflow to move it out of the active library, or restore it later. **Delete** is available from each workflow's menu in the library and from each card's menu in **Child workflows**. Inside a workflow, the three-dot menu beside **Run** contains **Workflow settings** and **Delete workflow**. A confirmation dialog precedes removal of the workflow, its published versions, and run history. Active executions and references from other workflows block deletion.

### Waits and unanswered assignments

Add a **Wait** node to pause for a duration or until a timestamp from input. The duration editor accepts milliseconds, seconds, minutes, hours, or days. Wait passes its input through unchanged and stores its deadline in SQLite. Cancel stops the wait; restarting resumes it from the original deadline.

To wait for something slow outside Interlock, such as an environment bootstrap or a CI run, choose **When a check passes**. The server runs a Script or Fetch check on an interval against the step input until the chosen output field equals the expected value, then continues with the input merged with the check output. The slow work runs outside the node; a check is a short probe, so a restart only repeats the check. An optional deadline aborts an in-flight check and routes the original input through **Timeout**. Disabling the deadline removes its connection when editor changes are applied. See [timers](docs/timers.md#polling-waits).

In Agent settings, enable **Route on unclaimed timeout** and set **If unclaimed for**. Connect **Result** to the successful continuation and **Timeout** to a reminder, escalation, or exit. Timeout receives the original input. Claiming stops the timer; a failed or expired claim starts a fresh timer when work becomes available again. This does not limit how long a claimed assignment can keep renewing its lease.

For a three-day reminder loop, route Timeout to a Script that sends the reminder and returns the original input fields with an incremented reminder count. Use a Condition to exit after the desired number or route back to the Agent. Fetch returns its HTTP response, so a Fetch-based reminder path must restore the request fields and counter before returning to the Agent. Each visit consumes a step; elapsed waiting time does not. See [timer configuration and execution rules](docs/timers.md).

Workflow-level routes can loop back to an upstream node other than Entry. The same run re-executes that node, bounded by `maxSteps`. Batch item paths must be acyclic and reach their owning Batch's End handle.

`maxSteps` allows 2 through 1000 steps per run and defaults to 100. Entry, Exit, and every node visit count, including explicit retries that create a new execution. A Batch counts once in its parent; each item has its own budget. For example, 200 items with three steps each fit a three-step item budget, with a separate three-step parent path of Entry → Batch → Exit. The independent Batch `maxItems` limit defaults to 200.

### Resume an agent run

Use MCP `get_run_briefing` with the existing run ID for current progress, available and claimed work, blockers, Batch counts, deadlines, and result references. Detached trees have independent lifecycle counts, including after the requested run finishes. Use `get_run_result` to read one input or output path, and `wait_for_run_change` with the returned cursor to wait for a scoped change. Waits default to 30 seconds and stop after at most 60 seconds. These reads do not claim or execute work.

See [run continuation operations](docs/agent-workflows.md#resume-a-run-with-a-briefing) for response bounds, cursor recovery, and cancellation. `get_run`, `list_work`, and existing CLI commands remain available.

### Switch nodes

Use **Switch** to choose among several named routes from one input value. Choose an input field, add cases with typed match values, and connect every named branch. Text matches can be entered without JSON quotes. The first matching case wins. Unmatched values fail the run unless you choose **Follow a fallback branch** under **When no case matches** and connect that branch. A missing path always fails the step. Switch passes its input through unchanged and supports input bindings. See [Switch routing](docs/switch.md) for an example and editing rules.

### Fetch nodes

Use **Fetch** to call an HTTP API through a form. Bind input fields into the URL, query parameters, headers, or JSON body, and preview the resolved request with sample input. The output contains `status`, `headers`, and `body`. See [Fetch requests](docs/fetch.md) for binding rules, response handling, and retries.

Individual body fields with a fixed value have typed controls, so text needs no JSON quotes and existing JSON values keep their types.

### Script nodes

New script nodes default to JavaScript. Read the incoming JSON value as `input` and return a JSON value for the next node. Top-level `await` is supported:

```js
const doubled = await Promise.resolve(input.number * 2);
return { number: doubled };
```

For input `{"number":21}`, this returns `{"number":42}`. Configure the node's contracts to accept these fields.

Bash scripts read JSON from stdin and must write one JSON value to stdout. Write diagnostic messages to stderr. JavaScript `console.log` messages go to stderr automatically.

A thrown error, nonzero exit, timeout, or invalid output fails the script step. Scripts are not retried automatically.

The library **Import** dialog accepts local JSON files and public GitHub folder links. Choose **GitHub folder**, paste an HTTPS `github.com/OWNER/REPO/tree/REF/FOLDER` URL, and select **Find workflows**. Review each workflow's description, source file, and dependencies, then select the workflows and choose **Import selected**. Branch names containing slashes and commit links are supported. Discovery reads direct JSON files only and pins the preview to a commit. Invalid files remain unselectable and do not hide valid workflows.

GitHub selections import together. Any invalid selection or differing existing draft, metadata, ownership, published version, or saved prompt rejects the whole selection without changing the library. Portable bundles retain their IDs and pins; identical portable reimports are no-ops. Legacy files create a new workflow each time. Import saves definitions and prompts without starting runs. Local files remain available under **Local file**. GitHub import supports public repositories only, with at most 50 direct JSON files and 2 MiB per response or file; requests time out after 60 seconds. Private authentication, recursion, and automatic updates are not supported.

Folder metadata uses GitHub's public API; file downloads use raw GitHub URLs pinned to the resolved commit. Rate-limit feedback includes retry timing when GitHub provides it. If an import response is lost, inspect the library before retrying, especially for legacy files: the import may have completed. A confirmed rejection reports **Nothing imported**. A library refresh failure after success does not undo the import.

Scripts execute with your user account's filesystem, environment, and network access. They are not sandboxed, so review scripts before running imported workflows.

## Storage and configuration

Interlock listens on `127.0.0.1:4310` and stores workflows and runs in `~/.interlock/interlock.db`. Restarting the server retains saved data. Scripts use the directory where you started Interlock as their working directory.

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
```

Replace `WORKFLOW_ID` with an ID from `interlock workflows` and `RUN_ID` with the run ID returned by `interlock start`. Match the input to your workflow's contract. Starting a run with agent assignments makes those assignments available for a connected agent to claim and complete.

Executor scripts can use `interlock work --summary` to route assignments by `rootWorkflowId`. `interlock renew WORK_ID TOKEN` reuses the original claim duration; add `'{"leaseSeconds":300}'` to request a specific duration. See [assignment discovery and claim renewal](docs/agent-workflows.md) for fields, bounds, and compatibility details.

JSON arguments also accept `@filename`, such as `interlock start WORKFLOW_ID @input.json`. Run `interlock commands` for the full command list or `interlock --help` for server options.

## Current scope

Interlock is a local, single-user application. It does not call model APIs or launch agent sessions itself. Agent steps need a connected executor or manual submission; script steps run in the engine.

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
- [Agent workflow operations, original-input and node-output bindings, and portable bundles](docs/agent-workflows.md)
- [Fetch requests](docs/fetch.md)
- [Upgrade and restore a database](docs/upgrading.md)
- [Release process](docs/releases.md)

## License

[MIT](LICENSE)

### Author children through MCP or the CLI

MCP `create_workflow` accepts `ownerWorkflowId`. `list_workflows` accepts an optional `ownerWorkflowId`: omit it for all workflows, set it to `null` for the library, or provide a parent ID for its children. Create and publish the child, then update the parent's draft with a Workflow node that pins the child's version. Include the parent's current `draftRevision` when saving. `list_workflows` and `get_workflow` also return `draftMatchesLatest`: true for a matching published definition, false for unpublished edits, and null before first publication. Draft revisions count saves; version numbers count publications.

The CLI accepts the same owner field in an import document:

```sh
interlock import '{"name":"Gather evidence","ownerWorkflowId":"PARENT_ID"}'
interlock workflows '{"ownerWorkflowId":"PARENT_ID"}'
interlock workflows '{"ownerWorkflowId":null}'
```

An import without an owner remains a library workflow. A draft Workflow node can use `"version": null` until its target is published. A published reference always uses a positive version number.

### Publish a shared workflow and its dependents

To publish a shared workflow and advance all its published callers, run:

```sh
interlock publish CHILD_ID --cascade
```

MCP callers can use `publish_workflow` with `{"id":"CHILD_ID","cascade":true}`. The shared API accepts the same `cascade` option. Ordinary publication, including the editor's review and publish flow, keeps parent pins unchanged.

The cascade follows references in each workflow's latest published definition, including archived workflows and references inside Batches. It advances references to affected workflows and republishes each dependent once, children before parents. Unrelated pins stay unchanged. Draft-only workflows and references found only in older versions are excluded.

Dependent drafts must match their latest published definitions. Publish or discard any definition edits before cascading. A dependency cycle or any validation failure rejects the whole operation, including publication of the requested workflow. Successful cascades update dependent drafts and their revisions, so an editor holding an older draft must reload before saving.

Existing versions and runs retain their exact pins. New runs use the new versions by default; starting an explicit older version still uses its original dependencies. Contracts are checked during execution, so test changed child behavior before cascading it to callers.
