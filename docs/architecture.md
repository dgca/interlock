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
| `cli`     | JSON commands for terminal callers                                               |
| `mcp`     | Stdio MCP tools for agent callers                                                |

The client imports the server router type only. It does not bundle or instantiate the engine. The server is the only process that writes application state. MCP adapters and CLI commands can exit without losing runs.

SQLite stores workflow, version, run, assignment, and event documents. Each synchronous engine operation uses a transaction. The runtime scans persisted active runs when advancing work. This favors a small local implementation over a distributed scheduler. It is unsuitable for multiple competing server processes or a large run archive without further indexing and scheduling work.

## Workflow definitions

A workflow has a stable ID, mutable metadata, and an editable draft. Publishing validates graph routes, JSON schemas, and child version references, then creates an immutable version. Draft revisions reject stale edits. Existing runs read their published version, including when the workflow is renamed or its draft changes.

One entry begins a run. Each node receives the previous node's output as its whole input. Each ordinary node has one default outgoing route. Conditions have one true route and one false route. Exit nodes have no outgoing route. Loops are allowed and bounded by the workflow step limit.

A condition compares a path in its input to a JSON value using structural equality. It passes the input through unchanged. Paths are dot-separated object keys or array indices. Empty paths select the entire input. They are not general JSONPath expressions.

Child workflow nodes pin an existing published version. A map reads an array and starts one child run per item, with bounded active children. Results retain input order. The `all` failure policy fails the parent and cancels remaining children. The `collect` policy returns records containing child status, output, and error. Empty arrays produce an empty result.

Explicitly retrying a failed map preserves successful children and resumes failed or cancelled children. Published definitions remain unchanged. To fix the procedure itself, publish another version and start a new run.

## Agent work

Agent nodes persist an assignment and pause. A worker claims available work with an expiring token. Claims check the requested fresh-context mode, required tools, and required skills against worker declarations. The assignment includes the exact prompt, input, context policy, and output contract.

Results must satisfy the output schema. Invalid results leave the claim active so the worker can correct them. Repeating an accepted result with the same token is idempotent. A changed duplicate, stale token, or cancelled claim is rejected.

A reported failure or expired claim makes work available again until its attempt limit is exhausted. Manual retry starts another attempt sequence and records that intervention. A step budget still bounds execution within each run.

Context requirements are a cooperation contract with the executor. Interlock cannot prove that an external harness created a fresh conversation, restrict that harness's other tools, or erase its history. No native MCP sampling callback is required. Work discovery and submission implement the return path.

## Scripts and interruptions

Scripts run in Bash, receive JSON on stdin, and must emit one JSON value on stdout. They inherit the service environment and OS permissions. The working directory defaults to the repository and can be changed with `INTERLOCK_WORKDIR`.

Scripts have time and output limits. Cancellation kills their process group. Shutdown stops local script processes. On restart, persisted interrupted script executions become failures because their side effects are uncertain. Interlock never automatically replays them. An explicit retry can repeat side effects, so inspect the failed step first.

Script execution happens outside database transactions. Agent claims and result submission remain available while scripts run. Completed script results are committed before advancing dependent steps.

## Local interfaces

The service binds to loopback and rejects unexpected request hosts and browser origins. It is a single-user local service without authentication. Local processes can invoke its interfaces. It must not be exposed through a public tunnel.

The UI uses tRPC requests and server-sent notifications, with periodic refresh as a reconnect fallback. Events and node execution data remain in SQLite. `INTERLOCK_DB` changes the database location. `INTERLOCK_URL` changes the service URL used by CLI and MCP callers.

## UI components

Mantine provides dialogs, form controls, tabs, menus, and status badges. The shared theme in `packages/ui/src/theme/theme.ts` defines the dark palette and component defaults. Canvas colors reference those tokens through CSS variables. CSS Modules handle product layouts and React Flow nodes.

Use Mantine components directly for standard controls. Keep shared components for Interlock behavior, such as JSON validation, contract editing, action variants, and status-to-color mapping. Settings dialogs hold local edits until Apply changes; contract editing uses a page within that dialog. Cancel discards the settings edit, including applied contract changes.
