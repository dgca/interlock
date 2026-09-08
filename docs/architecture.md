# Architecture and execution semantics

Interlock keeps workflow behavior in the runtime so that UI, CLI, and MCP callers share the same execution rules.

## Packages

| Package   | Responsibility                                                                   |
| --------- | -------------------------------------------------------------------------------- |
| `core`    | Domain types, JSON contracts, graph validation                                   |
| `runtime` | Execution, child scheduling, work claims, context requirements, script lifecycle |
| `storage` | SQLite persistence and transaction ownership                                     |
| `server`  | Hono listener, tRPC procedures, run event stream, example seeding                |
| `client`  | Typed HTTP client shared by UI, CLI, and MCP                                     |
| `ui`      | React application, React Flow editor, reusable controls, run inspection          |
| `cli`     | Installed server entrypoint, MCP bridge startup, JSON commands                   |
| `mcp`     | Stdio MCP tools for agent callers                                                |

The client imports the server router type only. It does not bundle or instantiate the engine. The server is the only process that writes application state. MCP adapters and CLI commands can exit without losing runs.

SQLite stores workflow, version, run, assignment, and event documents. Each synchronous engine operation uses a transaction. The runtime scans persisted active runs when advancing work. This favors a small local implementation over a distributed scheduler. It is unsuitable for multiple competing server processes or a large run archive without further indexing and scheduling work.

The root `@type_of/interlock` package bundles the server, CLI, and MCP code into `dist/cli.js` and copies the built UI into `dist/ui`. Private workspace packages are implementation modules. Changesets versions the root package; CLI, UI, and MCP versions come from `packages/core/src/version.ts`, which reads the root manifest. See [Release Interlock](releases.md).

## Workflow definitions

A workflow has a stable ID, mutable metadata, and an editable draft. Publishing validates graph routes, JSON schemas, and child version references, then creates an immutable version. Draft revisions reject stale edits. Existing runs read their published version, including when the workflow is renamed or its draft changes.

One entry begins a run. Each node receives the previous node's output as its whole input. Each ordinary node has one default outgoing route. Conditions have one true route and one false route. Exit nodes have no outgoing route. Loops are allowed and bounded by the workflow step limit.

A condition compares a path in its input to a JSON value using structural equality. It passes the input through unchanged. Paths are dot-separated object keys or array indices. Empty paths select the entire input. They are not general JSONPath expressions.

A Workflow node invokes an existing published workflow version once. A Workflow Batch runs its own inline workflow once per list item. No separately published wrapper workflow is required. Each item becomes the complete input of an isolated child run. The Batch emits one ordered list through its single external output after all item runs finish. Results retain input order even when items finish out of order. The `all` failure policy fails the parent and cancels remaining children. The `collect` policy returns records containing child status, output, and error. Empty arrays produce an empty result.

Explicitly retrying a failed Workflow Batch preserves successful children and resumes failed or cancelled children. Published definitions remain unchanged. To fix the procedure itself, publish another version and start a new run.

### Inline definitions and item runs

The `batch` node owns `itemsPath`, `concurrency`, `failurePolicy`, and a `body` containing a full workflow definition. A blank `itemsPath` selects the whole input. Concurrency is 1 through 50, and a Batch accepts at most 200 items. The body has exactly one entry and one exit, shown as "Each item" and "Item result". It can contain Agent, Script, Condition, Workflow, and nested Workflow Batch nodes. Node IDs and edges belong to one definition scope; edges cannot cross between scopes. Publication recursively checks graph rules, contracts, and referenced versions.

Item runs use the existing scheduler, script runner, assignments, events, and cancellation. Their `workflowId` and `version` identify the immutable published snapshot. An optional `definitionPath` lists Batch node IDs to traverse from that snapshot to the inline body. A referenced Workflow starts a new reference at its own published version. SQLite persists these references with run documents, so inspection and restart resolve the same definition without hidden workflows or copied drafts. Both inline and referenced child runs count toward the limit of ten nested levels.

The `collect` result includes `runId`, `status`, `output`, and `error` for every item. Missing output and error values are `null`. Input-contract failures belong to their item runs. Explicit retry of a failed Batch preserves completed items and resumes failed or cancelled items within the concurrency limit. A completed `collect` Batch is a successful step and is not eligible for failed-step retry. Cancellation stops unfinished descendants and invalidates their work claims. Root-run work discovery includes assignments at every nesting level.

Legacy `kind: "map"` definitions retain their pinned `workflowId` and `version` and use the same child scheduler. They remain loadable, executable, inspectable, retryable, and exportable. The UI names them "Workflow Batch" and retains their referenced-workflow settings. There is no draft migration, and published definitions are never rewritten.

## Agent work

