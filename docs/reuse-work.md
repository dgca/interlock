---
title: Reuse work
description: Start from existing procedures and share workflows, prompts, and configuration.
---

# Reuse work

Keep repeated procedures and instructions in one place so you can use them across workflows.

## Start with a workflow

The starter picker offers published procedures you can add to your library. The **SDLC workflow** plans, implements, and reviews a software change. Imported starters become your own copies. Adding one does not start a run or replace an existing workflow.

Use a **Workflow** step to invoke a published procedure from another workflow. For example, several procedures can share a review workflow instead of maintaining separate copies of its steps. Choose whether the caller waits for its result or starts it independently.

## Share instructions

Saved **Prompts** hold instructions that Agent steps can reuse. Keep shared review criteria in a saved prompt and describe the specific assignment on each step.

Runs capture the prompt revisions they use. Editing a prompt can update future runs without changing the instructions already captured by active runs. Published workflows can also pin prompt revisions.

## Reuse configuration and secrets

**Variables** hold reusable configuration values and credentials. Reference them explicitly in Script environments or Fetch headers. Agents do not receive saved variables automatically.

Use **Secret** for credentials. Stored secret values have no read-back action, so rotate them by replacing the value. Keep credentials out of prompts, workflow inputs, and returned results.

Continue with [Build workflows](build-workflow.md) or [Run agents](agents.md).
