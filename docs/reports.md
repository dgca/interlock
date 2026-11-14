---
title: Reports
description: Compare run duration, reliability, and reported usage and cost.
---

# Reports

Reports show how long runs take, how often they succeed, and what they cost, compared with the period before. Use them to check in on a workflow or to find where work slows down.

Open **Report** in the sidebar for the whole library, or a workflow's **Report** tab for one workflow. Both show the same page: a dashboard at the top, then detailed measurements below it. Earlier `/workflows/:id/report` links open the tab.

## Choose what to compare

Use the controls at the top of the page:

- The workflow filter (library report only) to focus on one workflow.
- The time range: **Past 24 hours**, **Past 7 days**, **Past 30 days** or **All time**.
- Run tags, to compare a subset of runs.
- **Duration basis**: **Wall time**, **Active time** or **Paused time**. Active time excludes declared library and workflow pauses. It measures elapsed time, not processor activity or time spent generating model responses.

## Read the dashboard

The dashboard compares the selected period with the previous period of the same length.

| Figure                  | What it shows                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **Runs**                | Runs started and their outcomes.                                                                    |
| **Success rate**        | Completed runs as a share of completed and failed runs. Cancelled runs are left out.                |
| **Median run duration** | The median, with its p90.                                                                           |
| **Attributed spend**    | Reported spend, with how many attempts reported usage.                                              |
| Bar charts              | Runs started and median duration per interval. **Runs over time** lists the same values as a table. |
| **Pending attention**   | Runs that need attention, plus held and queued runs, longest wait first, with how long each waited. |
| **Recent runs**         | The newest runs with their status.                                                                  |
| **Stage durations**     | Median and p90 per stage, with the median's change from the previous period.                        |
| **Node durations**      | Median and p90 per step, with the median's change from the previous period.                         |
| **Reported spend**      | Reported cost by node, model and stage, with the share of attempts that reported usage.             |

**Pending attention** shows the same runs as the **Needs attention** tab in **Runs**, including stalled work. It and **Recent runs** ignore the selected period, and both link to the run inspector.

**All time** has no previous period and no intervals, so it shows no changes or bar charts.

## Read the detailed measurements

Below the dashboard, the report breaks the period down further. Run and step durations include time spent waiting for agents or people.

- **Claim Latency**: how long Agent assignments waited between becoming available and being claimed, for new and continuing sessions, and the total claim attempts.
- **Execution Reliability & Recoveries**: failures, lease expiries, recovery events and stalls.
- **Terminal Outcomes by Exit Node**: where runs finished.
- **Model Usage & Spend Attribution**: tokens and cost by model, with any captured model aliases.
- **Permission approvals**: per run, how many managed Agent permission requests asked a person and how many the workflow [permission policy](permission-policy.md) allowed, with any policy rule a harness could not apply. It appears when a run had permission requests or a policy.

## Check usage coverage

Token and cost totals come from what executors and observers report. Interlock does not calculate provider prices or verify a bill.

- Missing measurements stay unknown. Partial totals contain only the reported amounts.
- Costs in different currencies stay separate.
- A run with no reported cost is not evidence that it was free.

Check coverage next to every cost comparison. Open the [run inspector](inspect-runs.md) for usage attribution and individual executions. To compare versions on the same inputs, use [workflow testing](testing-workflows.md).

## Limits

- Run counts and the success rate are exact.
- Durations, spend and outcomes use each period's newest 1,000 runs. When a period has more, the report says so and shows how many runs it read. It then hides changes and trends for the sampled figures. Choose a shorter period for complete figures.
- A spend change appears only when both periods' usage coverage is within 10 percentage points. Otherwise both coverages are shown.
- Parallel branch runs cancelled because their group's join was satisfied are not counted as runs or outcomes. Their usage still counts.
