# Retry a run start safely

Use an ordinary start's optional `requestId` when an event or heartbeat can deliver the same request twice. Interlock creates the run once and returns that original run on identical redelivery, including after a lost response or server restart. Omit the key to keep existing fresh-run behavior.

The optional `versionPolicy` is part of start-request identity. Keep it identical when replaying a request key. Omission preserves the pinned default; `latest-compatible` opts the created run into [safe-boundary upgrades](workflow-execution.md#move-a-run-to-a-newer-version). Inspect or update that existing run through version-policy operations instead of changing the arguments of a receipt replay.

## Start one task attempt

Call MCP `start_run` with the task's original input and a stable key for this attempt:

```json
{
  "workflowId": "WORKFLOW_ID",
  "input": { "task": "Review issue 181" },
  "requestId": "github:dgca/interlock:181:attempt-1",
  "tags": { "repo": "dgca/interlock", "batch": "factory-7" },
  "externalTask": {
    "system": "github",
    "id": "dgca/interlock#181",
    "title": "Review issue 181",
    "url": "https://github.com/dgca/interlock/issues/181"
  }
}
```

After an uncertain response, repeat the same creation arguments and key. Full and summary responses can differ; they still identify the same original run. A replay reads its current retained state without advancing timers, expiring claims, retrying failed steps or creating more work. Use the returned ID with existing inspection, continuation and claim tools to continue execution.

A `requestId` is an opaque, nonblank string of 1–120 characters. Case and whitespace are significant. Prefer a UUID or a stable delivery/attempt identifier. Ordinary-start keys are library-wide, across workflows, and separate from comparison request IDs. Reusing a committed key for another workflow, input, version intent, budget, tags, or task reference rejects without creating anything. Errors do not copy the original input.

A deliberate new attempt uses a new key. The default active-task policy allows concurrent attempts. Set `onActiveExternalTask` to atomically reuse, reject, or cancel prior active attempts for the same task. Arbitrary Script, Fetch, and Agent effects still do not execute exactly once.

## Queue starts until capacity is available

A workflow definition can set `maxActiveRuns` to a positive whole number and `excludeStages` to at most 100 stage names. Each queued run uses its captured published settings. Active, admitted runs of the same workflow count across versions, except Batch item runs and runs currently in an excluded projected stage. Invoked workflows, comparison roots, and continue-as-new successors have their own admission. Batch items share their parent slot.

A start beyond capacity is accepted with status `queued`. Its captures, startup budget, and receipt persist before any node executes. Full inspection exposes `admission`, including `queuedAt`, `priority`, one-based `position`, pinned dependency references, and bounded `blockers`. Summary and briefing `waiting.kind` is `admission_queue`; `waiting.detail` includes position, priority, and blockers. Queued runs appear in Active, can be cancelled, and cannot be claimed before promotion. Use the existing run ID and change cursor to wait for admission.

Higher priority runs admit first, with FIFO ties. `priority` is an integer from -1,000,000 through 1,000,000 and defaults to zero. Queue position is scoped to the workflow and includes blocked entries. Missing dependencies and pauses do not prevent later eligible entries from using a slot. Priority has no aging policy. Completion, failure, cancellation, stage transitions, and server recovery can release capacity. Library and workflow pause holds gate promotion. Admitted runs keep progressing when they leave an excluded stage, so the active count can temporarily exceed the start limit.

## Choose an active-task policy

`onActiveExternalTask` matches normalized `externalTask.system` and `id` across the local library. Active means queued, running, or waiting, including continue-as-new successors. Policies other than `allow` require `externalTask`.

| Policy            | Result when a match exists                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `allow`, default  | Create another attempt, subject to admission.                                                                     |
| `reuse`           | Return the oldest active match without pumping it. A supplied request key retains a receipt pointing to that run. |
| `reject`          | Reject without creating a run or receipt.                                                                         |
| `cancel_previous` | Validate the replacement, cancel active matching lifecycles, and create the replacement atomically.               |

Cancellation retains existing detached boundaries and uncertain resource or process ownership. It does not prove previous external effects stopped. Reconcile uncertain attempts before using their resources again.

## Wait for prerequisite runs

Pass `after` as a list of 1 through 32 references. Each reference contains exactly one `requestId` or `externalTask:{system,id}`. Every dependency must succeed before promotion:

```json
{
  "workflowId": "REVIEW_WORKFLOW_ID",
  "input": {},
  "requestId": "review-attempt-1",
  "priority": 10,
  "after": [{ "requestId": "build-attempt-1" }],
  "externalTask": { "system": "github", "id": "dgca/interlock#181" },
  "onActiveExternalTask": "reject"
}
```

Request keys resolve their original receipt. Task identities select the newest retained matching run when first found. Resolution pins that run ID and follows its continue-as-new successors. A later attempt cannot replace the pinned dependency. Missing references can resolve later. Failed, cancelled, or removed dependencies leave an explicit blocker and never start the dependent. A start cannot depend on its own request key. Cycles stay queued. Cancel a permanently blocked start and submit a new explicit attempt when its prerequisites change.

CLI equivalents are `--priority N`, `--after json|@file`, and `--on-active-external-task allow|reuse|reject|cancel_previous`. They accompany the existing start options. `interlock runs --status queued` finds waiting starts.

## Keep creation arguments stable

The receipt fingerprint includes:

- Workflow ID and original JSON input, with object key order ignored.
- Requested version intent. An omitted version means "select latest for this new start" and remains distinct from an explicit version number.
- The parsed optional budget, tags, and external task metadata. Supplied `tags: {}` remains distinct from omitted tags.
- Supplied `priority`, `after`, `onActiveExternalTask`, and `versionPolicy` options. Omitted options remain distinct from explicit values.

If the original request omitted `version`, repeating it still returns the original run after newer versions are published. Replacing that omission with its resolved version number is a conflicting request. Current prompt edits and library archive state do not change an accepted start's identity or its captured prompt content.

Optional budget defaults and validations use the existing run-budget contract. Omission means no startup policy; it is not equivalent to supplying an explicit policy. Object property order does not matter. A replay never reapplies the original budget over a later authorized adjustment, resets usage or allocates another budget.

`detail`, the summary `limit`, and transport choice are response settings and do not affect identity. Invalid response settings still fail validation. Identical requests can move between shared HTTP API, HTTP MCP, stdio MCP, and CLI without creating another run. Persist the original creation arguments alongside the key in the caller if it needs to redeliver them.

The initial run, selected version, prompt capture, chain state, correlation, startup budget and receipt commit in one storage transaction before execution starts. A rejected initial validation/start leaves no committed receipt, so that unused key can accompany a corrected request. A later execution failure does not undo an accepted start. Completed, failed and cancelled originals remain replayable reads; use normal explicit recovery or a new attempt when intended.

## Find linked runs

`externalTask` is optional and independent of `requestId`. It contains a non-secret `system` of 1–64 characters, stable `id` of 1–200 characters, optional `title` of 1–200 characters, and optional HTTP(S) `url` up to 2,000 characters. All fields trim surrounding whitespace; identity comparisons remain case-sensitive. Links cannot embed credentials. Do not put tokens, secrets or authority in these fields. Title and URL participate in the start fingerprint, so keep them unchanged on redelivery. Task filters accept only system and ID.

Correlation never changes original task input, updates a board, grants permission, or deduplicates a start under the default `allow` policy. It is not copied into portable workflow bundles. Existing full run inspection and briefings include it; compact mutation responses expose it when present.

Use MCP `list_runs` or shared `runs.find`:

```json
{ "requestId": "github:dgca/interlock:181:attempt-1" }
```

```json
{
  "externalTask": { "system": "github", "id": "dgca/interlock#181" },
  "rootOnly": true,
  "limit": 20
}
```

The task filter requires its exact system and ID, without the URL. Existing status, workflow, chain and input filters can be combined. Lookup does not reserve a task. Use an atomic active-task start policy when needed. A start key appears as `startRequestId` on its original run only. Continue-as-new successors inherit `externalTask`, but the same key always returns the original predecessor; follow its chain links to the current successor. Ordinary nested/detached children retain their existing ancestry and do not acquire task ownership or a new start key.

## Tag and filter runs

Optional `tags` stores non-secret `Record<string, string>` metadata separately from workflow input. It accepts at most 16 entries. Keys contain 1 through 64 characters, and values contain 0 through 64 characters. Keys and values are exact and case-sensitive, without trimming. Empty values are valid. Tags participate in the start fingerprint, including the distinction between omitted tags and an explicit empty object. Property order does not affect identity.

Runs capture tags when created. An active-task `reuse` result keeps the existing run's tags. Retrying a step preserves them. Workflow invocations, detached children, Batch items, and continue-as-new successors inherit the initiating run's tags. They do not change task ownership or acquire a start request key. Event handlers use their trigger's configured tags; source tags remain available in the event input.

MCP `list_runs`, shared `runs.find`, and the paginated `runs.summaries` query accept `tags` with the same bounds. Every supplied pair must match. Missing keys and different values do not match; an empty filter imposes no restriction. SQLite indexes tag key/value pairs before applying ordering and pagination. Tags appear on run summaries, full inspection, compact mutations, and briefing run metadata. The Runs UI provides the same exact-pair filter.

```json
{ "tags": { "repo": "dgca/interlock", "batch": "factory-7" }, "limit": 20 }
```

MCP `workflow_report` and shared `report.summary` accept the same `tags` filter. The [performance report](usage-reporting.md#workflow-performance-and-cost-reports) applies every exact pair before its sample limit, then aggregates metrics and reported usage for the selected runs. Tags select the sample; they do not add tag grouping. Existing per-run usage inspection and workflow comparison reports keep their current scopes.

## Recover after deletion or restart

Receipts survive ordinary server restart. Replays do not require the latest library definition or prompt revisions to remain available. Explicitly removed definitions still produce the existing `definitionAvailable:false` inspection behavior for retained historical runs.

Supported workflow/history deletion retains a minimal deleted receipt. An old request cannot recreate removed work, including after restoring its workflow definition. A missing original run or a missing receipt with surviving tagged history also rejects. Inspect what remains before intentionally starting another attempt with a new key. Do not automatically change keys to hide a conflict or missing-history error.

Receipts contain a hashed key, request fingerprint, original run/workflow/version identities and timestamps, without input or prompt bodies. They remain indefinitely; this increment has no forget or pruning operation. Portable workflow exports/imports do not carry them. Importing definitions into the existing library does not erase its receipts. A new library has a new key namespace; restore a full database backup to retain historical start knowledge.

Direct database edits that remove both run and receipt, restoring a backup from before the start, or replacing/resetting the library discard that knowledge. The server cannot deduplicate facts no longer present in its database. Interlock retains its single-owner local database model; this change does not add competing server processes or a distributed scheduler.

## CLI and shared API

Save non-secret task metadata in `task.json` and, if needed, a policy in `budget.json`:

```sh
interlock start WORKFLOW_ID '{"task":"Review issue 181"}' --request-id github:dgca/interlock:181:attempt-1 --external-task @task.json --budget @budget.json --tag repo=dgca/interlock --tag batch=factory-7 --summary
interlock runs --request-id github:dgca/interlock:181:attempt-1
interlock runs --tag repo=dgca/interlock --tag batch=factory-7
interlock report --tag repo=dgca/interlock --tag batch=factory-7
interlock runs --external-task '{"system":"github","id":"dgca/interlock#181"}' --root-only
```

Inline JSON and `@file` work for task metadata and budgets. Repeat `--tag KEY=VALUE` for each tag on starts, run queries, or performance reports. Values can contain `=` and can be empty; duplicate keys reject. Omit `--summary` for full inspection; it does not change request identity. The optional positional version retains its existing meaning.

Shared `runs.start` and `runs.startSummary` accept `requestId`, `externalTask`, `tags`, `priority`, `after`, and `onActiveExternalTask` beside their existing fields. Direct Engine callers can supply `{requestId, externalTask, tags, priority, after, onActiveExternalTask}` as the final optional options argument after `budget`, preserving existing positional calls. Shared and MCP result references, cancellation, claims, budgets, ordinary/detached lifecycles and explicit retries keep their existing rules.

Schedule fires use the same atomic RunStarts receipts with `schedule:<triggerId>:<slotIso>` and captured input/published version. Overlap queue waits for prior schedule runs to become terminal even on failure; public `after` dependencies retain success-only behavior. See [workflow schedules](schedules.md).
