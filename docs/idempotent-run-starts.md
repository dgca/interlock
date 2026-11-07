# Retry a run start safely

Use an ordinary start's optional `requestId` when an event or heartbeat can deliver the same request twice. Interlock creates the run once and returns that original run on identical redelivery, including after a lost response or server restart. Omit the key to keep existing fresh-run behavior.

## Start one task attempt

Call MCP `start_run` with the task's original input and a stable key for this attempt:

```json
{
  "workflowId": "WORKFLOW_ID",
  "input": { "task": "Review issue 181" },
  "requestId": "github:dgca/interlock:181:attempt-1",
  "externalTask": {
    "system": "github",
    "id": "dgca/interlock#181",
    "title": "Review issue 181",
    "url": "https://github.com/dgca/interlock/issues/181"
  }
}
```

After an uncertain response, repeat the same creation arguments and key. Full and summary responses can differ; they still identify the same original run. A replay reads its current retained state without advancing timers, expiring claims, retrying failed steps or creating more work. Use the returned ID with existing inspection, continuation and claim tools to continue execution.

A `requestId` is an opaque, nonblank string of 1–120 characters. Case and whitespace are significant. Prefer a UUID or a stable delivery/attempt identifier. Ordinary-start keys are library-wide, across workflows, and separate from comparison request IDs. Reusing a committed key for another workflow, input, version intent, budget or task reference rejects without creating anything. Errors do not copy the original input.

A deliberate new attempt uses a new key. The same external task can have multiple attempts, including concurrent ones. This feature deduplicates one start request; it does not reserve an external issue or enforce one active owner. Keep that policy in the external coordinator. It also does not make arbitrary Script, Fetch or Agent effects execute exactly once.

## Keep creation arguments stable

The receipt fingerprint includes:

- Workflow ID and original JSON input, with object key order ignored.
- Requested version intent. An omitted version means "select latest for this new start" and remains distinct from an explicit version number.
- The parsed optional budget and external task metadata.

If the original request omitted `version`, repeating it still returns the original run after newer versions are published. Replacing that omission with its resolved version number is a conflicting request. Current prompt edits and library archive state do not change an accepted start's identity or its captured prompt content.

Optional budget defaults and validations use the existing run-budget contract. Omission means no startup policy; it is not equivalent to supplying an explicit policy. Object property order does not matter. A replay never reapplies the original budget over a later authorized adjustment, resets usage or allocates another budget.

`detail`, the summary `limit`, and transport choice are response settings and do not affect identity. Invalid response settings still fail validation. Identical requests can move between shared HTTP API, HTTP MCP, stdio MCP, and CLI without creating another run. Persist the original creation arguments alongside the key in the caller if it needs to redeliver them.

The initial run, selected version, prompt capture, chain state, correlation, startup budget and receipt commit in one storage transaction before execution starts. A rejected initial validation/start leaves no committed receipt, so that unused key can accompany a corrected request. A later execution failure does not undo an accepted start. Completed, failed and cancelled originals remain replayable reads; use normal explicit recovery or a new attempt when intended.

## Find linked runs

`externalTask` is optional and independent of `requestId`. It contains a non-secret `system` of 1–64 characters, stable `id` of 1–200 characters, optional `title` of 1–200 characters, and optional HTTP(S) `url` up to 2,000 characters. All fields trim surrounding whitespace; identity comparisons remain case-sensitive. Links cannot embed credentials. Do not put tokens, secrets or authority in these fields. Title and URL participate in the start fingerprint, so keep them unchanged on redelivery. Task filters accept only system and ID.

Correlation never changes original task input, updates a board, grants permission, or deduplicates a start by itself. It is not copied into portable workflow bundles. Existing full run inspection and briefings include it; compact mutation responses expose it when present.

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

The task filter requires its exact system and ID, without the URL. Existing status, workflow, chain and input filters can be combined. Lookup does not reserve a task. A start key appears as `startRequestId` on its original run only. Continue-as-new successors inherit `externalTask`, but the same key always returns the original predecessor; follow its chain links to the current successor. Ordinary nested/detached children retain their existing ancestry and do not acquire task ownership or a new start key.

## Recover after deletion or restart

Receipts survive ordinary server restart. Replays do not require the latest library definition or prompt revisions to remain available. Explicitly removed definitions still produce the existing `definitionAvailable:false` inspection behavior for retained historical runs.

Supported workflow/history deletion retains a minimal deleted receipt. An old request cannot recreate removed work, including after restoring its workflow definition. A missing original run or a missing receipt with surviving tagged history also rejects. Inspect what remains before intentionally starting another attempt with a new key. Do not automatically change keys to hide a conflict or missing-history error.

Receipts contain a hashed key, request fingerprint, original run/workflow/version identities and timestamps, without input or prompt bodies. They remain indefinitely; this increment has no forget or pruning operation. Portable workflow exports/imports do not carry them. Importing definitions into the existing library does not erase its receipts. A new library has a new key namespace; restore a full database backup to retain historical start knowledge.

Direct database edits that remove both run and receipt, restoring a backup from before the start, or replacing/resetting the library discard that knowledge. The server cannot deduplicate facts no longer present in its database. Interlock retains its single-owner local database model; this change does not add competing server processes or a distributed scheduler.

## CLI and shared API

Save non-secret task metadata in `task.json` and, if needed, a policy in `budget.json`:

```sh
interlock start WORKFLOW_ID '{"task":"Review issue 181"}' --request-id github:dgca/interlock:181:attempt-1 --external-task @task.json --budget @budget.json --summary
interlock runs --request-id github:dgca/interlock:181:attempt-1
interlock runs --external-task '{"system":"github","id":"dgca/interlock#181"}' --root-only
```

Inline JSON and `@file` work for task metadata and budgets. Omit `--summary` for full inspection; it does not change request identity. The optional positional version retains its existing meaning.

Shared `runs.start` and `runs.startSummary` accept `requestId` and `externalTask` beside their existing fields. Direct Engine callers can supply `{requestId, externalTask}` as the final optional options argument after `budget`, preserving existing positional calls. Shared and MCP result references, cancellation, claims, budgets, ordinary/detached lifecycles and explicit retries keep their existing rules.
