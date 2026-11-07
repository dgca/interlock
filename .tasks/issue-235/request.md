# Source request

Captured 2026-11-07 from live GitHub issue reads and the parent coordinator assignment. SDLC run `6ec38c6d-ca3b-4962-8092-c9b1ebb68b97`, workflow version 4. Source text follows.

https://github.com/dgca/interlock/issues/235
H8: Start admission: per-workflow concurrency, queued starts, active-task deduplication & per-profile concurrency
## Problem and outcome

High-volume unattended pipelines risk starving resources, overwhelming provider rate limits, or redundantly executing identical tasks when issues are labeled concurrently.

Provide start admission controls including per-workflow active run limits with stage exclusions, queued run promotion, active external-task deduplication, start dependencies, and per-profile concurrency caps.

## Scope and acceptance criteria

- [ ] Workflow setting `maxActiveRuns` with optional `excludeStages: string[]` (from H4). Starts beyond `maxActiveRuns` enter status `queued` with queue position, optional `priority`, and `waiting: { kind: "admission_queue", ... }`, promoted FIFO by priority as active slots open.
- [ ] Runs currently in an excluded stage (e.g. a 14-day `Accept` wait) do not count against `maxActiveRuns`.
- [ ] Configurable active external-task policy (`onActiveExternalTask: "allow" | "reuse" | "reject" | "cancel_previous"`, default `"allow"`): atomically handles concurrent starts for the same `externalTask`.
- [ ] Support start dependencies on `start_run`: `after: [{ requestId? | externalTask? }]`; runs remain `queued` until dependencies succeed (or block with explicit reason on failure/cancellation).
- [ ] Add optional `concurrency: number | null` on `ExecutorProfile` alongside global concurrency cap to prevent builder sessions from starving reviewer sessions.
- [ ] Tests verify queue promotion order, stage exclusion, deduplication policies, start dependencies, and per-profile concurrency limits.

## Existing context and boundaries

• Parent issue: #223. Closes remaining criteria of #71.
• Prerequisite: H3, H4.
• Packages and files to touch: `packages/core` (admission schemas, profile concurrency), `packages/storage` (queued runs index), `packages/runtime` (`runStarts.ts`, admission queue scheduler, `ExecutorManager`), `packages/server`, `packages/mcp`.
• Required doc updates: `docs/architecture.md`, `docs/managed-executors.md`, `docs/idempotent-run-starts.md`, `docs/v1.md`.

## Execution workflow

Run `SDLC workflow` directly (`reviewPolicy: "auto"`, `createPr: true`).


https://github.com/dgca/interlock/issues/223
Run long-lived unattended agent pipelines on Interlock alone: triggers, managed-execution gaps, operations, diagnostics
We run a local "software factory" on Interlock: work items from an issue tracker become reviewed, merged changes in several repositories with no person in the loop. Interlock already owns the per-item procedure. One parent workflow per item runs triage, provisions a git worktree, waits on a child Build workflow (one author session and two fresh-context reviewers on different model providers), opens a change request, polls for acceptance for up to 14 days, merges through a deterministic script, and deploys.

Everything *around* that procedure is bespoke, and it is now most of what we maintain:

| What we maintain outside Interlock | Size today |
|---|---|
| A coordinator that a host-app automation runs every 2 minutes: lock file, JSON state file, start admission, session launching, idle nudges, error recovery, human-answer relays, usage measurement, worktree cleanup, and projecting run state onto an external board | ~5,000 lines of code plus ~8,600 lines of tests |
| An LLM agent the coordinator wakes only to launch, nudge, or archive sessions in our desktop agent app, because those actions are tool calls that a script can't make | ~120-line prompt |
| An operator CLI: status, performance report, spend, health check ("doctor"), config generation, deploy with lock, verification and rollback, and machine setup | ~3,900 lines |
| Workflow scripts that get around engine limits: detached deploys plus file polling (the 120 s Script cap), review-evidence checks that read the agent app's database to prove which model ran, and pass-through Switch "ledgers" | ~1,400 lines of shell |

Most of that is generic orchestration that any long-running, unattended agent pipeline needs: time-based and event-based starts, admission control, launching and recovering agent sessions, pausing, syncing workflow changes, and answering "what is stuck and why". Building it outside the engine costs us in three ways:

