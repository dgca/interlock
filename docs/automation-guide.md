---
title: Automate workflows
description: Start published workflows on a schedule or after an Interlock event.
---

# Automate workflows

Automations start published workflows without a manual request. Keep the Interlock process running for them to execute.

Use a **schedule** for recurring work, such as a weekday repository review. Choose an interval or cron schedule, a timezone, and the workflow input. Decide whether overlapping runs should skip, queue, or run together. New UI schedules skip missed occurrences by default, including while Interlock is closed.

Use an **Interlock event** to respond to run transitions, such as completion, failure, or a need for attention. The target workflow receives event data and can perform follow-up work.

Manage both kinds in **Automations**. New automations can be saved disabled or enabled when created. Inspect **Activity** for occurrence and delivery outcomes, then open the linked run to see its progress and result. A started or queued run has not necessarily completed.

Build and test the target [workflow](build-workflow.md) before enabling recurring starts. If an automation pauses or work waits, inspect its warning and the run's [waiting reason](troubleshooting.md).
