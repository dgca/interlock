---
title: Reports
description: Compare run duration, reliability, and reported usage and cost.
---

# Reports

Open **Report** for a library-wide view, or choose **Workflow actions → Performance & cost report** in a workflow's editor. Filter by workflow, time range, or run tags to focus on the work you want to compare.

## Read the measurements

Reports summarize run and step durations, time waiting for agents or people, failures, lease expiries, recovery events, and stalls. Stage and outcome breakdowns help identify where work slows down or finishes.

**Duration basis** switches between wall time, paused time, and active time. Active time excludes declared library and workflow pauses. It measures elapsed time, not processor activity or time spent generating model responses.

**Permission approvals** lists, per run, how many managed Agent permission requests asked a person and how many the workflow permission policy allowed, with any policy rule a harness could not apply. It appears when a run had permission requests or a policy.

## Check usage coverage

Token and cost totals come from executor or observer reports. Interlock does not calculate provider prices or verify a bill. Missing measurements stay unknown; partial totals contain only the reported amounts. Costs in different currencies remain separate.

Check coverage alongside every cost comparison. A run with no reported cost is not evidence of a free run. Open the [run inspector](inspect-runs.md) for usage attribution and individual execution details.

Use [workflow testing](testing-workflows.md) when you need to compare versions on the same inputs.
