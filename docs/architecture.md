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
| `mcp`     | Shared MCP tools for HTTP and stdio callers                                      |

HTTP MCP invokes the server router in process. The stdio bridge uses the typed HTTP client. Both transports register the same MCP tools.

The client imports the server router type only. It does not bundle or instantiate the engine. The server is the only process that writes application state. MCP adapters and CLI commands can exit without losing runs.

SQLite stores workflow, version, run, assignment, and event documents. Each synchronous engine operation uses a transaction. The runtime scans persisted active runs when advancing work. This favors a small local implementation over a distributed scheduler. It is unsuitable for multiple competing server processes or a large run archive without further indexing and scheduling work.

The root `@type_of/interlock` package bundles the server, CLI, and MCP code into `dist/cli.js` and copies the built UI into `dist/ui`. Private workspace packages are implementation modules. Changesets versions the root package; CLI, UI, and MCP versions come from `packages/core/src/version.ts`, which reads the root manifest. See [Release Interlock](releases.md).

## Workflow definitions

A workflow has a stable ID, mutable metadata, and an editable draft. Publishing validates graph routes, JSON schemas, and child version references, then creates an immutable version. Draft revisions reject stale edits. Existing runs read their published version, including when the workflow is renamed or its draft changes.

One entry begins a run. Each node receives the previous node's output as its whole input. Each ordinary node has one default outgoing route. Conditions have one true route and one false route. Agents with `unclaimedTimeoutMs` have default and timeout routes. Exit nodes have no outgoing route. Loops are allowed and bounded by the workflow step limit.

A condition compares a path in its input to a JSON value using structural equality. It passes the input through unchanged. Paths are dot-separated object keys or array indices. Empty paths select the entire input. They are not general JSONPath expressions.

A Workflow node invokes an existing published workflow version once. A Batch selects an array from `itemsPath` and repeats a visible item path for each value. A blank path selects the complete input. Each value becomes the complete input of an isolated item run. The Batch collects item results in input order, even when items finish out of order. Empty arrays produce an empty result.

### Owned child workflows

Workflow records carry optional `ownerWorkflowId` metadata. Missing or null ownership means a library workflow. An owner must be a library workflow. Core reference validation permits only the owner to reference an owned child in a saved draft or published version. This authoring rule does not change execution ancestry or the existing ten-level run limit.

`createChild` atomically creates the child and saves the parent's name, description, and draft with an expected draft revision. An optional node ID identifies the new reference. Failure rolls back both records. Workflow nodes accept null versions in drafts; publication and execution reject unresolved pins. `useChildVersion` checks the parent revision, ownership, target node, and published version before updating the parent draft. Ordinary publication never automatically advances parent pins. Opt-in cascade publication follows latest published references transitively, including archived dependents and Workflow nodes inside Batches. The runtime publishes in dependency order within one storage transaction and advances only references to workflows in that cascade. Dependents must have no unpublished definition edits. Cycles or validation failures roll back every publication. Dependent draft revisions advance with their pins. Older versions and existing runs remain unchanged.

The library filters out owned workflows, while the app retains all workflow records for direct route resolution. Library workflow pages add a Child workflows tab at `?view=children`. The tab uses a centered, bounded card grid with descriptions, publication badges, step counts, draft usage, and a deletion menu. Active and Archived controls and search filter the parent's children. New child opens a naming dialog before saving the parent and navigating to the child. Child pages link to their owner; node actions open the target's existing resource route. Creation saves parent edits before navigation. Children retain separate editors and run histories. Direct starts reject archived children and children of archived parents; existing published invocations retain the prior archive behavior.

This authoring increment blocks clone and deletion of parents with children. Portable export includes owned children, owners, and dependencies. Moves and complete parent lifecycle operations remain unimplemented. Ownership is not editable through Raw JSON or generic metadata updates. The list interface accepts owner and archive filters while preserving unfiltered calls for existing clients.

### Batch handles and graph scopes

A `batch` node owns `itemsPath`, `maxItems`, `concurrency`, and `failurePolicy`. Its ordinary input receives the incoming value, and four handles control the flow:

| Stored handle | UI label | Direction       | Behavior                                                |
| ------------- | -------- | --------------- | ------------------------------------------------------- |
| `default`     | In       | Input           | Receives the incoming value before selecting items      |
| `item`        | Start    | Internal output | Starts the item path once per selected value            |
| `end`         | End      | Internal input  | Finishes one item with the connected step's output      |
| `complete`    | Out      | Output          | Emits the ordered collection after all item runs finish |

