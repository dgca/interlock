# Feature index

What Interlock implements today, grouped by area. See [current limits](v1.md) for bounds and unsupported features.

## Editor and authoring

- Dark UI with workflow search, create, clone, rename, archive, restore, import, export, and confirmed deletion.
- Bookmarkable workflow and run URLs, Runs tab persistence, and browser Back/Forward navigation with unsaved-edit protection.
- React Flow authoring and editable raw JSON, with separate draft and publication validation.
- Size-aware node placement and an undoable Tidy action for the whole graph, including nested Batches and port-aware reduction of branch crossings.
- Session-local Undo and Redo for up to 50 editor actions, including grouped moves and Batch deletion.
- Node creation with an in-dialog type selector and JSON contract editing.
- Workflow Editor and Runs subnav, a settings and deletion menu, and explicit Save and Discard actions in Raw.
- Editable drafts, immutable retained published versions, and stale-draft protection.
- A draft-to-latest-published comparison before editor publication, with expandable node, route, contract, setting, and layout details.
- Opt-in [Dagre Tidy during authoring](authoring-layout.md), shared with the editor, on draft create/update/edit through MCP and the shared API, with CLI import/update/edit support. ELK authoring, missing-position placement, and layout preview are deferred.
- Atomic stable-ID draft edits through the shared API and MCP, with revision protection, rollback, compact changes, and read-only structured preflight.
- Owned child workflow authoring with a Child workflows tab, contextual creation, owner navigation, and explicit child-version selection.
- Opt-in cascade publication through CLI and MCP to advance and republish transitive dependents atomically.
- [Explicit obsolete-version cleanup](version-cleanup.md) through MCP with impact preview, protected dependencies and active runs, retained run history without graphs, and original-definition restoration from backups.

## Nodes and step data

