---
title: Reports
description: Compare run duration, reliability, and reported usage and cost.
---

# Reports

Open **Report** for a library-wide view, or a workflow's **Report** tab for that workflow. Filter by workflow, time range, or run tags to focus on the work you want to compare. Earlier `/workflows/:id/report` links open the tab.

## Check in on a workflow

The top of the report compares the selected period with the previous period of the same length:

- **Runs** started and their outcomes, and **Success rate**: completed runs as a share of completed and failed runs. Cancelled runs are excluded from the rate.
- **Median run duration** with its p90, and **Attributed spend** with how many attempts reported usage.
- Small bar charts show runs started and the median duration per interval; **Runs over time** lists the same values. **All time** has no previous period or intervals.

**Pending attention** lists active runs waiting on a person, held, stalled, or queued, longest wait first, with how long each has waited. **Recent runs** shows the newest runs with their status. Both link to the run inspector and ignore the selected period.

**Stage durations** and **Node durations** show medians and p90s with the median's change from the previous period. **Reported spend** breaks reported cost down by node, model, and stage, with the share of attempts that reported usage.

Each period covers its newest 1,000 runs. When a period has more, the report says so and its counts cover only those runs.

## Read the measurements

Reports summarize run and step durations, time waiting for agents or people, failures, lease expiries, recovery events, and stalls. Stage and outcome breakdowns help identify where work slows down or finishes.

**Duration basis** switches between wall time, paused time, and active time. Active time excludes declared library and workflow pauses. It measures elapsed time, not processor activity or time spent generating model responses.

**Permission approvals** lists, per run, how many managed Agent permission requests asked a person and how many the workflow permission policy allowed, with any policy rule a harness could not apply. It appears when a run had permission requests or a policy.

## Check usage coverage

Token and cost totals come from executor or observer reports. Interlock does not calculate provider prices or verify a bill. Missing measurements stay unknown; partial totals contain only the reported amounts. Costs in different currencies remain separate.

Check coverage alongside every cost comparison. A run with no reported cost is not evidence of a free run. Open the [run inspector](inspect-runs.md) for usage attribution and individual execution details.

Use [workflow testing](testing-workflows.md) when you need to compare versions on the same inputs.
