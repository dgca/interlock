# Usage reporting

Interlock records usage supplied by external executors or measuring observers. It does not read provider accounts, parse session logs, infer token counts from prompts, or calculate prices. Optional [run budgets](run-budgets.md) can gate new Agent claims using these reports. Reporting is optional. Missing figures appear as unknown, including for completed runs.

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

Use measured values in place of the example. Omit unavailable fields. A reported zero means the executor measured zero. Input and output counts include their cache and reasoning subsets; those subsets are not added again. When both are supplied, a subset cannot exceed its total.

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

Attribute measurements to the specific claim attempt. Do not report a shared session's lifetime totals against every assignment. Session overhead outside an attempt and run-level observer reporting are unsupported.

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

## Use the CLI

Save the report payload in a private file and submit it with:

```sh
interlock report-usage @usage.json
interlock usage RUN_ID
interlock usage RUN_ID '{"includeDescendants":true,"groupBy":"attempt","includeReports":true,"limit":20,"offset":0}'
```

The CLI uses the same request contracts as MCP. `report-usage` accepts either source's payload as one JSON argument or `@file`; `usage` accepts a run ID and optional JSON options or `@file`.

## Existing data and retention

Usage receipts use the existing `usageAttempts` document collection. Observer snapshots are separate optional fields on those receipts; no database schema migration is needed. Existing snapshots remain executor reports. Historical attempts without receipts remain unknown and cannot receive observer reports. The latest legacy attempt can report as executor if its token is still retained by the work record. Older replaced or revoked legacy tokens cannot create attribution retroactively. Claim timestamps unavailable in legacy data remain null.

Receipts survive restart, retries, and published-definition cleanup. Deleting a workflow's run history also deletes its usage receipts. Portable workflow bundles exclude usage, just as they exclude runs. Summaries bound the returned groups, not the database scan or lifetime of retained history.

## Usage in workflow comparisons

[Comparison measurements](workflow-testbench.md#compare-measurements) freeze the observed trial's run and attempt inventory. Reports read current receipts for those original attempts, including late observer reports, with an as-of time. A later explicit retry does not add its work to the original measurement. Ordinary `get_run_usage` still describes current run history, including retries; its scope can therefore differ from a frozen comparison. Missing legacy inventories and deleted receipts remain unknown.
