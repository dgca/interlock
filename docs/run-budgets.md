# Run budgets

An optional run budget gates new Agent claims. It preserves completed results and lets already claimed work renew, report usage, and finish. A claim-count limit is deterministic. Reported token and cost limits can overshoot because workers report late or continue work already in flight. They are not provider billing caps.

## Configure a budget

Pass `budget` to `runs.start`, `runs.startSummary`, or MCP `start_run` to configure the gate atomically with startup. For an existing run, use `runs.setBudget` or MCP `set_run_budget`. Workflow definitions and published versions are unchanged.

```json
{
  "scope": "lifecycle",
  "unknownUsage": "allow",
  "limits": {
    "claims": { "max": 20, "warnAt": 15 },
    "inputTokens": { "max": 500000, "warnAt": 400000 },
    "outputTokens": { "max": 100000 },
    "cost": {
      "currency": "USD",
      "threshold": { "max": 5000000, "warnAt": 4000000 }
    }
  }
}
```

Choose at least one limit. Each maximum and warning threshold is a nonnegative safe integer. A warning threshold cannot exceed its maximum. Reaching a maximum blocks the next claim; zero blocks before the first claim. Warnings are advisory and appear in budget inspection. Cost values are millionths of the stated three-letter uppercase currency, so the example cost maximum is USD 5. Interlock does not calculate prices or convert currencies.

`scope` is required:

| Scope       | Assignments counted and gated                                                             |
| ----------- | ----------------------------------------------------------------------------------------- |
| `run`       | This run only                                                                             |
| `lifecycle` | This run and ordinary descendants, including Batch items; stop at every detached boundary |
| `tree`      | This run and all descendants, including detached runs and their descendants               |

Every applicable ancestor and local budget must permit a claim. Disabling a child budget cannot bypass an ancestor's gate. A tree budget continues to govern detached work after the parent ends. Scope does not change cancellation: cancelling a parent still preserves detached runs. Cancel an independent run explicitly when needed.

All successful claims count, including failed work, lease expiries, claims released by external holds, and explicit retries. Counters include retained history from before the policy was installed. Changing limits or scope re-evaluates that history; it never starts a fresh allowance. Failed claim requests consume nothing.

## Handle incomplete reports

`unknownUsage` is required, even for a claim-only policy:

- `allow` admits claims below the reported thresholds and exposes incomplete telemetry as a warning. A claim-count limit can bound reservations when telemetry is unavailable.
- `block` stops further claims while any scoped attempt lacks final figures for a configured reported metric. A final report with an omitted metric still leaves that metric unknown. A scope with no attempts has zero consumption, so its first claim can proceed if its maxima permit it.

Partial sums reaching a maximum block under either policy. Aggregate overflow blocks instead of rounding down. Cost in a different currency remains unavailable for the configured currency. Within one source, a final cumulative report can clear an incomplete-usage block automatically, but cannot lower consumption below a reached maximum. Executors or observers must report actual measurements using [usage reporting](usage-reporting.md).

Totals and budget checks select the observer snapshot when present, otherwise the executor snapshot, once per attempt. Source snapshots are never added or merged. An observer can report only after the attempt ends; late reports can raise or lower selected consumption and change admission. See [source selection](usage-reporting.md#report-measured-usage-as-an-observer).

A strict reported-usage policy can serialize claims until each worker supplies final usage. If an interrupted worker cannot report, inspect the remaining uncertainty and explicitly adjust the policy within the user's authorized budget.

## Inspect, adjust, and resume

Use `runs.budget`, MCP `get_run_budget`, or `interlock budget RUN_ID`. The response contains the local `revision` and `budget`, plus `governing` policies with scope counts, attempt/in-flight counts, and checks. Each check includes its metric, maximum, optional warning threshold, reported value, coverage, overflow, blocking `reasons`, and `warnings`. State is `ready`, `warning`, or `blocked`. Reasons are `limit_reached` or `usage_incomplete`; warnings are `warning_threshold` or `usage_incomplete`.

Inspection includes only this run's policy and applicable ancestors, not every policy in its descendants. Run briefings identify blocked descendant assignments and their governing budget run IDs. Budget inspection returns no prompts, results, or claim credentials. Its record count is bounded by the engine's ancestry depth; aggregation still scans scoped history.

To adjust, supply the current local revision, initially zero, and a complete replacement policy:

```json
{
  "runId": "RUN_ID",
  "expectedRevision": 1,
  "budget": {
    "scope": "lifecycle",
    "unknownUsage": "allow",
    "limits": { "claims": { "max": 30 } }
  }
}
```

A stale revision fails without changing the policy. Every accepted update advances the revision. To disable the local policy, supply `budget:null` with the current revision. Retained consumption and the revision remain intact. Raising a limit, changing the unknown-usage policy, or disabling a policy resumes claims only when every governing budget permits them. Do not raise or disable a budget merely to keep an agent running; follow the user's spending and execution constraints.

Budget blocking is separate from run status. A waiting run remains waiting. Discovery and continuation next-work lists omit blocked assignments. Briefings expose `budgetBlocked` and `budget_blocked` blockers; mutation summaries include bounded `budgetBlocked` references when needed and use `next:adjust_budget`. MCP suggests a read-only briefing for that next action. Full inspection retains the assignment with its `budgetBlocked` marker. The manual-completion panel explains the block and hides its claim button.

Unclaimed Agent timeouts pause while budget-blocked, preserving their remaining duration across restart. They resume when all gates clear. Claimed leases keep running. Scripts, Fetch requests, waits, and child creation continue normally; this feature gates Agent reservations only. Existing `cancel_run` and `interlock cancel` retain their normal behavior.

## CLI

Save the policy in `budget.json` and an adjustment payload in `adjustment.json`:

```sh
interlock start WORKFLOW_ID '{}' --budget @budget.json --summary
interlock budget RUN_ID
interlock set-budget @adjustment.json
interlock cancel RUN_ID
```

`--budget` accepts JSON or `@file`; omitting it keeps existing startup behavior. `set-budget` accepts the same payload as MCP. Budget reads and adjustments do not call model providers.

## Storage and compatibility

Policies use the additive `runBudgets` document collection; blocked assignments use an optional `budgetBlocked` field. A run records its local `budgetRevision` so policy changes advance continuation cursors. No database schema migration is needed. Old runs without policies retain their behavior. Legacy attempts count toward claim limits, while unavailable historical usage stays unknown. Policies and consumption survive restart and retry; deleting their run history removes the policies too. Portable workflow bundles exclude run budgets.

Reported usage that changes admission updates assignment markers and continuation cursors. Usage-only updates without an admission change retain the existing cursor behavior. Budget adjustments also wake continuation readers. Budget records describe local dispatch policy, not an authorization boundary or account balance.

[External holds](work-holds.md) are separate from budget gates. Resume never resets usage or changes a governing policy. Held attempts may still report usage with their retained attempt token, without restoring claim authority.
