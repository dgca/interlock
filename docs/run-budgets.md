---
title: Run budgets
description: Limit how many Agent claims, tokens or how much cost a run can use, and warn before expensive starts.
---

# Run budgets

A run budget limits how much Agent work a run can use: claims, tokens or reported cost. When a limit is reached, new Agent claims wait and managed sessions stop. Completed results are kept.

Use a budget to bound an agent loop or an experiment. It is a local dispatch limit, not a provider billing cap.

## Set a budget when you start a run

Save the policy in `budget.json`:

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

Then start the run with it:

```sh
interlock start WORKFLOW_ID '{}' --budget @budget.json --summary
```

This run may make 20 Agent claims, use 500,000 input and 100,000 output tokens, and spend USD 5. Cost values are millionths of the currency, so `5000000` is USD 5. Warnings appear in budget inspection at the `warnAt` values.

MCP `start_run` accepts the same `budget` and installs it together with the start. Workflow definitions and published versions do not change. The HTTP API does not accept budgets.

## Choose a scope

`scope` is required and decides which runs share the allowance:

| Scope       | Assignments counted and gated                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `run`       | This run and its continue-as-new chain members                                                               |
| `lifecycle` | Chain members and ordinary descendants, including Batch items and Parallel branches. Stops at detached runs. |
| `tree`      | Chain members and all descendants, including detached runs and their descendants                             |

