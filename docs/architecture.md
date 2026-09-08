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

A Workflow node invokes an existing published workflow version once. A List selects an array from `itemsPath` and repeats a visible item path for each value. A blank path selects the complete input. Each value becomes the complete input of an isolated item run. The List collects item results in input order, even when items finish out of order. Empty arrays produce an empty result.

### List handles and graph scopes

A `list` node owns `itemsPath`, `concurrency`, and `failurePolicy`. Its ordinary input receives the incoming value, and four handles control the flow:

| Stored handle | UI label | Direction       | Behavior                                                |
| ------------- | -------- | --------------- | ------------------------------------------------------- |
| `default`     | In       | Input           | Receives the incoming value before selecting items      |
| `item`        | Start    | Internal output | Starts the item path once per selected value            |
| `end`         | End      | Internal input  | Finishes one item with the connected step's output      |
| `complete`    | Out      | Output          | Emits the ordered collection after all item runs finish |

The workflow stores all nodes and edges in one flat definition. A member node's `listId` identifies its direct owning List; absence means the main workflow. Positions are relative to that owner. An edge's `port` selects its source handle; optional `targetHandle: "default"` selects the ordinary input, as does omission. `targetHandle: "end"` returns a member step's output to its owning List. Every item branch must connect to End; a disconnected step is an incomplete draft.

Item paths can contain Agent, Script, Condition, Workflow, and nested List nodes. Each List has exactly one `item` route into its direct members. Ordinary routes must remain within the same group. A List's `complete` route continues in its enclosing scope; a nested List can connect its Out handle to the enclosing List's End. Conditions require both branches, each leading to End. Membership is explicit graph data, independent of node positions or overlap. Validation rejects missing owners, circular membership, unreachable members, cross-group edges, Entry or Exit members, and cycles within item paths. Ordinary workflow loops outside item paths remain bounded by the workflow step limit.

Drafts may have missing routes or incomplete paths. Visual and Raw views report graph errors, and publication validates all routes, contracts, scopes, and referenced versions.

### Persisted item runs

Item runs use the existing scheduler, script runner, assignments, events, and cancellation. Their `workflowId` and `version` identify the same immutable published graph as their parent List execution. A `listNodeId` identifies the owning List. An item run starts at the destination of `item` and completes when a step follows an edge into that List's `end` handle. Returning an item never advances the parent's output route. No generated workflows or copied definitions are stored. Inspection and restart resolve the published graph with its original handles.

A List allows 1 through 50 concurrent item runs and at most 200 items. Each item run has the published workflow's step budget. Lists and referenced workflows share the limit of ten nested child-run levels. A referenced Workflow node starts a child run at the referenced version's entry with its own workflow contracts. List input and output contracts apply to the aggregate input and collected output; ordinary item-path nodes validate their individual inputs and outputs.

The `all` policy fails the List and cancels unfinished items when an item fails or is cancelled. The `collect` policy emits one record per item with `runId`, `status`, `output`, and `error`; missing output and error values are `null`. Node contract failures belong to their item runs. Explicit retry of a failed List preserves completed items and resumes failed or cancelled items within the concurrency limit. Individual item retries also wait for a free slot. A completed `collect` List is a successful step and is not eligible for failed-step retry. Cancellation stops unfinished descendants and invalidates their work claims. Root-run work discovery includes assignments in every nested item path.

Legacy `kind: "map"` definitions retain their pinned `workflowId` and `version` and use the same child scheduler. They remain loadable, executable, inspectable, retryable, and exportable. The UI identifies them as **Map (legacy)** and retains their referenced-workflow settings. Map is absent from new-node creation. There is no migration, and published definitions are never rewritten.

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

List nodes use [React Flow Sub Flows](https://reactflow.dev/learn/layouting/sub-flows) to keep member nodes visible inside a group on the main canvas. Stored `listId` becomes React Flow `parentId`; parents render before children and child positions are relative. Dragging the group header moves its members. Add step creates a member and connects the first step to Start. Node settings can change membership explicitly; dragging across a border never changes execution scope. The internal Start and End handles mark each item path. External handles are labeled In and Out across node types. Settings use the full Input and Output labels. Edges omit redundant labels, except for Condition branches. Collapse hides descendants and their edges without changing the definition. All steps use the ordinary node forms and contract editors. [Source and target handle IDs](https://reactflow.dev/learn/customization/handles) survive movement, edge changes, and Visual/Raw round trips. Invalid scopes block publication while incomplete drafts remain saveable. Run inspection uses the same grouped published graph and the item run's own execution timeline.

Entry and Exit settings display a shared Input / Output contract backed by the workflow input or output schema. Editing it updates Workflow settings too. Existing additional node constraints remain visible and enforced. List settings show an array input when Items path is blank and no narrower contract is set. A named Items path allows an enclosing object; the selected value must still be an array at execution.
