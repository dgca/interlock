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

Keep the terminal running while you use Interlock. Closing the browser does not stop the engine. Press Ctrl+C in the terminal to stop it.

## Run your first workflow

The initial library includes **Size up a Pokémon** and **Build a team roster**, editable examples that together showcase every node type: a Fetch of the public PokéAPI, a JavaScript Script, a Condition branch, an Agent assignment, and a Batch that runs a workflow once per candidate.

1. Select **Connect with MCP** in the sidebar.
2. Follow the instructions for Codex, Claude, OpenCode, or another MCP client.
3. Restart or reconnect your client so it can discover the Interlock tools.
4. Ask your agent:

   ```text
   Find the Interlock workflow "Size up a Pokémon" and run it with
   {"name":"pikachu"}. Complete its assignments, then return the result.
   ```

5. Open **Activity → Active** and select the execution to follow its steps. Completed, failed, and cancelled executions appear in **History**.

Your agent needs access to the tools required by the assignment; this example's assignment is a self-contained writing task, so no extra tools are needed. Its tool approval settings still apply.

The connection uses Streamable HTTP at `http://127.0.0.1:4310/mcp`, served by the same process as the UI and engine. Keep that process running. Upgrading and restarting at the same address preserves your agent configuration. The dialog also provides a stdio fallback for clients that need it. See [Connect a harness](docs/connect-harness.md) for configuration and the assignment loop.

## Create a workflow

Select **New workflow** to create a draft. Use **Add node** to choose each step's type, then connect the nodes in execution order.

Available nodes include entry and exit, Agent, Script, Fetch, Condition, Workflow, and Batch. A Workflow node invokes a pinned published workflow once. A Batch repeats a visible path for each item and collects the results in input order.

Add a **Batch** and configure its items path and concurrency. Use **Add step** inside the group to create an Agent, Script, or other ordinary node. The first step connects to **Start** automatically. Connect additional steps within the group; connect the last step on every branch to **End**. Connect **Out** to the next step or Exit. The output route receives the ordered results after all items finish. Group members remain visible on the main canvas. Collapse hides them temporarily; moving the group moves its members.

```text
Entry → Batch
        ├─ [Start → Research item → End]
        └─ Out → Synthesis → Exit
```

For input `[3, 4, 5]`, a Script on the item path containing `return input * 2;` produces `[6, 8, 10]` on Out. An Agent can research each item directly on the canvas. The seeded opportunity brief demonstrates a Batch with a reusable Workflow node on its item path.

A blank items path selects the complete input. Batches accept up to 200 items and 1 through 50 concurrent item runs. Choose `all` to fail and cancel unfinished items on an error, or `collect` to receive each item's status, output, and error. Item paths can contain nested Batches and Workflow nodes, subject to ten nested levels.

Configure input and output contracts in the node settings. Entry and Exit display the shared workflow input and output contracts. With a blank items path, Batch input must be an array; with a named path, the selected value must be an array. Use **Visual / Raw** to switch between the graph and its JSON definition. The raw editor checks JSON syntax and structure before saving. Publishing also checks the workflow's graph.

Select **Publish version** when the draft is ready, then **Run v1** to supply input and start a run. Each run uses a fixed published version. Editing a draft does not change an existing run.

Use **Undo** and **Redo** beside **Save draft** to reverse or restore up to 50 editor actions. The shortcuts are Ctrl/Command+Z and Ctrl/Command+Shift+Z; text fields keep their own typing undo. A drag, group move, deletion, connection change, or settings application counts as one action. Saving preserves history. Leaving the workflow, reloading the page, or loading an external draft clears it. Undo changes the editable draft, never a published version.

Raw edits enter workflow history as one action when you return to **Visual** or save. While raw edits are unapplied, use the text editor's undo, or apply or discard those edits before using the workflow Undo and Redo buttons.

Hold **Z** and drag from empty canvas space to draw a zoom rectangle. Release the mouse to fit that area into view. Press **Escape** or release Z before releasing the mouse to cancel. A click without a drag does nothing. This shortcut is inactive in text fields and settings dialogs and does not add to Undo history.

The **Tidy** icon sits below **Fit View** in the canvas controls. Use **Tidy** to arrange the whole workflow from left to right, including nested Batch contents, and fit it into view. Tidy uses expanded Batch sizes so groups have room when reopened. It changes only positions and can be undone in one step. Save the draft to keep the arrangement. Imported and agent-authored positions remain as supplied until you tidy them.

### Follow an execution

Open **Activity** to find active executions and past results. The live view shows step states and Batch item counts. Select a Batch child step, then an item, to inspect that item's input, output, and errors.

Starting a workflow in the UI does not launch an agent. When an assignment is ready, select **Copy instructions for agent** and paste the instructions into a connected agent conversation. The instructions resume the existing execution. **Waiting for an agent** means work is available; **Agent working** means an executor has claimed it.

Failed executions can be retried from the inspector. Retrying a failed Batch preserves successful items. Retrying Script or Fetch steps can repeat external side effects.

### Manage workflows

Archive a workflow to move it out of the active library, or restore it later. **Delete** is available from each workflow's menu in the library for active and archived workflows. A confirmation dialog precedes removal of the workflow, its published versions, and run history. Active executions and references from other workflows block deletion.

### Fetch nodes

Use **Fetch** to call an HTTP API through a form. Bind input fields into the URL, query parameters, headers, or JSON body, and preview the resolved request with sample input. The output contains `status`, `headers`, and `body`. See [Fetch requests](docs/fetch.md) for binding rules, response handling, and retries.

### Script nodes

New script nodes default to JavaScript. Read the incoming JSON value as `input` and return a JSON value for the next node. Top-level `await` is supported:

```js
const doubled = await Promise.resolve(input.number * 2);
return { number: doubled };
```

For input `{"number":21}`, this returns `{"number":42}`. Configure the node's contracts to accept these fields.

Bash scripts read JSON from stdin and must write one JSON value to stdout. Write diagnostic messages to stderr. JavaScript `console.log` messages go to stderr automatically.

A thrown error, nonzero exit, timeout, or invalid output fails the script step. Scripts are not retried automatically.

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
- [Fetch requests](docs/fetch.md)
- [Release process](docs/releases.md)

## License

[MIT](LICENSE)
