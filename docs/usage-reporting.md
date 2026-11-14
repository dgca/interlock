# Usage reporting

Interlock records usage supplied by external executors or measuring observers. It does not read provider accounts, parse session logs, or infer token counts from prompts. When tokens arrive without a cost, it [derives the cost from a local price table](#derived-cost). Optional [run budgets](run-budgets.md) can gate new Agent claims using these reports. Reporting is optional. Missing figures appear as unknown, including for completed runs.

## Report a claim attempt

MCP `report_usage` and the shared API `work.reportUsage` accept a work ID, the claim's `attempt` number and `token`, and a cumulative `snapshot`:

```json
{
  "workId": "WORK_ID",
  "attempt": 1,
  "token": "CLAIM_TOKEN",
  "snapshot": {
    "sequence": 1,
    "final": false,
    "models": [
      {
        "provider": "example-provider",
        "model": "example-model",
        "inputTokens": 100,
        "outputTokens": 20,
        "cachedInputTokens": 40,
        "reasoningOutputTokens": 5,
        "cost": {
          "amountMicros": 1250,
          "currency": "USD",
          "source": "provider response"
        }
      }
    ]
  }
}
```

Use measured values in place of the example. Omit unavailable fields. A reported zero means the executor measured zero. Input and output counts include their cache and reasoning subsets; those subsets are not added again. `cachedInputTokens` counts prompt-cache reads and the optional `cacheWriteInputTokens` counts prompt-cache writes; both are part of `inputTokens`. When both are supplied, a subset cannot exceed its total.

Each snapshot contains one to 20 unique, case-sensitive provider/model pairs. Provider and model names are trimmed, nonempty strings of at most 200 characters. Token counts and `amountMicros` are nonnegative safe integers. Costs use millionths of the stated three-letter uppercase currency code. Every cost requires a nonempty source of at most 300 characters, such as a provider response or an executor estimate. Interlock stores that attribution; it does not verify it against a bill.

`sequence` is a positive safe integer. Start at 1 and increase it for each update. Reports replace the previous cumulative snapshot for that attempt; they are not deltas. An identical retry of the latest sequence returns `applied:false`. A different payload with the same sequence or an older sequence is rejected. Model order does not affect duplicate detection.

A newer snapshot cannot remove a model, omit or decrease a known count, or remove or decrease a reported cost. Its cost currency and source must remain unchanged. Different attempts have independent sequences. Set `final:true` only after collecting all available usage for the attempt. A final snapshot cannot change, but an identical retry remains valid. `final` defaults to false. Omitted fields remain unknown even in a final snapshot. Billing corrections are outside this reporting contract.

Reports do not renew leases, submit results, or change run status. A retained token can report its original attempt after completion, failure, expiry, or cancellation, including after another worker claims the assignment. That token still cannot renew an expired claim or submit an assignment result. New claims capture internal token hashes for this purpose; inspection never returns them. Keep claim credentials private.

`source` defaults to `executor`; explicit `source:"executor"` uses the same token requirement.

An acknowledgment contains `workId`, `attempt`, `source`, `sequence`, and `applied`. Each accepted update is transactional and records a `work.usage_reported` event. Usage-only changes refresh the UI through the event stream. When a report changes budget admission, assignment updates also advance run-continuation cursors.

## Report measured usage as an observer

A local orchestrator that measures usage can set `source:"observer"` and omit `token`:

```json
{
  "source": "observer",
  "workId": "WORK_ID",
  "attempt": 1,
  "snapshot": {
    "sequence": 1,
    "final": true,
    "models": [
      {
        "provider": "example-provider",
        "model": "example-model",
        "inputTokens": 100,
        "outputTokens": 20
      }
    ]
  }
}
```

The specific attempt must have a retained receipt with a recorded end: completed, failed, expired, cancelled, or held. A newer attempt may already be claimed. A live attempt is rejected, even after its lease deadline, until the engine records its end. An observer cannot create missing historical attempts or report unclaimed work. Observer requests containing a token are rejected. These are local, declared measurements, not authenticated identities or independently verified billing.

Executor and observer reports have independent cumulative sequences and finality. One observer stream exists per attempt; coordinating multiple measuring processes is the caller's responsibility. The same bounds, idempotency, cumulative rules, cost provenance, and immutable final snapshots apply to each source separately.

Once an observer report exists, its entire snapshot takes precedence over the executor snapshot in both usage totals and budget checks. Sources are never added together or merged field by field. Missing observer metrics remain unknown even if the executor supplied them. A later executor report remains inspectable but does not change selected usage. The first observer report can raise or lower selected totals and can change coverage or budget admission. Collect all available measurements before reporting; use `final:true` only when they are complete.

Attribute measurements to the specific claim attempt when work occurs during a claim. Do not report a shared session's lifetime totals against an assignment. When an executor session incurs overhead outside assignments, use run-level observer reporting.

## Report run-level observer usage outside claim attempts

When an executor session or orchestrator serves multiple assignments in a run (such as a context continuity group), tokens spent between assignments—reading the next briefing, resuming after a wait, recovering from an error, or awaiting a human answer—belong to no single claim attempt.

An observer can report this overhead directly against a run by providing `runId`, `source:"observer"`, and omitting `workId`, `attempt`, and `token`:

```json
{
  "source": "observer",
  "runId": "RUN_ID",
  "streamId": "session-continuity-1",
  "session": {
    "executorId": "claude",
    "sessionId": "session-abc-123"
  },
  "snapshot": {
    "sequence": 1,
    "final": true,
    "models": [
      {
        "provider": "example-provider",
        "model": "example-model",
        "inputTokens": 250,
        "outputTokens": 30
      }
    ]
  }
}
```

### When to use attempt vs run reporting

- **Attempt reporting (`workId`, `attempt`)**: Use for model activity executed during a specific claim attempt. Executor reports require the claim token; attempt-level observer reports require an ended attempt and omit the token.
- **Run reporting (`runId`, `source:"observer"`)**: Use for session and orchestrator tokens spent between assignments or outside any claim attempt. Requires `source:"observer"` and omits tokens.

### Streams and identity

Multiple observer streams can report for the same run without overwriting each other. Interlock keys run streams by `runId` and `streamId`. `streamId` defaults to `${session.executorId}:${session.sessionId}` when `session` is provided, or `"default"` when both are omitted. Providing distinct stream IDs or sessions allows different executor sessions serving the same run to maintain independent reporting streams.

### Lifecycle and acceptance window

Run-level observer reports are accepted while the target run is active (`pending`, `waiting`, `running`). After a run ends (`completed`, `failed`, or `cancelled`), reports are accepted for a bounded 1-hour grace window (`RUN_USAGE_GRACE_MS`) from the run's end time, allowing late measurements from external monitors to land before settling. Reports attempted after this window are rejected.

### Rules and aggregation

Run-level reports follow the exact same cumulative sequence monotonicity, duplicate idempotency (`applied:false`), cost attribution, and immutable final snapshot rules as attempt reports.

Run-level usage is added once into `get_run_usage` totals (and scoped descendants when `includeDescendants:true`). In `groupBy` breakdowns:

- `groupBy: "run"` includes run-level streams in that run's totals.
- `groupBy: "node"` labels run-level streams as `Run-level usage` with `nodeId: null`.
- `groupBy: "attempt"` includes each stream as an entry labelled `Run-level usage` with `attempt: null` and `workId: null`.
- `groupBy: "worker"` attributes the stream to `session.executorId` if provided.

Run budgets evaluate run-level usage under the same rules as attempt usage. Token and cost limits include run-level metrics, and `unknownUsage: "block"` blocks new claims if any run stream lacks final figures for configured metrics. Claims limits count assignment reservations only and are unaffected by run streams.

## Inspect totals and attribution

MCP `get_run_usage` and the shared API `runs.usage` require `runId`. The default scope is that run alone. Set `includeDescendants:true` to include all descendants, including Batch item runs and detached runs, exactly once. The response reports `includedRuns` and `includedDetachedRuns`. Inclusion in a usage total does not change cancellation or lifetime rules.

`groupBy` accepts `run`, `node`, `worker`, or `attempt`. The default is `node`; node groups are scoped by run so reused node IDs do not collide. Attempt groups include the selected `source`, `snapshot`, and `reportedAt`, plus claim timestamps and the recorded outcome. `source` is `executor`, `observer`, or null when no report exists. Set `includeReports:true` with attempt grouping to additionally inspect `reports.executor` and `reports.observer`, each containing its snapshot and reporting time or null. This option defaults to false and leaves totals unchanged. Worker attribution remains the executor who claimed the attempt, regardless of its reporting source.

Outcomes distinguish claimed, completed, failed, expired, cancelled, held, and unknown attempts. Held attempts retain measured usage and count toward claim budgets, without consuming failure or lease-expiry allowances.

Groups default to 20 records and cap at 100. `offset` ranges from 0 through 1,000,000. Use `nextOffset` for the next page; null means the last page. `totalGroups` counts every group. `totals` always covers the entire selected scope, regardless of pagination.

Attempt groups also expose `requestedTier` and `modelSelection` from claim time. `requestedTier:null` means a captured executor default; an omitted field means unavailable legacy attribution. `modelSelection:null` means no executor declaration. A declaration is not evidence of model execution and does not populate `snapshot` or token totals. The UI's **Usage and model attribution** section offers **Claim attempt** grouping to compare these fields with separately usage-reported model identities. See [model tiers](model-tiers.md).

Token metrics return `value`, `coverage`, and `overflow`. Coverage is `unknown` when no figures are available, `partial` when some are missing or any attempt has a non-final report, and `complete` when all scoped attempts and models supply final figures for that metric. A partial value is the sum of reported figures, not an estimate of missing usage. No claim attempts also produces unknown metrics, with `attempts:0`.

Costs remain separated by currency. `amountMicros` has the same metric structure, and `costCoverage` describes coverage across all scoped models and attempts. The API never adds currencies together. Aggregates above the safe-integer range return `value:null`, `overflow:true`, and partial coverage rather than an imprecise number.

The run inspector displays input/output totals, costs, reporting coverage, and paginated node attribution. **Claim attempt** grouping shows the selected usage source. **Include child runs, including detached** selects the broader scope explicitly.

For [continue-as-new chains](continue-as-new.md), set `includeChain:true` to include all members of the requested run's chain. This defaults to false. `includeDescendants:true` then adds descendants of every selected member, including detached runs, exactly once. The response echoes `includeChain`; pagination still bounds groups rather than totals.

## Derived cost

When a model's usage has tokens but no `cost`, Interlock prices it from a local price table. A cost the executor or observer reported always wins and is never replaced. Derived costs are added to `get_run_usage` totals, the run inspector, and workflow reports, and are marked so they stay distinguishable:

- Each derived model in a `snapshot` carries `derivedCost` with the price table (`id`, `version`, `custom`) and the per-million-token rates used. Its `cost.source` reads `Interlock price table VERSION`. Reported costs have no `derivedCost`.
- `totals.pricing` (and `usage.pricing` in reports) lists the tables and prices assumed, and the models with no price. A reason accompanies each gap: `no_price` (model not in the table), `incomplete_tokens` (input or output count unknown), or `no_table` (a run that finished before this feature, which stays unpriced). Lists are capped at 20 entries with `truncated`.

Failed, expired, cancelled and held attempts are priced like completed ones whenever they reported tokens. Managed executors that fail before returning a result still record no usage for that attempt.

Pricing uses integer arithmetic: rates are millionths of the table currency per million tokens, every token class is multiplied exactly, and the sum is rounded half up to millionths once per model report. Totals add those integers, so they do not drift.

Token classes:

- Uncached input (`inputTokens` minus cached reads and cache writes) uses the input rate.
- `cachedInputTokens` uses the cached-input rate, and `cacheWriteInputTokens` the cache-write rate. Where a model has no such rate, the input rate applies.
- When a count is not reported, those tokens are priced as ordinary input. Codex does not report cache writes, so OpenAI cache-write charges are priced as input. The Claude Code executor reports cache writes; 1-hour writes are priced at the 5-minute write rate.
- Reasoning tokens are part of `outputTokens` and use the output rate.
- The shipped OpenAI rates are the short-context rates (requests up to 272K input tokens). Interlock cannot see each request's size, so long-context requests are underpriced.

### Price table

A run captures the current price table when it starts and keeps it for all its usage. Continue-as-new successors, Batch items and Parallel branches inherit their source run's table, as they do variable captures; invoked child workflows capture the table current when they start. Editing the table therefore changes derived cost for runs started afterwards only. Runs started before this feature have no capture: they capture the current table at their next report of tokens without cost. Tables are stored by content, so a captured table never changes.

Interlock ships a table of public list prices for Claude (`anthropic`) and OpenAI (`openai`) models, with its version, source URLs and retrieval dates. List prices change between releases. Unknown models get no price rather than an estimate. Models served through other providers, such as Bedrock or Vertex, are not in the shipped table.

Table entries match the reported provider exactly (case-insensitive) and the model by exact ID first, then with a trailing date (`-20251001` or `@20251001`) and a trailing bracketed tag such as `[1m]` removed from both sides. An exact entry can therefore price one dated snapshot differently.

Read and replace the table with the CLI or the shared API `prices.read` and `prices.set`:

```sh
interlock prices
interlock prices @prices.json
```

The file holds the `id` returned by the read and the replacement table, or `null` to restore the shipped table:

```json
{
  "expectedId": "CURRENT_TABLE_ID",
  "table": {
    "version": "2026-11-13-local",
    "currency": "USD",
    "sources": [],
    "models": [
      {
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "inputMicros": 4000000,
        "cachedInputMicros": 200000,
        "cacheWriteMicros": 5000000,
        "outputMicros": 20000000
      }
    ]
  }
}
```

Rates are integer millionths of the currency per million tokens, so `4000000` is $4 per million tokens. `cachedInputMicros` and `cacheWriteMicros` are optional. A stale `expectedId` is rejected. The replacement table holds every model you want priced; it does not merge with the shipped table.

Run budgets count reported costs only; derived costs do not change budget admission.

## Use the CLI

Save the report payload in a private file and submit it with:

```sh
interlock report-usage @usage.json
interlock usage RUN_ID
interlock usage RUN_ID '{"includeDescendants":true,"groupBy":"attempt","includeReports":true,"limit":20,"offset":0}'
```

The CLI uses the same request contracts as MCP. `report-usage` accepts either source's payload as one JSON argument or `@file`; `usage` accepts a run ID and optional JSON options or `@file`.

## Existing data and retention

Usage receipts use the `usageAttempts` document collection, and run-level observer streams use `runUsage`. Price tables use `priceTables`, the selected table `priceTableSetting`, and each run's captured table `runPricing`. Observer snapshots are separate optional fields on attempt receipts; no database schema migration is needed. Existing snapshots remain executor reports. Historical attempts without receipts remain unknown and cannot receive observer reports. The latest legacy attempt can report as executor if its token is still retained by the work record. Older replaced or revoked legacy tokens cannot create attribution retroactively. Claim timestamps unavailable in legacy data remain null.

Receipts survive restart, retries, and published-definition cleanup. Deleting a workflow's run history also deletes its usage receipts, run-level usage streams and captured price table references. Portable workflow bundles exclude usage, just as they exclude runs. Summaries bound the returned groups, not the database scan or lifetime of retained history.

## Usage in workflow comparisons

[Comparison measurements](workflow-testbench.md#compare-measurements) freeze the observed trial's run and attempt inventory. Reports read current receipts for those original attempts, including late observer reports, with an as-of time. A later explicit retry does not add its work to the original measurement. Ordinary `get_run_usage` still describes current run history, including retries; its scope can therefore differ from a frozen comparison. Missing legacy inventories and deleted receipts remain unknown.

Attempt groups include `wallMs`, `pausedMs`, and `activeMs`, with null values when historical claim time is unknown. Active milliseconds subtract overlapping applicable library/workflow pause intervals once. They describe elapsed time excluding declared pauses, not measured model activity.

## Workflow performance and cost reports

Use `interlock report`, the MCP tool `workflow_report`, the shared API `report.summary`, or the UI **Report** view (`/report` or `/workflows/:id/report`) to generate operational performance and cost reports over a single workflow or across the entire library.

Reports select the newest matching runs by creation time. Optional `since` and `until` timestamps are inclusive and accept ISO datetimes with a timezone offset. Equivalent offsets and omitted fractional seconds select the same instants. Bounds are normalized to UTC for comparison with stored millisecond timestamps. Finer lower bounds round up and finer upper bounds round down to stored milliseconds. The rounded UTC bound must stay within `0000-01-01T00:00:00.000Z` through `9999-12-31T23:59:59.999Z`. Invalid calendar dates, malformed offsets and bounds outside that range return validation errors. Omitted dates impose no restriction. The sample limit defaults to 500 and accepts 1 through 5000 runs. The UI initially selects the past seven days and requests up to 1000 runs.

```sh
interlock report
interlock report --workflow WORKFLOW_ID --since 2026-01-01T00:00:00Z --limit 50
interlock report --tag repo=dgca/interlock --tag batch=factory-7 --json
```

Repeat `--tag KEY=VALUE` for each required pair. Keys and values are literal, case-sensitive, and untrimmed. Values may be empty or contain `=`; duplicate keys reject. Reports use the existing tag bounds of 16 pairs, keys of 1 through 64 characters, and values of 0 through 64 characters. All pairs must match, and tag filters combine with workflow and date filters. An empty tag filter imposes no restriction.

MCP `workflow_report` and shared `report.summary` accept the same filter:

```json
{
  "tags": { "repo": "dgca/interlock", "batch": "factory-7" },
  "since": "2026-01-01T00:00:00Z",
  "limit": 50
}
```

Open a workflow report from **Workflow actions → Performance & cost report** in its editor. **Back to workflow** returns to that workflow. The workflow-scoped report keeps its workflow fixed; use the global **Report** page to compare workflow scopes.

The Reports UI provides **Filter by tags** with **Apply filters** and **Clear filters** actions. Storage applies indexed tag matching before the sample limit. Every report metric and usage breakdown covers only the selected sample. Tags select runs; they do not create a tag grouping or automatically expand the sample to include descendants.

### Metrics and limits

- Run duration measures terminal wall time or elapsed time up to report generation for active runs. Admission queue wait measures time between queuing and admission. Human wait sums Input node execution time and declared work-hold intervals. Named library/workflow pauses are not themselves human-wait observations; their overlap with recorded human waits is exposed as paused time.
- Node durations include executions with both start and completion timestamps. Stage durations sum those node durations per stage within each run, using each execution’s recorded workflow version. A node group spanning different stages has no single stage label. Median and p90 interpolate between sorted observations at `(count - 1) * percentile`, rounded to two decimals. For example, observations of 1 and 10 produce p90 of 9.1.
- Claim wait measures availability to claim, split by new versus continuing sessions. Reliability includes attempts, lease expiries, failures, managed recovery events, and inactivity stalls.
- Usage totals sum supplied token and cost figures, plus [derived costs](#derived-cost) for tokens reported without cost. `usage.pricing` states the prices assumed and the models with no price. Currency totals and alias groups keep currencies separate. Run, node, model, and provider groups spanning multiple currencies return `costMicros: null` and `currency: "mixed"`. Selected observer attempt snapshots take precedence over executor snapshots. Groups cover run, node, reported provider/model, provider, and captured model alias. Run-level observer streams contribute to totals and run, model, and provider groups, but not node groups or attempt coverage.
- The UI shows **Unmeasured** for headline spend when attempt coverage is zero or no currency totals were supplied. An explicitly reported zero cost remains zero when coverage is nonzero. Partial coverage stays visible beside reported totals.
- Measured coverage is the percentage of retained attempts with at least one selected model snapshot. It does not establish that each token or cost field is known or final. Missing numeric fields contribute zero to these report sums. Use `get_run_usage` or `interlock usage RUN_ID` for per-metric completeness, finality, overflow handling, and attempt details.
- Top-level costs stay separated by currency. Each run, node, model, or provider breakdown has one cost amount and currency field. Use top-level currency totals when the selected data contains multiple currencies. Node and Exit group identities use node IDs across the sample, so reused IDs in different workflows can share a group.
- Exit counts describe completed runs and percentages of completed runs. Unattended completion requires completion, zero recorded human wait, and an Exit label without `escalat`, `human`, or `manual`, compared case-insensitively. Human escalation includes any run with recorded human wait or a matching Exit label. Both rates use the entire selected sample as their denominator.

`usage.byAlias` groups selected attempt snapshots by the alias ID, captured name/revision, requested candidate index/model (with profile and effort overrides), reported provider/model, and currency. Assignment creation retains the selected alias identity and claim receipts freeze it for subsequent reporting. Changing or deleting a live alias cannot rewrite these groups. Multiple roles selecting the same native model remain separate; fallback candidates and revisions also remain separate, including candidates that share a model but use different profiles or effort. Candidate indexes are zero-based in JSON and displayed starting at one in the UI/CLI. These groups are a breakdown of existing totals, never additional spend. `count` counts model observations, matching model/provider groups.

Alias metadata describes the assignment request, not proof that an executor used the requested model. Reported usage keeps its supplied model/provider. A null `alias` means attribution is unavailable, including native assignments and legacy receipts without selection evidence; reports never infer it from matching models or current aliases. Run-level observer overhead has `scope: "run"` and remains unassigned; attempt usage has `scope: "attempt"`. A pinned continuing session that bypasses candidate selection may also lack alias attribution. Missing alias groups in older report responses mean unavailable data. The CLI and Reports UI expose the same grouping.

Elapsed distributions retain existing `count`, `min`, `median`, `p90`, and `max` values as **wall time**. Each duration and wait distribution also returns `pausedMs` and `activeMs` distributions over the same observations, including empty distributions. Active time subtracts the union of applicable library and workflow pause intervals, clipped to each observation, counting overlapping holds once. Released and current holds both apply; another workflow’s holds do not. These figures describe declared pauses, not measured processor or model activity. Wait deadlines and scheduling are unchanged.

This applies to run, node, stage, admission queue, human, and claim waits. Stage and human observations sum their constituent intervals per run; they preserve existing overlap/summation rules. Human waits end at completion/release or the retained run update time, and escalation rates continue to use recorded wall-time human wait. Retry claim wait starts at the previous attempt’s end when retained, otherwise work creation. Active run and queued admission clocks share one report instant.

The CLI labels wall, active, and paused values. In Reports, **Duration basis** switches all duration and latency displays between them. Older reports without the added distributions show unavailable active/paused values rather than assuming zero pauses. JSON consumers can keep reading existing wall-time fields or use the nested distributions.

Historical data can lack execution timestamps, usage receipts, or retained version definitions. Reports resolve stage metadata and completed Exit labels from each execution’s recorded version. If that version is unavailable, the stage stays unknown and Exit labels use the execution record. Legacy executions without a version use the run version, with the current draft as a fallback when that definition is missing. These legacy labels are approximate. They do not reconstruct unavailable measurements. The sample limit bounds selected runs, not response bytes or the number of executions and receipts retained for each run.