- Entry, Exit, Agent, Script, Fetch, Wait, External input, Branch, Workflow, Batch, and Parallel editors with visible grouped paths. Legacy Condition/Switch definitions remain supported.
- JavaScript and Bash Script nodes with a 60-second default timeout and an explicit maximum of one hour, [execution context](architecture.md#script-execution-context), syntax highlighting, aligned line numbers, and top-level JavaScript `await`.
- Opt-in background Script supervision across server restart, durable encrypted results, offline deadlines, bounded protected progress, process-group cancellation and explicit uncertain-outcome reconciliation. See [Scripts and interruptions](architecture.md#scripts-and-interruptions).
- Optional result branches and output fields on Agent, Script, Fetch and waited Workflow nodes. Input/output bindings support fixed JSON values, explicit nested objects, missing-path defaults, and defaults for nodes with no completed output. See [step data](node-data.md).
- Original-input and earlier-node output bindings for later nodes, including isolated Batch item paths, a unified Input section with source selection and expected format, scoped node selection, and canvas source indicators.
- Engine-verified [execution provenance and node visitCount](node-data.md) recording (`profileId`, `harness`, `sessionId`, `requestedModel`, `actualModel`, `provider`, `effort`, `attempt`, `visitCount`, timestamps, `usage`), anti-spoofing guarantees preventing worker output overrides, `source: "execution"` bindings, Branch condition path resolution (`execution.<nodeId>.visitCount`), and script execution provenance file injection (`INTERLOCK_EXECUTION_PROVENANCE_FILE`).
- Per-run dynamic working directory (`cwd`) binding for Workflows, Agent nodes, and Script nodes (including polling Script checks) with value bindings, strict directory containment inside declared `allowedRoots`, continuity group session directory pinning, execution telemetry on node execution records and work discovery, and explicit failure/blocker reasons (`cwd_blocked`).
- [Managed workspaces](managed-workspaces.md): an opt-in Git worktree per run on a new branch inside the data folder, used as the working directory for Agent and Script nodes, shared with Batch items, Parallel branches and invoked workflows without their own setting, removed when the run tree is quiescent unless retention keeps it, with after-create and before-remove hooks that follow imported-Script approval.
- Optional [Script, Fetch and waited Workflow failure routes](failure-routes.md) with structured error data, retained failed execution history, and a Route on failure editor switch. Workflow recovery retains child references and keeps cancellation terminal. Automatic retry/backoff, Agent fallback and detached callbacks remain outside this increment.
- Durable [External input](external-input.md) steps with revisioned submissions, explicit acceptance receipts, and run-scoped holds.
- Persisted Wait deadlines and optional unclaimed Agent timeouts with a Timeout route.
- Workflow nodes can wait for results or dispatch independent runs, with durable run references and separate cancellation and retry lifecycles.
- Concurrent child dispatch with ordered collection and explicit failure policy.

## Runs and execution

- Persistent runs, event history, nested run inspection, cancellation, and explicit retry. [Run tree cancellation](workflow-execution.md#cancel-a-run-tree) adds a read-only active-run preview, explicit detached inclusion, recorded reasons, and atomic cancellation state through UI, CLI, MCP, and shared API. Uncertain external ownership remains protected until stop confirmation.
- Global and workflow-specific Runs views with paginated Active, Needs attention, and History tabs, live step states, and individual Batch item inspection.
- Opt-in [run version upgrades](workflow-execution.md#move-a-run-to-a-newer-version) at step boundaries, with revision-protected policy updates, explicit compatibility preview and apply, captured-work protection, per-execution version history, and prompt recapture that respects publish pins. Default runs remain pinned.
- Opt-in [continue-as-new Exits](continue-as-new.md) for bounded standalone run chains, atomic checkpoint handoff, preserved prompt/version capture, chain-wide budget consumption, lineage and explicit chain cancellation.
- Durable [start admission](idempotent-run-starts.md) with published workflow `maxActiveRuns` and stage exclusions, priority/FIFO queued promotion, pinned start dependencies, atomic active external-task policies, queued inspection/cancellation, and optional managed executor profile concurrency beneath the shared cap. Admission does not preempt admitted runs or fence external effects.
- Optional [idempotent run starts](idempotent-run-starts.md) recover an ordinary task attempt across delivery retries and restart, with retained deletion receipts and bounded external-task lookup through MCP, shared API and CLI.
- Bounded [run tags](idempotent-run-starts.md#tag-and-filter-runs) on ordinary and triggered starts, inherited by children and continued runs, with indexed exact-pair filtering in API, MCP, CLI, and Runs UI, plus summary and briefing metadata.
- Compact persisted run briefings, targeted input/output paths, and cancellable waits capped at 60 seconds, with scoped sequence cursors and separate detached lifecycle progress.
- Optional [exclusive step resources](work-resources.md) coordinate Agent claims, Scripts, Fetch requests, and polling checks across runs, expose bounded blockers, exclude resource queue time from execution timeouts, and retain uncertain ownership until explicit stop confirmation.
- Persistent [library and workflow pause holds](work-holds.md), independent exact-ID release, direct workflow Pause/Resume UI controls, CLI/MCP/shared API, boundary and claim gates, pending-input preservation, pause waiting projections, and active-time intervals. Schedules honor these named holds and apply their missed-fire policy on recovery.
- Assignment-level [external holds](work-holds.md), explicit resume with fresh claims, persisted blocked intervals, and bounded inspection through MCP, CLI and the run inspector.

## Agents and executors

- Work requests, capability checks, expiring claims with optional per-Agent durations (10–3600 seconds, five-minute fallback), distinct expiry events, optional separate bounded expiry budgets and reclaim guidance, lease renewal that retains the original claim duration when omitted, schema validation, and duplicate submission protection.
- UI-started runs, copyable agent handoffs, and manual completion of unrestricted current-context assignments. Manual claim credentials stay in page memory across navigation; reload loses the token while the server lease remains active.
- Opt-in [managed Agent execution](managed-executors.md) through installed Claude Code, Codex, Pi, and custom harnesses (`harness: "custom"`), with local profiles in AI Settings, direct turn subprocess/HTTP execution, delegated launcher claim-ticket adapters over subprocess, HTTP or a [pull transport](managed-executors.md#pull-transport-for-launchers-interlock-cannot-call) for clients that only make outbound requests, workflow defaults and node overrides, native model discovery and workflow model overrides, native permissions/questions, explicit model-refusal recovery, shared Limited/Unlimited concurrency settings, existing claim validation and explicit interruption recovery.
- Managed [session visibility](managed-executors.md#session-visibility-name-templates-deep-links-and-live-tail) with dynamic session name templates evaluated from run context (`{{externalTask.id}}`, `{{node.label}}`), native `sessionId` tracking, copyable CLI resume commands, clickable deep links (with unsafe URI scheme sanitization), and a bounded 20-message in-memory live progress tail in Run Inspector.
- Browser-managed [Agent presets](managed-executors.md#model-aliases) mapping logical roles to ordered candidate models (`{ model, effort?, profileId? }`), dynamic references in workflows and Agent nodes, deterministic run-start revision pinning (`modelAliasCaptures`), eligible harness fallback, preset permissions, and portable named requirements export (format version 6). Format 10 preserves authored alias IDs for local name binding. Missing known aliases reject startup before claims; existing captures remain pinned.
- Optional advisory Agent [model tiers](model-tiers.md) for current and fresh context, with pre-claim discovery and per-attempt requested, declared, and usage-reported model attribution.
- Opt-in [run budgets](run-budgets.md) gate Agent claims with explicit scope, incomplete-usage policies, and recoverable blocks.

## MCP and CLI

- HTTP MCP on the running server for authoring and execution, with a legacy stdio bridge and CLI access to the same service.
- A small plain-JSON [HTTP API](http-api.md) under `/api` for scripts and integrations: list published workflows with input contracts, start runs with idempotency keys, read compact status and results, and cancel runs.
- MCP workflow schemas, compact assignment discovery with root workflow identity, bounded run lookup with input matching, and CLI/MCP workflow archive, restore, and deletion.
- Opt-in compact MCP authoring acknowledgments and edit diagnostics, with full defaults, shared API summary operations, and CLI start/submit `--summary` plus claim `--fresh`/`--lease`.
- Compact MCP start/submission responses and work discovery by default, with lifecycle-scoped next work, wait cursors, suggested read-only calls, and explicit full options; see [compact mutation responses](agent-workflows.md#continue-with-compact-mutation-responses).
- MCP [tool profiles](connect-harness.md#choose-a-tool-profile) (`all`, `execute`, `author`, `operate`) selected by URL path, the `X-Interlock-Mcp-Profile` header, or `interlock mcp --profile`, with `nextCall` suggestions kept inside the connected profile.
- [MCP protocol support](connect-mcp.md#protocol-support) for revision `2025-11-25` and the older revisions its SDK accepts, over sessionless Streamable HTTP and stdio.

## Reuse, import and starters

- Reusable Prompts library, ordered Agent references, latest content at each workflow run startup (with opt-in prompt pinning at publish via `pinPromptsAtPublish`), retained run captures, and portable prompt dependencies.
- Instance-wide [Config and Secret variables](variables.md), protected value revisions with a separate key file, explicit Fetch header and Script environment delivery including polling checks, safe run captures, deliberate portable bindings, and bounded UI, CLI, and MCP management. Workflow-local overlays, implicit Agent/harness delivery, remote vaults, and encryption-key rotation are not supported.
- Portable dependency bundles with transactional import, stable IDs and pins, semantic dry-run diffs (`--dry-run`), atomic cascade publication (`--publish --cascade`), and explicit draft-conflict handling.
- Public GitHub folder discovery and explicit selected-set import in the library UI, with commit-pinned previews, dependency details, and atomic conflict rejection.
- A shared import dialog for bundled starters, GitHub folders, local files and pasted JSON, with previews and explicit completion. Startup leaves new libraries empty; upgrades preserve existing copies. Format 11 bundles can suggest a board and stage mappings. Choose board setup explicitly during import.
- Startup [embedded UI settings](embedded-ui.md) for local-file import and agent connection controls, plus Paste JSON import for legacy workflows and portable bundles.
- An explicitly imported SDLC starter, published through the bundled starter picker and also available in `workflows/sdlc.json` for existing libraries to import, with repository-aware planning, implementation, human decision pauses, and fresh-context final review.
- An opt-in bundled [evaluation starter](workflow-evaluation.md) for retained comparison roots, with captured rubrics, fresh artifact reviewers or frozen structural checks, idempotent receipts, and separate evaluator usage.
- An optional [workflow improvement starter](workflow-improvement.md) for one inline-prompt candidate on an experimental copy, fixed tuning/acceptance cases, shared model requirements, per-sample comparison budgets, pinned semantic grading and a revision-bound adoption proposal.

## Automations

- [Automations](automations.md) provides a global, searchable list with status and workflow filters, schedule and workflow-handler event creation, contract-driven schedule inputs, activity history, and revision-protected editing. Creation defaults to disabled and can atomically enable on save.
- Library, workflow and node settings support opt-in `unclaimedStallMs`, `claimedIdleStallMs`, `humanWaitStallMs` and `runStallMs`, with per-field inheritance and explicit null disabling. Agent `maxExecutionMs` bounds active duration per claim attempt independently of renewable ownership leases. Named pauses and declared holds are excluded through interval unions. Human-wait monitoring covers unheld External input nodes; declared managed `needs_human` holds remain excluded. Stalls add durable Needs attention items and lifecycle events while preserving run status and actor.

## Inspection, reporting and diagnostics

- [Workflow Boards](workflow-boards.md) with live workflow membership, stable stage bindings, retained card placement, and individual requests across waited work. Human input captures questions and evidence per visit and accepts answers through the browser or MCP. Optional run titles appear in Boards and Runs.
- Optional executor and observer [usage reporting](usage-reporting.md) with cumulative per-attempt and run-level observer model counts, attributed costs, costs derived from a versioned, editable price table for Claude and OpenAI models, unknown/partial coverage, explicit descendant totals, and UI, CLI, and MCP inspection.
- Bounded performance and cost reporting (`interlock report`, MCP `workflow_report`, UI `/report`) across run durations, admission queue wait, human wait, stages, node medians/p90s, claim wait splits (new vs continuing sessions), reliability (failures, expiries, transient recoveries, stalls), model spend/coverage, and Exit node outcomes.
- Read-only system diagnostics and readiness check via CLI `interlock doctor [--live] [--json]`, MCP `doctor` tool, shared API `system.doctor`, and UI diagnostics view (`/settings/diagnostics`), verifying system health (engine version, SQLite integrity, schema migration, disk space, disabled variables that 0.3.0 deletes), harnesses (binary detection, version discovery, cwd/allowedRoots, optional live turn), triggers (schedule lag, consecutive failures, auto-pause), blockers (pause holds, uncertain holds, stalled work, needs_model holds), and workflows (missing/disabled variables/aliases, unpublished draft edits). Returns non-zero exit code on failure.
- Manual [run-history cleanup](history-cleanup.md) through Runs history, CLI and MCP, with bounded previews, age/root-workflow filters, reviewed whole-tree/chain deletion, dependency protections, retained start tombstones, and separate removed-data/reusable-space reporting. Comparison-evidence cascading and automatic compaction remain outside this scope.
- Optional [history retention](history-cleanup.md#enable-automatic-retention) supports library age/count limits and whole-policy workflow overrides. Hourly transactional cleanup skips protected trees, retains trigger/start receipts, and reports reusable SQLite storage. Defaults preserve all history; automatic compaction is not implemented.
- JSON-lines [engine log](troubleshooting.md#a-harness-fails-in-the-background) beside the database with size rotation, `INTERLOCK_LOG_LEVEL`, masked credentials, and the last background scheduler error in doctor.

## Testing and improvement

- MCP/shared API [workflow testbench](workflow-testbench.md) with revisioned cases, confirmed paired live comparisons, bounded execution, per-side captured prompt revisions and configuration identities, requested executor/environment metadata with attribution gaps, structural checks, separate rubric-based quality judgments, bounded timing/cost/coverage measurements and comparison context in existing Runs views.

## Local security

- A loopback-only server that rejects requests addressed to other hosts or sent from untrusted browser origins. See [Security](../README.md#security).
- An optional per-install [API token](connect-harness.md#api-token) in an owner-only file, sent automatically by the UI, CLI and stdio bridge and included in copied HTTP client configuration. `INTERLOCK_REQUIRE_TOKEN=1` requires it on `/api`, `/trpc`, `/mcp` and `/events`; a server listening beyond loopback always requires it.
- Script, polling Script check and custom harness command [server environment modes](architecture.md#scripts-and-interruptions): `inherit` passes the whole server environment and is the default for definitions without a mode; `minimal` passes `PATH`, `HOME`, locale and `INTERLOCK_*` variables plus listed `environmentPassthrough` names, and is the default for Scripts added in the editor. Minimal failures name withheld variables mentioned in the source or error output.
- One-time [approval of imported Scripts](reuse-work.md#approve-imported-scripts) by workflow and content, with an `imports`, `imports_and_agents` or `off` library setting, an import preview of every Script, **Approve and run** in the UI and `interlock approve-script`.
- Recorded [private-network Fetch targets](fetch.md) with a run event and doctor warning, and an optional `blockPrivateNetwork` setting that fails such requests before sending.

## Package

- Public MIT-licensed `@type_of/interlock` npm package with an `interlock` command for the local engine and built UI.
- Changesets versioning and changelogs for the public root package, with synchronized CLI, UI, and MCP versions.