The workflow stores all nodes and edges in one flat definition. A member node's `batchId` identifies its direct owning Batch; absence means the main workflow. Positions are relative to that owner. An edge's `port` selects its source handle; optional `targetHandle: "default"` selects the ordinary input, as does omission. `targetHandle: "end"` returns a member step's output to its owning Batch. Every item branch must connect to End; a disconnected step is an incomplete draft.

Item paths can contain Agent, Script, Fetch, Wait, Condition, Workflow, and nested Batch nodes. Each Batch has exactly one `item` route into its direct members. Ordinary routes must remain within the same group. A Batch's `complete` route continues in its enclosing scope; a nested Batch can connect its Out handle to the enclosing Batch's End. Conditions require both branches, each leading to End. Membership is explicit graph data, independent of node positions or overlap. Validation rejects missing owners, circular membership, unreachable members, cross-group edges, Entry or Exit members, and cycles within item paths. Ordinary workflow loops outside item paths remain bounded by the workflow step limit.

Drafts may have missing routes or incomplete paths. Visual and Raw views report graph errors, and publication validates all routes, contracts, scopes, and referenced versions.

### Persisted item runs

Item runs use the existing scheduler, script runner, assignments, events, and cancellation. Their `workflowId` and `version` identify the same immutable published graph as their parent Batch execution. A `batchNodeId` identifies the owning Batch. An item run starts at the destination of `item` and completes when a step follows an edge into that Batch's `end` handle. Returning an item never advances the parent's output route. No generated workflows or copied definitions are stored. Inspection and restart resolve the published graph with its original handles.

A Batch allows 1 through 50 concurrent item runs. Its optional `maxItems` is an integer from 1 through 10,000 and defaults to 200 when absent, including in older published versions. The runtime checks the selected array length before dispatching any items. Oversized input fails with the actual count and limit. Each nested Batch applies its own limit; this is not an aggregate cap on descendant runs. Larger limits increase persisted history and local resource use. Each item run has the published workflow's step budget, independent of its parent and siblings. `maxSteps` defaults to 100 and permits 2 through 1000. Each node execution counts once, including Entry, Exit, repeated visits, and explicit retries that create a new execution. Waiting and claim retries within an existing execution do not spend extra steps. A Batch counts once in its parent. An item step-limit failure reports the limit and node; the parent reports how many items completed. Batches and referenced workflows share the limit of ten nested child-run levels. A referenced Workflow node starts a child run at the referenced version's entry with its own workflow contracts. Batch input and output contracts apply to the aggregate input and collected output; ordinary item-path nodes validate their individual inputs and outputs.

The `all` policy fails the Batch and cancels unfinished items when an item fails or is cancelled. The `collect` policy emits one record per item with `runId`, `status`, `output`, and `error`; missing output and error values are `null`. Node contract failures belong to their item runs. Explicit retry of a failed Batch preserves completed items and resumes failed or cancelled items within the concurrency limit. Individual item retries also wait for a free slot. A completed `collect` Batch is a successful step and is not eligible for failed-step retry. Cancellation stops unfinished descendants and invalidates their work claims. Root-run work discovery includes assignments in every nested item path.

Permanent deletion removes a workflow, its versions, and its run trees, including descendant assignments and events, in one transaction. Active runs and references from other workflow drafts or published versions block deletion. Both active and archived workflows can be deleted after confirmation in the UI.

## Agent work