1. **Latency.** A step that needs a new session waits a median of about 3 minutes from becoming available to being claimed (94 claims over 15 recent items). Most of that is our own scheduling: up to one heartbeat interval before the coordinator sees the work, then the time to wake an LLM to launch the session. That adds about 19 minutes to each item, against roughly an hour of actual planning, implementation, and review.
2. **Fragility.** Every coordination bug became an incident with its own fix. A host automation disabled itself after three failed runs and stopped everything for 6 hours. A heartbeat watcher silently stopped scheduling twice. A claim token lost in truncated agent output left a human answer unrelayed for 90 minutes. Provider outages left five sessions stopped overnight until someone typed "continue". Each fix added more state to the coordinator.
3. **Duplicated engine state.** The coordinator keeps its own records of reservations, attempts, leases, retries, and pause state that mirror what Interlock already knows, and it has to reconcile the two after every lost response.

Managed execution (0.2.11) is the turning point: Interlock can now launch Claude Code, Codex, and Pi sessions itself. With the additions below, we can delete the coordinator, the launcher agent, and most of the CLI, and run the factory on Interlock plus a handful of Script nodes for our tracker and code-host calls.

---

## Boundaries & Architectural Decisions

### Core boundaries
- **Domain-agnostic engine, board-ready projections.** Every feature below is a general workflow-engine capability. Nothing in `packages/core` or `packages/runtime` knows about GitHub issues, Linear labels, pull requests, or merge queues. However, by standardizing `externalTask` (with an optional `title`), node `stage`, structured `waiting` reason, `actor`, `tags`, and `queued` status on run summaries, external boards can project run state from two fields today—and Interlock can add a native Board / Work-Item view in the future as a pure UI projection without refactoring the engine.
- **No third-party tracker or code-host clients in core.** Tracker and code-host API calls stay in Script/Fetch nodes, reusable starter templates, or connected agents.
- **Authenticating outside input stays with adapters**, as [#207](https://github.com/dgca/interlock/issues/207) states (for example, checking which account posted a comment after an input node accepts a webhook payload).
- **Existing behavior is preserved.** Everything is opt-in.
- **Documentation evolves with implementation.** Several tasks below intentionally relax or replace current limits documented in `docs/v1.md`, `docs/architecture.md`, `CONTEXT.md`, and related guides (such as recurring schedules, per-profile concurrency, inbound webhook listeners, prompt pinning at publish, and Script/Fetch resource locks). Each implementing PR must update the affected documentation and MCP definitions in the same change.

### Architectural decisions
1. **Unified Trigger model (`H9`, `M1`, `M2`)**: Schedules, inbound webhooks, and internal lifecycle events share one `workflowTriggers` concept (`kind: "schedule" | "webhook" | "event"`) with shared admission (`H8`), pause handling (`H3`), `pauseAfterConsecutiveFailures`, idempotent starts via `RunStarts`, bounded delivery/fire logs, and portable export (always **disabled by default** on import).
2. **Custom Harness definitions (`H6`)**: User-defined custom harnesses (`harness: "custom"`) are a P1 priority in `ExecutorManager` and support two clean contract modes:
   - **Direct Turn Mode**: Command or HTTP endpoint that runs a turn and returns `{ output, sessionId?, model?, provider?, usage? }`, with `ExecutorManager` owning the claim, renewal, and submission.
   - **Delegated Claim-Ticket Mode (Launcher)**: Command or HTTP endpoints (`launch`, plus optional `status`, `message`, `stop`, `archive`) for external desktop/hosted agent apps whose sessions connect via MCP. Interlock issues a one-time `claimTicket` bound to the `workId` and supervises the session via `status`/`message`/`archive`.
3. **Shared Pause / Hold gate (`H3` + [#207](https://github.com/dgca/interlock/issues/207))**: Library and workflow pauses (`H3`) share one hold evaluation model with [#207](https://github.com/dgca/interlock/issues/207)'s input-node inhibition. While paused, [#207](https://github.com/dgca/interlock/issues/207) input nodes still accept and revision pending input, but do not advance downstream until all pauses for that scope are released.
4. **Stage labels live on nodes (`H4`)**: `stage` is authored directly on workflow nodes (`node.stage`). The engine uses it for `H8` admission exclusions (`excludeStages`), `H4` run summary projections (deepest active stage across waited children), and `M10` stage duration reports.
5. **Engine-tracked `visitCount` (`H10`)**: Combining [#222](https://github.com/dgca/interlock/pull/222) (`sourceDefault` on bindings) with `execution.<nodeId>.visitCount` in `H10` lets workflows count repair loops and inspect taken routes directly through node bindings.
6. **Git sync via prompt pinning and bundle CLI flags (`M6`)**: Opt-in prompt pinning at publish (`pinPromptsAtPublish`) paired with `--dry-run` semantic diff and `--publish --cascade` flags on `interlock import` supports atomic Git-driven workflow deployments.

---

## High Priority (P1 — Remove the External Coordinator & Launcher)

### H1. External-input node with revisioned, idempotent acceptance — [#207](https://github.com/dgca/interlock/issues/207)
**Replaces:** our human-answer relay (claiming a gate as a fake executor, lease-room math, correction handling, and pause-aware relays).
- Tracked in [#207](https://github.com/dgca/interlock/issues/207). Shares the library/workflow pause gate from **H3** (accepting pending input revisions while paused, deferring acceptance advancement until unpaused).

### H2. Long-running Script nodes beyond the 120-second limit — [#202](https://github.com/dgca/interlock/issues/202)
**Replaces:** our detached deploy script, status file, and 30-second polling Wait for up to 45 minutes.
- Tracked in [#202](https://github.com/dgca/interlock/issues/202). Tracked background process group, persisted PID and start time, bounded live output inspection, process-group kill on cancellation, conservative restart handling (never replay automatically), and `onFailure: "route"` support.
- **Docs to update:** `docs/architecture.md`, `docs/v1.md`, `README.md`.

### H3. Global and per-workflow pause with multiple named holds — [#230](https://github.com/dgca/interlock/issues/230)
**Replaces:** our pause file, failed-deploy hold files, and manual pause checks spread across the coordinator and scripts.
- [ ] `pause` and `resume` operations at `library` and `workflow` scope, with a `reason` and `actor` label (UI header banner/controls, CLI, MCP, and shared API).
- [ ] **Multiple named holds:** each pause is a separate persisted record (`id`, `scope`, `workflowId?`, `actor`, `reason`, `createdAt`). Work resumes only when **no** active pause records remain for its scope, so a deploy resuming its own hold cannot undo a failure handler's hold.
- [ ] While paused: no new scheduled starts (fires follow their missed-fire policy), webhooks queue or reject as configured, no new claims or managed launches, [#207](https://github.com/dgca/interlock/issues/207) input nodes hold acceptance advancement, and Script, Fetch, and Wait steps do not advance at step boundaries (steps already running finish). Reads, inspection, cancellation, and cleanup still work.
- [ ] Paused time is excluded from **H7** retry windows and **H12** stall thresholds and execution deadlines. Wait deadlines keep their wall-clock meaning.
- [ ] Shown in the UI header, `doctor` (**M9**), and every affected run's `waiting` reason (**H4**).
- **Docs to update:** `CONTEXT.md`, `docs/architecture.md`, `docs/work-holds.md`, `docs/v1.md`.

### H4. Node stage labels and unified run `waiting` reason + `actor` — [#231](https://github.com/dgca/interlock/issues/231)
**Replaces:** our board column projection and 10-source "waiting on" state machine.
- [ ] Workflow nodes can declare an optional `stage` label (for example `Plan`, `Build`, `Review`, `Accept`) in `packages/core` and the node editor.
- [ ] Extend `externalTask` with an optional human-readable `title` (`1–200` chars) alongside `system`, `id`, and `url`.
- [ ] Run summaries (`list_runs`, `get_run`, briefings, and **M2** event payloads) include:
  - `stage`: the deepest active `stage` across the run and its active waited child runs.
  - `waiting: { kind, detail, since }`, covering `claim_queue | managed_launch | human_request | input_node | hold | pause | budget | resource | timer | poll | admission_queue` (including compact last-check output for `poll`).
  - `actor: "agent" | "person" | "engine"`, following a strict rule: `"person"` only when nothing moves until a person acts.
- **Docs to update:** `CONTEXT.md`, `docs/architecture.md`, `docs/agent-workflows.md`, `docs/idempotent-run-starts.md`.

### H5. Per-run dynamic working directory (`cwd`) for Managed Agents and Scripts — [#232](https://github.com/dgca/interlock/issues/232)
**Replaces:** per-item profile workarounds and shell `cd` wrappers for git worktrees.
- [ ] Workflows, Agent nodes, and Script nodes (including polling Script checks) can bind `cwd` from run data (for example `{ source: "node", nodeId: "provision_worktree", path: "worktreePath" }`) or inherit the workflow-level bound `cwd`.
- [ ] Profiles and server settings declare `allowedRoots` (absolute directory paths). A bound directory outside `allowedRoots`, missing, or not a directory leaves Agent work unclaimed with an explicit blocker reason (or fails the Script step)—never silently falling back to the profile or server default.
- [ ] A `continuityGroup` pins its resolved `cwd` with its session, so a later assignment cannot move the session's directory.
- [ ] The resolved `cwd` is recorded on every node execution record and shown in inspection.
- **Docs to update:** `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.

### H6. Custom harness definitions & launcher adapter (`harness: "custom"`) — [#233](https://github.com/dgca/interlock/issues/233)
**Replaces:** our session dispatch, reservations, spawn-token reconciliation, idle nudges, archiving (~600 lines of coordinator code), and the ~120-line launcher LLM.
- [ ] Allow creating and managing user-defined profiles with `harness: "custom"` across UI, CLI, MCP (`manage_executors`), and the shared API.
- [ ] Support two execution contract modes on custom profiles:
  1. **Direct Turn Mode** (subprocess command or HTTP endpoint): receives JSON assignment context (`{ idempotencyKey, workId, attempt, prompt, input, outputSchema, cwd, model, effort, permissions, sessionName, sessionId }`) and returns JSON `{ output, sessionId?, model?, provider?, usage? }`, while `ExecutorManager` owns the claim, lease renewal, and submission.
  2. **Delegated Claim-Ticket Mode (Launcher)** (for external desktop/hosted agent apps): configures a `launch` command or HTTP endpoint plus optional `status`, `message`, `stop`, and `archive` operations.
     - `launch` receives `{ idempotencyKey, workId, attempt, prompt, cwd, model, effort, sessionName, sessionHandle, claimTicket }` and returns `{ sessionHandle, url? }`. Replaying the same `idempotencyKey` returns the same handle.
     - `claimTicket` is a one-time credential that lets only that launched session claim that exact assignment via MCP `claim_work`; Interlock rejects other claimants while the ticket is outstanding.
     - Interlock polls `status` (`working | idle | needs_attention | ended`) and maps it into the managed lifecycle (**H7** recovery policies, `Needs attention`, and stop/reconcile).
     - `message` sends follow-up text (used by **H7** continuation and **H12** idle nudges). `archive` runs when the session's last assignment in the run finishes.
- [ ] Include a reference CLI custom harness implementation and contract test suite covering both modes.
- **Docs to update:** `docs/managed-executors.md`, `docs/connect-harness.md`, `docs/architecture.md`, `docs/v1.md`, `packages/mcp/src/server.ts`.

### H7. Managed session recovery policies — [#234](https://github.com/dgca/interlock/issues/234)
**Replaces:** our native session log reader, vendor error classifier, resume bookkeeping, and attention escalation (~350 lines plus tests).
- [ ] Per profile, with workflow and Agent node overrides:
  - **Continue on missing result (`continueOnMissingResult`)**: when a session turn ends without a result envelope, send a configurable continuation message in the same session up to $N$ times (default `0`, preserving current behavior) before counting a failed attempt.
  - **Transient-error retry (`transientRetry`)**: classify harness/adapter errors. Quota, billing, authentication, invalid request, context length, content policy, and model refusal (`needs_model`) are permanent and rejected before any transient match. Network drops, timeouts, HTTP 429 rate limits, 5xx, and overloaded responses are transient. Unknown errors keep current handling. For transient errors, resume the same session after exponential backoff, at most $N$ times per rolling window per execution, then escalate to `Needs attention` with the classified reason.
- [ ] Record each recovery on the attempt (`errorClass`, `messageExcerpt`, `action`, `at`) and display it in the Run Inspector.
- [ ] Honor **H3** pauses and holds (paused time does not count toward retry windows).
- **Docs to update:** `docs/managed-executors.md`, `docs/architecture.md`.

### H8. Start admission: per-workflow concurrency, queued starts, active-task deduplication & per-profile concurrency — [#235](https://github.com/dgca/interlock/issues/235)
**Replaces:** our build-cap queue, dependency gating, blocker cache, and reviewer/author concurrency starvation (closes remaining [#71](https://github.com/dgca/interlock/issues/71) criteria).
- [ ] Workflow setting `maxActiveRuns` with optional `excludeStages: string[]` (from **H4**). Starts beyond `maxActiveRuns` (ignoring runs currently in an excluded stage such as a 14-day `Accept` wait) are accepted with status `queued`, queue position, optional `priority`, and `waiting: { kind: "admission_queue", ... }`, then promoted FIFO by priority as slots open.
- [ ] Active external-task policy (`onActiveExternalTask: "allow" | "reuse" | "reject" | "cancel_previous"`, default `"allow"`): atomically handles concurrent starts for the same `externalTask` without external coordinator locking.
- [ ] Optional **start dependencies**: a start can specify `after: [{ requestId? | externalTask? }]` and remains `queued` until those runs complete successfully (or stays queued with a blocker reason if a dependency fails or is cancelled).
- [ ] **Per-profile managed concurrency**: optional `concurrency: number | null` per `ExecutorProfile` alongside the global limit, preventing author sessions from starving reviewer sessions.
- **Docs to update:** `docs/architecture.md`, `docs/managed-executors.md`, `docs/idempotent-run-starts.md`, `docs/v1.md`.

### H9. Schedules (heartbeat triggers) — [#236](https://github.com/dgca/interlock/issues/236)
**Replaces:** our external host automation and its watcher.
- [ ] Create, update, enable, disable, and delete schedule triggers (`workflowTriggers` with `kind: "schedule"`) through UI, MCP, CLI, and the shared API. Support both fixed intervals (minimum 30 s) and 5-field cron expressions with an IANA time zone and a JSON input template.
- [ ] **Overlap policy**: `skip` (do not start while the previous run from this schedule is active or queued), `queue` (queue at most one pending run), or `allow`.
- [ ] **Missed-fire policy** after server downtime or sleep: `skip` to the next slot, or `run_once` (never a catch-up burst).
- [ ] Each fire starts the run with a deterministic `requestId` (`schedule:<triggerId>:<slotIso>`) so fires are idempotent across restarts. Input can bind `{ scheduledAt, firedAt, triggerId, previousRunId }`.
- [ ] Failed runs never disable a schedule by default; optional `pauseAfterConsecutiveFailures: N` auto-pauses the schedule with a visible reason in `Needs attention`.
- [ ] Inspection shows last fire, next fire, last $N$ outcomes, and fire lag (scheduled vs. actual start). Lag above a threshold appears in `Needs attention`.
- [ ] Schedules travel in portable exports **disabled by default** and respect **H3** pauses.
- **Docs to update:** `CONTEXT.md`, `docs/architecture.md`, `docs/v1.md`, `README.md`, `packages/mcp/src/server.ts`.

### H10. Execution provenance bindings & node `visitCount` — [#237](https://github.com/dgca/interlock/issues/237)
**Replaces:** our review-evidence script's external database queries and pass-through Switch loop-counter ledgers (closes remaining [#71](https://github.com/dgca/interlock/issues/71) criteria).
- [ ] Record engine-verified provenance on each accepted node execution: `{ profileId, harness, sessionId, requestedModel, actualModel, provider, effort, attempt, visitCount, startedAt, endedAt, usage }`, populated by the engine/manager and never overwritable by agent output (`null` when unknown).
- [ ] Expose `source: "execution"` (`nodeId`, `path`, `sourceDefault`) in node input bindings and Branch cases—including `execution.<nodeId>.visitCount` (the 1-based count of completed executions of `<nodeId>` in the current run)—and expose provenance to Scripts (`INTERLOCK_EXECUTION_PROVENANCE_FILE` or env) and run inspection.
- **Docs to update:** `docs/node-data.md`, `docs/agent-workflows.md`, `docs/managed-executors.md`, `docs/architecture.md`.

### H11. Provider-diversity constraint for independent review (`distinctProviderFrom`) — [#238](https://github.com/dgca/interlock/issues/238)
**Replaces:** our reviewer-selection logic and model-vendor table.
- [ ] An Agent node can declare `distinctProviderFrom: string[]` (upstream Agent `nodeId`s) and an ordered list of candidate models (or an **M5** alias).
- [ ] At claim/dispatch time, Interlock selects the first candidate whose provider differs from the providers **actually used** (recorded via **H10**) by the latest accepted executions of the named nodes in the current run (counting a continuity group's pinned model).
- [ ] Provider identity comes from the harness catalog when reported (such as Pi `provider/model`), else from a configurable local provider-prefix table in settings. Unknown providers or exhausted candidates leave the work unclaimed with an explicit blocker reason—never falling back to the same provider.
- **Docs to update:** `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.

### H12. Stall detection & attempt wall-clock deadlines — [#239](https://github.com/dgca/interlock/issues/239)
**Replaces:** our external stall watcher, 3-minute idle nudger, and 10-minute session respawner.
- [ ] Configurable thresholds at library, workflow, and node level:
  - Available and unclaimed longer than $N$ (`unclaimedStallMs`).
  - Claimed with no progress or renewal longer than $N$ (`claimedIdleStallMs`).
  - Waiting for a human longer than $N$ (`humanWaitStallMs`).
  - Run with no step transition longer than $N$ (`runStallMs`).
- [ ] Optional `maxExecutionMs` on Agent nodes to bound total active wall-clock execution duration per attempt (independent of lease renewals).
- [ ] Paused time (**H3**) and declared holds (`workHolds` / `needs_human`) are excluded from stall thresholds and `maxExecutionMs`.
- [ ] Crossing a stall threshold adds a `stalled` entry to `Needs attention`, emits the **M2** `stalled` event, and for managed work can run an **H7** recovery action (send idle nudge message, then stop and relaunch) up to a cap.
- **Docs to update:** `docs/timers.md`, `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.

---

## Medium Priority (P2 — Remove the Operator CLI, Pollers & Workarounds)

### M1. Authenticated webhook triggers & waiting-input delivery — [#240](https://github.com/dgca/interlock/issues/240)
**Replaces:** our board polling for intake and human moves, and our tracker-label polling.
- [ ] Expose `POST /hooks/:triggerId` (plus an opt-in `--hooks-port` listener that mounts *only* `/hooks/:triggerId` so webhook ingress can be exposed through a reverse proxy or tunnel while keeping UI, tRPC, and `/mcp` strictly loopback-only).
- [ ] **Mandatory HMAC authentication** using a shared secret stored as an Interlock `Secret` variable (configurable header name, algorithm prefix such as `sha256=`, and signed material covering the body or `<timestamp>.<body>`). Unsigned triggers or triggers whose `requestId`/timestamp sources fall outside signed material cannot be saved. Reject replays outside the timestamp window.
- [ ] **Filters & bindings**: match path filters (unmatched requests return `202 Ignored` and increment a counter without storing payloads) and map body/header paths into:
  1. `start_run` (with `requestId` from signed delivery ID, `externalTask`, and **H8** `onActiveExternalTask` policy),
  2. [#207](https://github.com/dgca/interlock/issues/207) waiting input node submission (resolved by `externalTask` + `nodeId` to a single waiting execution, rejecting if 0 or >1 match or if the signed event time predates the waiting execution's start), or
  3. Cancelling/holding active runs matching `externalTask` when an external event marks work ineligible (for example issue closed or label removed).
- [ ] Enforce body size limits, per-trigger rate limits, and a bounded delivery log visible in UI, CLI, and MCP.
- **Docs to update:** `docs/architecture.md` (Local interfaces section), `docs/variables.md`, `docs/v1.md`, `README.md`.

### M2. Internal run lifecycle event triggers & quiescent teardown — [#241](https://github.com/dgca/interlock/issues/241)
**Replaces:** failure comments, stall alerts, and terminal-state worktree cleanup in the coordinator.
- [ ] Start a workflow when another run reaches `completed` (optionally filtered by Exit node), `failed`, `cancelled`, `needs_attention`, or `stalled` (**H12**).
- [ ] Scope to one workflow, a workflow and its children, or the library. Pass a compact event payload (`runId`, `workflowId`, `version`, `externalTask`, `stage`, `waiting`, failing node, error summary).
- [ ] Support `waitForQuiescence: true` on terminal triggers (`completed | failed | cancelled`) so teardown workflows (such as deleting a git worktree) fire only after all child runs, scripts, and uncertain claims in the triggered run tree have stopped.
- [ ] Deduplicate on `(eventId, triggerId)` and prevent loops via a persisted causal `triggerChain` (never firing a trigger already in the chain, capping depth at a configurable max default of `2`, and logging suppressed events).
- **Docs to update:** `docs/architecture.md`, `docs/v1.md`.

### M3. Exclusive resources for Script, Fetch, and polling Wait steps — [#242](https://github.com/dgca/interlock/issues/242)
**Replaces:** our deploy lockfile and custom owner-liveness checks.
- [ ] Extend `WorkResources` so Script, Fetch, and polling Wait nodes can declare `resources`, acquired before the step starts and released when it ends, using the same uncertain-ownership reconciliation rules as Agent nodes.
- [ ] Steps waiting on a resource report `waiting: { kind: "resource", ... }` (**H4**) and do not consume their execution timeout while queued for the resource.
- **Docs to update:** `docs/work-resources.md`, `docs/architecture.md`, `docs/v1.md`.

### M4. Session visibility: name templates, deep links & live tail — [#243](https://github.com/dgca/interlock/issues/243)
**Replaces:** manual log hunting to find and watch active agent sessions.
- [ ] Session name template evaluated from run data (for example `{{externalTask.id}} {{node.label}}: {{externalTask.title}}`) and passed to harnesses that support session names (**H6** custom launchers, Pi, etc.).
- [ ] Inspection and UI expose the native `sessionId` plus a copyable resume command or clickable deep link when supplied by the harness.
- [ ] Bounded live tail of the session's recent messages in the Run Inspector alongside progress entries.
- **Docs to update:** `docs/managed-executors.md`, `docs/architecture.md`.

### M5. Revisioned model aliases — [#244](https://github.com/dgca/interlock/issues/244)
**Replaces:** hardcoded model IDs across workflows and republishing workflows just to swap a role's model.
- [ ] Locally configured, revisioned named aliases (for example `builder`, `reviewer`, `reviewer-alt`), each mapping to an ordered list of `{ model, effort?, profileId? }` candidates.
- [ ] Workflows and Agent nodes (including **H11** `distinctProviderFrom`) can reference an alias wherever they accept a model. Each run captures the resolved alias revision at startup alongside `variableCaptures` so mid-run edits never mutate active runs.
- [ ] Portable bundles export alias requirements without local definitions.
- **Docs to update:** `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.

### M6. Optional prompt pinning at publish & CLI bundle sync — [#245](https://github.com/dgca/interlock/issues/245)
**Replaces:** our ~700-line custom `deploy` tool and prompt/workflow version skew.
- [ ] Opt-in workflow setting `pinPromptsAtPublish: boolean`. When enabled, publishing a workflow version pins the exact current `revision` of every referenced saved prompt in the immutable `WorkflowVersion`, and runs of that version capture those pinned prompt revisions instead of floating to latest.
- [ ] Add `--dry-run` (semantic diff against published definitions ignoring layout and key order) and `--publish --cascade` to `interlock import` so Git-tracked workflow bundles can be diffed, imported, and published atomically from the CLI.
- **Docs to update:** `docs/prompts.md`, `docs/architecture.md`, `docs/v1.md`, `README.md`.

### M7. Move in-flight runs to newer published versions — [#201](https://github.com/dgca/interlock/issues/201)
**Replaces:** version-skew compatibility branches in the coordinator for 14-day runs.
- Tracked in [#201](https://github.com/dgca/interlock/issues/201). Opt-in step-boundary upgrade policy and explicit operator upgrade action with compatibility preview.

### M8. Accept run-level observer usage outside claim attempts — [#204](https://github.com/dgca/interlock/issues/204)
**Replaces:** our separate "cost outside attempts" calculation for continuity sessions.
- Tracked in [#204](https://github.com/dgca/interlock/issues/204). Cumulative observer usage streams scoped to `(runId, sessionId/executorId)` included in `get_run_usage` and `runBudgets`.

### M9. `interlock doctor` health and readiness check — [#246](https://github.com/dgca/interlock/issues/246)
**Replaces:** our ~1,400-line health check script.
- [ ] Read-only `doctor` operation (`interlock doctor [--live] [--json]`, MCP, shared API `GET /version` + `system.doctor`, and UI diagnostics view) with nonzero CLI exit on failure:
  - Engine version, SQLite integrity and schema state, history size, and free disk space.
  - Enabled profiles: executable detected, version, `cwd` and `allowedRoots` exist, and optional `--live` check that runs a minimal prompt to verify auth and model access.
  - Triggers: last fire, schedule lag, consecutive failures, auto-paused schedules, and recent webhook rejections.
  - Active blockers: **H3** pauses, uncertain resource/executor holds awaiting reconciliation, **H12** stalled work, and `needs_model` holds.
  - Missing, disabled, or unbound variables and model aliases referenced by latest published workflows, plus workflows with unpublished draft edits (`draftMatchesLatest === false`).
- **Docs to update:** `README.md`, `docs/architecture.md`, `packages/mcp/src/server.ts`.

### M10. Workflow performance and cost report (`interlock report`) — [#247](https://github.com/dgca/interlock/issues/247)
**Replaces:** our custom performance and spend reporting CLI.
- [ ] `report` operation over a workflow (or library) and time window across CLI, MCP, shared API, and UI:
  - Run duration and time per `stage` (**H4**) and per node (median and p90), including queued time (**H8**) and human wait.
  - Claim wait (`available` to `claimed`) split by new vs. continuing sessions, plus attempts, lease expiries, failures, **H7** recoveries, and **H12** stalls.
  - Usage and cost per run, per node, per model/alias, and per provider, with measured vs. unknown coverage stated explicitly (never estimated).
  - Outcome counts by `Exit` node so "finished unattended" vs. "needed a person" is directly measurable.
- **Docs to update:** `docs/usage-reporting.md`, `docs/architecture.md`, `README.md`.

### M11. Simulation for parent workflows (waited children, virtual clock & route coverage) — [#248](https://github.com/dgca/interlock/issues/248)
**Replaces:** our external routing test harness for parent workflows.
- [ ] Extend fixture simulation (`packages/runtime/src/simulation.ts`) to support waited child workflows (via per-child fixtures or nested simulation), Wait nodes and polling checks on a deterministic virtual clock, Agent `unclaimedTimeoutMs`, and `onFailure: "route"` branches.
- [ ] Include route/edge coverage in simulation reports so untested branches are visible.
- **Docs to update:** `docs/workflow-simulation.md`, `docs/architecture.md`, `docs/v1.md`.

### M12. Agent skills for workflow migration and factory operations — [#194](https://github.com/dgca/interlock/issues/194)
**Replaces:** our custom operator runbook.
- Tracked in [#194](https://github.com/dgca/interlock/issues/194).

---

## Low Priority (P3 — Polish & Retention)

### L1. Run key-value tags — [#249](https://github.com/dgca/interlock/issues/249)
- [ ] Arbitrary bounded key-value `tags` at run start (for example `repo`, `priority`, `batch`), filterable in `list_runs`, the UI, and **M10** reports.

### L2. Cancel a run tree, including detached descendants — [#250](https://github.com/dgca/interlock/issues/250)
- [ ] One operation (`cancel_run_tree` with `includeDetached: true` and a read-only preview) for clearing a bad batch or runaway tree in a single action.
- **Docs to update:** `docs/workflow-execution.md`, `docs/v1.md`.

### L3. Automatic history retention policy — [#251](https://github.com/dgca/interlock/issues/251)
- [ ] Optional age- or count-based retention policy per workflow or library that runs the existing dependency-safe history cleanup on a schedule.
- **Docs to update:** `docs/history-cleanup.md`, `docs/v1.md`.

### L4. Notifications — [#252](https://github.com/dgca/interlock/issues/252)
- [ ] Optional local desktop notifications for new `Needs attention` entries.
- [ ] Optional outbound HMAC-signed POST action on **M2** lifecycle events for lightweight external alerts without running a notification workflow.

---

## Execution Tracks (For Parallel Agent Dispatch)

To avoid merge conflicts in `packages/core/src/index.ts`, `packages/runtime/src/index.ts`, and `packages/mcp/src/server.ts`, execute High Priority tasks in three non-overlapping tracks (at most one active task per track at a time):

| Track | Primary modules | Ordered sequence |
|---|---|---|
| **Track 1: Engine Lifecycle, Pause & Projections** | `runtime/index.ts`, `continuation.ts`, `workHolds.ts`, `runStarts.ts` | **H3** ([#230](https://github.com/dgca/interlock/issues/230) Pause) → **H1** ([#207](https://github.com/dgca/interlock/issues/207) Input node) → **H4** ([#231](https://github.com/dgca/interlock/issues/231) Stage + Waiting + Actor) → **H8** ([#235](https://github.com/dgca/interlock/issues/235) Admission queue) → **H9** ([#236](https://github.com/dgca/interlock/issues/236) Schedules) → **H12** ([#239](https://github.com/dgca/interlock/issues/239) Stall detection) |
| **Track 2: Managed Executors & Provenance** | `runtime/executors/manager.ts`, `executors/contracts.ts` | **H5** ([#232](https://github.com/dgca/interlock/issues/232) Dynamic `cwd`) → **H6** ([#233](https://github.com/dgca/interlock/issues/233) Custom harness / launcher) → **H7** ([#234](https://github.com/dgca/interlock/issues/234) Session recovery) → **H10** ([#237](https://github.com/dgca/interlock/issues/237) Provenance & `visitCount`) → **H11** ([#238](https://github.com/dgca/interlock/issues/238) Provider diversity) |
| **Track 3: Deterministic Steps & Resources** | `runtime/scripts.ts`, `runtime/workResources.ts` | **H2** ([#202](https://github.com/dgca/interlock/issues/202) Long-running Scripts) → **M3** ([#242](https://github.com/dgca/interlock/issues/242) Step exclusive resources) |



Coordinator constraints: Work only in /Users/dan/dev/interlock-worktrees/issue-235 on feat/issue-235, based on main 8cf9813526f30274f853a597ed67977d259ed5e9. Engine & Runtime track H8 only. User authorized autonomous ordinary design decisions and PR/self-merge after review and CI, deferred design review to end; do not ask whether SDLC. Author must stop when fresh final Review change is AVAILABLE before claiming, pushing, or creating PR. Parent supplies independent reviewer and delivery continuation. Preserve #224 background scripts, #231 stage/waiting/actor projections, #230 pause hold unions and gates, #232 cwd, #233 custom launchers with async dispatch/one-time worker ticket. Never rely on stale scan eligibility after awaits. Preserve JavaScript and legacy Bash execution and persistence protections. No shared real server pause/restart/config changes or user .interlock data. Tests/validation isolated temporary databases, servers and ports. Required docs architecture, managed-executors, idempotent-run-starts, v1 and all affected README/CLI help/MCP workflow descriptions/schemas/defaults/returned fields/lifecycle guidance; verify HTTP and stdio discovery. Pending patch changeset for @type_of/interlock. Run relevant tests, pnpm build, pnpm format:check; package/CLI startup/version changes also test:package after build. Keep concise artifacts in .tasks/issue-235 with exact evidence provenance. Fetch/rebase latest origin/main before final review and rerun checks. No release, publication or merge by author. Mandatory eventual delivery fetch/rebase/build/test/push --force-with-lease; changed candidate after pass requires independent exact-head review. Eventual PR template with Closes #235.