Every scope includes the complete [continue-as-new chain](https://github.com/dgca/interlock/blob/main/docs/continue-as-new.md) of its run. A budget installed on a later chain member counts earlier retained claims too, so a successor never gets a fresh allowance.

Every applicable ancestor, chain-member and local budget must permit a claim. Disabling a child's budget cannot bypass an ancestor's.

A `tree` budget keeps governing detached work after the parent ends. Scope does not change cancellation: cancelling a parent still leaves detached runs running. Cancel an independent run explicitly when needed.

## What happens at the limit

- **Before a claim**: the next Agent claim waits. A maximum of zero blocks before the first claim.
- **During a managed session**: Interlock stops the session when its streamed usage, with the rest of the scope, reaches a token or cost maximum. See [Stop managed sessions at the limit](#stop-managed-sessions-at-the-limit).
- **Claim-count limits** never stop running work. They block the next claim only.

A blocked assignment appears in **Runs → Needs attention** and in MCP `workflow_requests` as **Run budget reached**, or **Run budget needs final usage** when only incomplete usage blocks it. The request names the run that holds the budget. It clears when the budget allows the claim or the run is cancelled.

The run's status does not change: a waiting run stays waiting, with `waiting.kind: "budget"`. Scripts, Fetch requests, waits and child runs continue normally. Budgets gate only Agent claims and managed Agent sessions.

While an assignment is blocked:

- Its unclaimed timeout pauses, keeping the remaining time across restarts, and resumes when every gate clears. Claimed leases of connected workers keep running.
- The manual-completion panel explains the block and hides its claim button.
- `cancel_run` and `interlock cancel` work as usual.

Agents see blocked work in briefings and continuation responses; see [manage run budgets](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#manage-run-budgets).

## Inspect and raise a budget

```sh
interlock budget RUN_ID
interlock set-budget @adjustment.json
```

MCP has the same pair: `get_run_budget` and `set_run_budget`. Reads and adjustments never call model providers.

To change a budget, send the current local revision (initially 0) and a complete replacement policy:

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

- A stale revision fails and changes nothing. Every accepted update advances the revision.
- `"budget": null` disables the local policy. Retained consumption and the revision stay.
- Raising a limit, changing `unknownUsage`, or disabling the policy resumes claims only when every governing budget permits them.
- Changing limits or scope re-evaluates retained history. It never starts a fresh allowance.

Do not raise or disable a budget just to keep an agent running. Follow the user's spending and execution limits.

## Stop managed sessions at the limit

[Managed executors](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md) stream usage while an attempt runs. When that usage crosses a token or cost maximum, Interlock stops the session and releases the claim.

| Harness                                  | When it stops                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Claude Code                              | Mid-turn, after the model response that crossed the limit. Its process is stopped.                        |
| Codex                                    | Mid-turn, after the token usage update that crossed the limit. The turn is interrupted.                   |
| Pi                                       | Mid-turn, after the assistant message that crossed the limit. Its process is stopped.                     |
| Custom command profiles                  | At the end of the attempt. They report usage only with their result, so the budget blocks the next claim. |
| Connected executors and custom launchers | At the next claim. Interlock does not own their sessions; usage they report counts immediately.           |

After a stop:

1. The attempt keeps the usage streamed so far and ends as `held`. The executor view shows **Stopped at budget**.
2. The stop does not use up the Agent's failure allowance. It appears in the assignment's hold history with actor `managed-budget`.
3. The run waits. Its message names the limit reached and the run that holds the budget, with its title if it has one. Costs show up to four decimal places.
4. When you raise the limit or disable the budget, the managed executor claims the assignment again and resumes the stopped native session. Completed steps and the session's work are kept.

If the harness returns its result before it stops, the result is kept and the run continues. The next Agent claim is then blocked.

A budget stop releases only managed attempts whose own run is in the budget's scope. Other in-flight attempts in the scope stop at their next usage update.

## Handle incomplete usage

`unknownUsage` decides what happens when usage reports are missing. It is optional and defaults to `allow`.

| Value   | Behavior                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow` | Claims proceed while reported totals are below the maximums. Incomplete telemetry shows as a warning. A claim limit can still bound the work. |
| `block` | Claims stop while any attempt or run-level observer stream in scope lacks final figures for a limited metric.                                 |

With `block`, a final report that omits a metric still leaves that metric unknown. A scope with no attempts or run streams has zero consumption, so its first claim can proceed.

To clear a `usage_incomplete` block, either:

- report final figures for the incomplete attempt, as an observer once it has ended; or
- change the budget to `"unknownUsage": "allow"`.

A strict policy can serialize claims until each worker supplies final usage. If an interrupted worker cannot report, inspect the remaining uncertainty and adjust the policy within the user's authorized budget.

### Usage after a managed stop

A stopped attempt's usage stays non-final, because the interrupted model call is never reported. With `unknownUsage: "block"`, the budget therefore also reports `usage_incomplete`, and raising the limit alone does not resume the assignment. The waiting reason says so: report final figures for the stopped attempt as an observer, or set `unknownUsage` to `allow`.

## Warn before large runs

A start warning asks before starting a workflow whose recent runs were expensive. Set a library threshold, here USD 2:

```sh
interlock prices start-warning '{"threshold":{"currency":"USD","amountMicros":2000000}}'
interlock prices start-warning
interlock prices start-warning '{"threshold":null}'
```

The second command reads the setting; the third turns it off. Without a threshold nothing is computed, and no caller sees a prompt or a new field.

| Caller                                    | Behavior                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| UI **Start run**                          | When the median is above the threshold, the dialog states the median, the sample size and the threshold, and the button reads **Start anyway**. |
| CLI `start`, MCP `start_run`, HTTP `/api` | The start response includes `costProjection`. The start is never refused.                                                                       |
| Schedules and event triggers              | They start without asking. Above the threshold, the run records a `run.cost_warning` event saying it started without confirmation.              |

The warning is advisory. To limit spending, set a [run budget](#set-a-budget-when-you-start-a-run).

## Budget comparison work separately

Comparison roots are independent runs, so they do not inherit the budget of an agent that starts the comparison. Use the comparison's `sampleBudget` instead: it installs a `tree` budget on every root before its work becomes eligible.

Each root has its own allowance, shared with its descendants. Multiply it by the maximum root count when planning an experiment, and budget proposal, coordination and grading separately. See [comparison budgets](https://github.com/dgca/interlock/blob/main/docs/workflow-testbench.md#budget-independent-samples) and the [bounded improvement starter](https://github.com/dgca/interlock/blob/main/docs/workflow-improvement.md).

## Reference

### Limits and values

- Choose at least one limit: `claims`, `inputTokens`, `outputTokens` or `cost`.
- Each maximum and warning threshold is a nonnegative safe integer. A warning threshold cannot exceed its maximum.
- Reaching a maximum blocks the next claim. Warnings are advisory.
- `cost.currency` is a three-letter uppercase code. Budgets never convert currencies; cost in another currency stays unavailable for the configured one.
- Token and cost limits can overshoot by up to one model turn for managed executors, and further for connected workers that report late or continue work already in flight. Claim-count limits are exact.

### What counts

- Every successful claim counts: failed work, lease expiries, claims released by external holds, and explicit retries. Failed claim requests consume nothing.
- Counters include retained history from before the policy was installed.
- A reported cost counts as reported. Tokens reported without a cost count at the price [derived from the run's captured price table](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md#derived-cost).
- A model with no price contributes nothing. The cost check then has `partial` coverage, and its `pricing` field names the unpriced models. Budgets never guess a price.
- Partial sums that reach a maximum block under either `unknownUsage` policy. A total that overflows blocks instead of rounding down.
- Within one source, a final cumulative report can clear an incomplete-usage block automatically. It cannot lower consumption below a reached maximum.
- Executors and observers must report actual measurements with [usage reporting](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md).

### Which usage counts

Budgets count usage the same way as usage totals: an observer report takes precedence over the executor's for an attempt, and run-level observer streams add to the scope. While a managed attempt runs, its streamed usage counts in budget checks. See [source selection and run-level reporting](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md#report-measured-usage-as-an-observer) and [streamed usage from managed sessions](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md#streamed-usage-from-managed-sessions).

### Budget inspection

The response of `interlock budget` and `get_run_budget` contains:

- the local `revision` and `budget`;
- `governing` policies, with scope counts, attempt and in-flight counts, and checks.

Each check has its metric, maximum, optional warning threshold, reported value, coverage, overflow, blocking `reasons` and `warnings`.

| Field      | Values                                  |
| ---------- | --------------------------------------- |
| State      | `ready`, `warning`, `blocked`           |
| `reasons`  | `limit_reached`, `usage_incomplete`     |
| `warnings` | `warning_threshold`, `usage_incomplete` |

Inspection covers only this run's policy and its applicable ancestors, not policies on its descendants. Run briefings identify blocked descendant assignments and the runs that hold their budgets. Inspection returns no prompts, results or claim credentials. Its record count is bounded by the engine's ancestry depth, but aggregation still scans scoped history.

### Start warning projection

- The projection is the median cost of the workflow's 20 most recent completed top-level runs, each with its ordinary descendants (the `lifecycle` scope), in the threshold's currency.
- Costs include [derived costs](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md#derived-cost).
- A run with no Agent attempts or usage reports counts as zero. A run with some usage whose cost is not completely known, because usage was unreported or unpriced, is left out.
- With fewer than three usable runs there is no projection.
- `costProjection` has `currency`, `medianMicros`, `sampleSize` (how many runs the median uses), `thresholdMicros` and `exceedsThreshold`.

### Interfaces

| Task                | CLI                              | MCP                  | Shared API                                                          |
| ------------------- | -------------------------------- | -------------------- | ------------------------------------------------------------------- |
| Start with a budget | `interlock start ... --budget`   | `start_run` `budget` | `runs.start`, `runs.startSummary`                                   |
| Inspect             | `interlock budget RUN_ID`        | `get_run_budget`     | `runs.budget`                                                       |
| Adjust or disable   | `interlock set-budget`           | `set_run_budget`     | `runs.setBudget`                                                    |
| Start warning       | `interlock prices start-warning` |                      | `prices.startWarning`, `prices.setStartWarning`, `prices.startCost` |

`--budget` accepts JSON or `@file`; omitting it keeps the usual start behavior. `set-budget` accepts the same payload as MCP.

### Persistence

- Policies and consumption survive restart and retry. Deleting a run's history removes its policies too.
- Portable workflow bundles do not include run budgets.
- Runs started before budgets existed behave as before. Their attempts count toward claim limits, and their unavailable usage stays unknown.
- Budgets describe local dispatch policy, not an authorization boundary or an account balance.
- [External holds](https://github.com/dgca/interlock/blob/main/docs/work-holds.md) are separate from budget gates. Resuming never resets usage or changes a governing policy. Held attempts can still report usage with their retained attempt token, without regaining claim authority.