Agent nodes persist an assignment and pause. A worker claims available work with an expiring token. Claims check the requested fresh-context mode, required tools, and required skills against worker declarations. The assignment includes the exact prompt, input, context policy, and output contract.

Results must satisfy the output schema. Invalid results leave the claim active so the worker can correct them. Repeating an accepted result with the same token is idempotent. A changed duplicate, stale token, or cancelled claim is rejected.

A reported failure or expired claim makes work available again until its attempt limit is exhausted. Manual retry starts another attempt sequence and records that intervention. A step budget still bounds execution within each run.

Context requirements are a cooperation contract with the executor. Interlock cannot prove that an external harness created a fresh conversation, restrict that harness's other tools, or erase its history. No native MCP sampling callback is required. Work discovery and submission implement the return path.

## Scripts and interruptions

Scripts run in JavaScript or Bash child processes. New nodes default to JavaScript; definitions without a `language` field retain Bash behavior.

JavaScript receives `input` and must return a JSON value. The runner wraps the code in an async function, supports top-level `await`, `require`, and dynamic imports, and reports errors against `script.js` with editor line numbers. `console.log`, `console.info`, and `console.debug` are redirected to stderr so they do not corrupt the JSON result. Bash reads JSON on stdin and must emit one JSON value on stdout.

Both languages inherit the service environment and OS permissions. Script execution is not sandboxed. Installed copies default to the directory where `interlock` starts; development defaults to the checkout. `--workdir` on the installed CLI or `INTERLOCK_WORKDIR` overrides the working directory.

Scripts have time and output limits. Cancellation kills their process group. Shutdown stops local script processes. On restart, persisted interrupted script executions become failures because their side effects are uncertain. Interlock never automatically replays them. An explicit retry can repeat side effects, so inspect the failed step first.

Script execution happens outside database transactions. Agent claims and result submission remain available while scripts run. Completed script results are committed before advancing dependent steps.

## Local interfaces

The service binds to loopback and rejects unexpected request hosts and browser origins. It is a single-user local service without authentication. Local processes can invoke its interfaces. It must not be exposed through a public tunnel.

Installed copies use `~/.interlock/interlock.db`; development uses `.interlock/interlock.db` inside the checkout. `interlock` starts the engine and built UI in the foreground. Its `--port`, `--db`, and `--workdir` flags override defaults. Development uses `pnpm dev` for the engine and Vite UI, or `pnpm start` for the engine and previously built UI.

`interlock mcp` is a stdio bridge to an already running engine. The engine URL is not an HTTP MCP endpoint. Connection configuration is generated by the server: checkout paths in development, the portable CLI command for installed copies, and optional absolute paths derived from the installed runtime.

The UI uses tRPC requests and server-sent notifications, with periodic refresh as a reconnect fallback. Events and node execution data remain in SQLite. `INTERLOCK_DB` changes the database location. `INTERLOCK_URL` changes the service URL used by CLI and MCP callers.

## UI components

Mantine provides dialogs, form controls, tabs, menus, and status badges. The shared theme in `packages/ui/src/theme/theme.ts` defines the dark palette and component defaults. Canvas colors reference those tokens through CSS variables. CSS Modules handle product layouts and React Flow nodes.

Use Mantine components directly for standard controls. Keep shared components for Interlock behavior, such as JSON validation, contract editing, action variants, and status-to-color mapping. Settings dialogs hold local edits until Apply changes; contract editing uses a page within that dialog. Cancel discards the settings edit, including applied contract changes.

The workflow editor holds a draft shared by Visual and Raw views. Raw JSON must parse, match the definition structure, and contain no unknown definition fields before saving or returning to Visual. Graph validation errors can remain in a saved draft but block publication. The server performs the final publication validation, including referenced child workflow versions.

The Add node dialog includes the node type choice and adds a node only on confirmation. Script and raw-definition editors share syntax highlighting and aligned line numbers. The minimap receives its dimensions through the React Flow component's inline style so its SVG calculations match its displayed size.

Workflow Batches appear as collapsed containers with one input and one output on the canvas. **Open inline workflow** opens a focused canvas with a scope breadcrumb and **Back to parent**. Node settings, creation forms, contract editors, and routing work within that scope. Each body's positions are local to that Batch; moving the outer container does not rewrite its body positions. Fixed entry and exit nodes cannot be deleted in the visual editor. Raw view edits the complete root definition, including every nested body, and retains separate draft and publication checks. Run inspection shows item runs as children; opening an item loads its inline graph.

The editor uses separate canvases for scopes rather than expanded React Flow groups. [React Flow Sub Flows](https://reactflow.dev/learn/layouting/sub-flows) provide relative positioning through `parentId` but allow edges across groups. Focused canvases avoid cross-scope connections and keep large nested graphs readable. Canvas grouping is not part of the stored definition.