Optional node input bindings select incoming data or original persisted workflow, root, and Batch item inputs before input validation. Resolved inputs appear in execution history. See [input bindings](agent-workflows.md#bind-original-input-into-later-steps) for scope and retry semantics.

Work and run summaries derive `workflowId`, optional `parentRunId`, `rootRunId`, and `rootWorkflowId` from persisted run ancestry. Root runs identify themselves with their root IDs and omit `parentRunId`. Summary queries cache shared ancestors within each request and read ancestor identity without loading execution history. No root fields need to be backfilled into stored runs.

Run discovery uses schema-2 indexes for workflow, status, and creation order. Arbitrary input-path matching iterates the filtered candidates. The scheduler still scans run history; query indexes do not remove that scheduling limit. Portable bundles preserve workflow IDs and published definitions; transactional imports reject version conflicts and require a revision map or force option for draft replacement. See [agent workflow operations](agent-workflows.md).

Agent nodes persist an assignment and pause. A worker claims available work with an expiring token. The claim persists its original duration as optional `claimLeaseSeconds`. Omitted renewals reuse that duration, falling back to 300 seconds for older records. Explicit renewal durations affect only that renewal. Claims check the requested fresh-context mode, required tools, and required skills against worker declarations. The assignment includes the exact prompt, input, context policy, and output contract.

Results must satisfy the output schema. Invalid results leave the claim active so the worker can correct them. Repeating an accepted result with the same token is idempotent. A changed duplicate, stale token, or cancelled claim is rejected.

A reported failure or expired claim makes work available again until its attempt limit is exhausted. Manual retry starts another attempt sequence and records that intervention. A step budget still bounds execution within each run.

Context requirements are a cooperation contract with the executor. Interlock cannot prove that an external harness created a fresh conversation, restrict that harness's other tools, or erase its history. No native MCP sampling callback is required. Work discovery and submission implement the return path.

## Timers

Wait nodes persist `resumeAt` on their execution and stay waiting until that deadline. The runtime resolves the deadline once from a duration or an ISO timestamp at an input path. Wait returns its input unchanged and enforces its output contract. Cancellation prevents continuation; restart retains the deadline. The server checks timers on its one-second engine tick and at operations that advance the engine. An overdue timer resumes on the next check, including after downtime.

Agent nodes optionally specify `unclaimedTimeoutMs`. Available work carries a persisted `availableUntil`. Claiming clears that deadline. Releasing a failed or expired claim starts a fresh deadline when another attempt is allowed. At expiry, the runtime marks available work `timed_out`, records a `work.timed_out` event, and finishes the node through `timeout` with its original input. The Agent result contract applies only to `default`; the destination validates timeout input. Publication requires both routes when the deadline is enabled. Executions record their outgoing `port` for inspection. Existing definitions and records without these optional fields retain their behavior.

Timers create no sleeping processes and consume no steps while waiting. They work inside Batch item paths and referenced workflows with ordinary cancellation and collection. See [timer configuration](timers.md) for JSON examples and limits.

## Scripts and interruptions

Scripts run in JavaScript or Bash child processes. New nodes default to JavaScript; definitions without a `language` field retain Bash behavior.

JavaScript receives `input` and must return a JSON value. The runner wraps the code in an async function, supports top-level `await`, `require`, and dynamic imports, and reports errors against `script.js` with editor line numbers. `console.log`, `console.info`, and `console.debug` are redirected to stderr so they do not corrupt the JSON result. Bash reads JSON on stdin and must emit one JSON value on stdout.

Both languages inherit the service environment and OS permissions. Script execution is not sandboxed. Installed copies default to the directory where `interlock` starts; development defaults to the checkout. `--workdir` on the installed CLI or `INTERLOCK_WORKDIR` overrides the working directory.

Scripts have time and output limits. Cancellation kills their process group. Shutdown stops local script processes. On restart, persisted interrupted script executions become failures because their side effects are uncertain. Interlock never automatically replays them. An explicit retry can repeat side effects, so inspect the failed step first.

Script execution happens outside database transactions. Agent claims and result submission remain available while scripts run. Completed script results are committed before advancing dependent steps.

## Local interfaces

The service binds to loopback and rejects unexpected request hosts and browser origins. It is a single-user local service without authentication. Local processes can invoke its interfaces. It must not be exposed through a public tunnel.

Installed copies use `~/.interlock/interlock.db`; development uses `.interlock/interlock.db` inside the checkout. `interlock` starts the engine and built UI in the foreground. Its `--port`, `--db`, and `--workdir` flags override defaults. Development uses `pnpm dev` for the engine and Vite UI, or `pnpm start` for the engine and previously built UI.

The Hono listener exposes Streamable HTTP MCP at `/mcp`, behind the same host, origin, and 2 MiB request-body restrictions as the other APIs. Each POST creates an MCP server and SDK transport, calls the shared server router, returns JSON, and closes the transport. There are no transport sessions or server-initiated notifications; GET and DELETE return 405. Runs and claims remain in SQLite across requests and restarts. The endpoint URL stays stable across upgrades at the same address, for both global and npx startup.

`interlock mcp` remains a stdio bridge to an already running engine. The connection dialog defaults to HTTP and provides a stdio fallback: checkout paths in development, the portable CLI command for installed copies, and optional absolute paths derived from the installed runtime.

The UI uses tRPC requests and server-sent notifications, with periodic refresh as a reconnect fallback. Events and node execution data remain in SQLite. `INTERLOCK_DB` changes the database location. `INTERLOCK_URL` changes the service URL used by CLI and MCP callers.

## UI routes

Workflow pages have Editor and Runs sections. `?view=runs` selects workflow runs; `&tab=history` selects past runs. Section changes keep the editor mounted, including raw text, history, and canvas state. Opening a run leaves the workflow and retains the unsaved-edit navigation guard. Run links carry the originating workflow and filter so Back to runs returns to that list, including after inspecting child runs. Workflow run lists include direct executions and invocations by other workflows, but exclude Batch item runs; those remain in their parent run inspector.

React Router owns browser navigation through a shared application layout and child routes in `packages/ui/src/routes`. The layout keeps the engine connection and live refresh active across route changes. URL builders live in `routes/paths.ts`.

| Route                    | View                                                   |
| ------------------------ | ------------------------------------------------------ |
| `/`                      | Redirects to `/workflows`, replacing the history entry |
| `/workflows`             | Workflow library                                       |
| `/workflows/:workflowId` | Workflow draft editor                                  |
| `/runs`                  | Active runs                                            |
| `/runs?tab=history`      | Run history                                            |
| `/runs/:runId`           | Run inspector, including child runs                    |

Resource routes use stable, encoded IDs. Names and future folder or group membership do not determine a workflow's address. Folder and group pages can be added as sibling routes under the application layout without changing existing resource links. Query parameters represent view filters; hash fragments remain available for in-page anchors such as run output.

Direct links wait for initial data instead of briefly displaying the library. Missing workflows and unknown routes show an explicit not-found view. Initial connection failures show an error without changing the URL. Editor navigation, including browser Back and Forward, asks before discarding unsaved changes. Reload and tab closure retain the browser's unsaved-change warning. URLs do not preserve unsaved edits, editor history, Visual/Raw selection, canvas state, or open dialogs.

Vite and the built server serve the app for direct page requests. A future host must also serve `index.html` for UI routes while keeping API and asset handling separate. The route structure does not add hosting, authentication, multi-user access, folders, or groups; the local service restrictions still apply.

## UI components

Mantine provides dialogs, form controls, tabs, menus, and status badges. The shared theme in `packages/ui/src/theme/theme.ts` defines the dark palette and component defaults. Canvas colors reference those tokens through CSS variables. CSS Modules handle product layouts and React Flow nodes.

Use Mantine components directly for standard controls. Keep shared components for Interlock behavior, such as JSON validation, contract editing, action variants, and status-to-color mapping. Settings dialogs hold local edits until Apply changes; contract editing uses a page within that dialog. Cancel discards the settings edit, including applied contract changes.

The workflow editor holds a draft shared by Visual and Raw views. Raw JSON must parse, match the definition structure, and contain no unknown definition fields before saving. Raw edits require Save or Discard before returning to Visual. Graph validation errors can remain in a saved draft but block publication. The server performs the final publication validation, including referenced child workflow versions.

The editor canvas uses design tool controls: scroll to pan, pinch to zoom, and drag empty canvas space to select nodes. Hold Command or Control to zoom by scrolling while keeping the arrow cursor. The magnifying-glass cursor is reserved for holding Z to zoom to an area. Dragging a node moves it. Selection stays local to the editor and is not saved in the workflow definition.

Holding plain Z outside text fields and dialogs enables area zoom. A primary-button drag starting on empty canvas draws a rectangle; releasing the pointer fits its flow-coordinate bounds into view with the existing zoom limits. Both rectangle dimensions must reach eight screen pixels. Escape, Z release, window blur, or pointer cancellation discards the gesture. While armed, selection, node dragging, connections, and scroll navigation are disabled. Area zoom changes only the viewport and does not enter editor history.

Editor Undo and Redo keep up to 50 snapshots of the definition, name, and description in memory. Drag gestures and settings applications each form one history step. Canvas deletion removes selected nodes, Batch descendants, and affected edges together. Selection, viewport changes, and collapse state stay outside history. Saving updates the saved baseline and revision without clearing history; loading an external draft resets it. Unmounting the editor ends the session. Published versions are never changed by history navigation.

Raw text keeps its own typing history. Save beneath the raw editor persists the parsed definition and records one workflow history step only after the save succeeds. Discard restores the raw session baseline from entry or the last successful save, without discarding prior visual edits. Text typed during a pending save remains available afterward. Unapplied raw edits, open settings, active drags, and pending saves or publication disable workflow Undo and Redo. Keyboard shortcuts leave text fields and settings dialogs to handle their own input.

The Add node dialog starts with Agent, the first node type, and adds a node only on confirmation. New-choice defaults follow option order. Workflow source, script language, Fetch value sources, and boolean inputs use segmented controls; Context and Batch failure behavior use radio groups. Workflow targets list owned children first, then library workflows, alphabetically within each group. The initial reference uses that same order. Run versions appear newest first. Saved values retain their selection regardless of option order. Script and raw-definition editors share syntax highlighting and aligned line numbers. The minimap receives its dimensions through the React Flow component's inline style so its SVG calculations match its displayed size.

Add node sits beside Visual/Raw. The workflow menu beside Run contains Workflow settings and confirmed deletion. Raw has Save and Discard beneath the code editor, with Format JSON beside Visual/Raw. Workflow settings is unavailable while raw edits remain unsaved. The Tidy icon sits below Fit View in the canvas controls. Shared canvas geometry supplies node and Batch dimensions to rendering, placement, and layout. New nodes occupy free space with an 80-pixel gap; adding a child also shifts overlapping siblings to make room for expanded ancestor Batches while preserving their rows. Manual dragging and imported positions do not trigger automatic arrangement.

Tidy runs Dagre separately in each graph scope, arranging nested Batch contents before their parents. Each enclosing layout uses the expanded Batch bounds with padding for its header and internal handles. Layout handles loops and disconnected drafts, ignores missing or cross-scope edges for placement, and preserves all definitions and routes except node positions. Tidy is a single undoable draft edit and fits the result into view. It reserves space for expanded groups even when they are collapsed.

Batch nodes use [React Flow Sub Flows](https://reactflow.dev/learn/layouting/sub-flows) to keep member nodes visible inside a group on the main canvas. Stored `batchId` becomes React Flow `parentId`; parents render before children and child positions are relative. Dragging the group header moves its members. Add step creates a member and connects the first step to Start. Add step is the visual editor’s way to create Batch children. Node settings do not change membership; connecting nodes or dragging across a border never changes execution scope. The internal Start and End handles mark each item path. Ordinary external handles are labeled In and Out. Timed Agent outputs are Result and Timeout; the Timeout handle and edge are amber. Settings use the full Input and Output labels. Edges omit redundant labels. Condition branches match their output handles: green for True and red for False. Collapse hides descendants and their edges without changing the definition. All steps use the ordinary node forms and contract editors. [Source and target handle IDs](https://reactflow.dev/learn/customization/handles) survive movement, edge changes, and Visual/Raw round trips. Invalid scopes block publication while incomplete drafts remain saveable. Run inspection uses the same grouped published graph and the item run's own execution timeline.

Entry and Exit settings display a shared Input / Output contract backed by the workflow input or output schema. Editing it updates Workflow settings too. Existing additional node constraints remain visible and enforced. Batch settings show an array input when Items path is blank and no narrower contract is set. A named Items path allows an enclosing object; the selected value must still be an array at execution.

## Live run inspection

The run inspector shows a live summary above the published graph. Unclaimed Agent assignments show Waiting for an agent; claimed assignments show Agent working. A claimed assignment indicates ownership, not reported internal progress. Running, waiting, completed, failed, and unstarted steps have distinct canvas indicators.

Run inspection includes descendant runs and assignments without claim tokens. Batch groups show finished, running, waiting, failed, and queued item counts. Member steps aggregate their item executions; selecting an item displays only that item's input, output, error, and assignment. Referenced Workflow runs remain separate graphs. The latest execution of each step supplies its canvas state, while the timeline retains previous attempts. Live updates preserve explicit step/item selections and the canvas viewport. Completed runs link to their final output.

## Fetch execution

Core defines Fetch configuration, validates bindings at publication, and resolves requests through the same pure function used by the UI preview. Runtime sends requests outside storage transactions with an abort controller shared with run cancellation. Resolved requests persist on node executions. HTTP errors retain their response output; explicit retries create a new execution. Pending requests fail on restart because remote side effects are uncertain. See [Fetch requests](fetch.md) for the configuration and response contract.
