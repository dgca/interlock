# Reusable prompts

## Source and authorization

On October 6, 2026, the user proposed reusable instructions for Agent nodes, chose the name Prompts, and requested a sidebar library with creation and editing plus optional selection of one or more prompts in the Agent form. The user explicitly chose central updates: "editing should improve the prompt everywhere."

The user then requested: "Great, can you use the SDLC workflow to build this?" This task uses published SDLC workflow version 2, run `e42e9590-fc61-46cc-b4eb-608f481acd0e`, in `/Users/dan/dev/interlock`. Artifacts live in `.tasks/reusable-prompts/`. Review policy is auto with human decisions at unresolved review steps. Delivery is local; no PR was requested.

## Problem and outcome

Authors currently repeat instructions across Agent nodes and workflows. They need one place to maintain shared guidance and attach it to different tasks. Editing that guidance should improve subsequent executions everywhere it is referenced, including published workflows.

Authors and executors must still be able to inspect the instructions used by an earlier run after the library changes. Existing runs should keep consistent instructions while work progresses or retries.

## Users and scope

Workflow authors create and maintain saved prompts, attach them to Agent nodes, and inspect the assembled instructions. Connected agents receive the saved guidance together with each node's task. Run inspectors can identify the exact guidance used. Portable workflow bundles must carry the prompts their definitions reference.

The first version provides plain Markdown guidance with names and optional descriptions. It includes shared-server access for the UI and agent callers, prompt references in workflow authoring, runtime capture, and inspection. Pinning, variables, attachments, conditional loading, external skill packages, and direct model or session execution are outside scope.

## Settled decisions

- D1: The library is named Prompts. Source: the user's "I like prompts, let's go with that."
- D2: The UI has a Prompts sidebar item and optional selection of multiple saved prompts in the Agent form. Source: the user's UI proposal, followed by agreement to build.
- D3: Updates affect future runs of published workflows without republishing. Source: the user's explicit central-update preference.
- D4: A run captures prompt content at startup and retains it through steps, Batch items, and retries. Exact content and revision remain inspectable. Source: the proposed run behavior immediately preceding the user's "Great" and build request.
- D5: Saved prompts supplement node task instructions. They do not grant capabilities or control an external agent's system prompt. Existing context policy retains its meaning. Source: the feature discussion and current execution contract.
- D6: The author can order selected prompts, inspect them, and preview the assembled instructions. Source: the proposed Agent form behavior preceding the build request.

## Constraints

Keep execution in runtime, contracts and graph validation in core, persistence in storage, and UI, CLI, and MCP on the shared server interface. Preserve existing definitions, immutable published graphs, user data, current and fresh context, and JavaScript versus legacy Bash execution.

Use temporary databases for checks. Follow repository requirements for affected documentation, complete affected MCP flows and both transports, a pending patch changeset, relevant tests, build, formatting, and package verification where packaging changes.

Preserve the existing unrelated untracked `docs/research/` files. The workflow's accepted planning stages may commit their artifacts to a task branch. Implementation begins only after the plan can proceed.

## Outcome-level success

An author can maintain shared instructions once, use them in several Agent tasks, and have improvements apply to subsequent runs. Executors and inspectors can see what instructions a run actually received. Existing workflows remain usable without adopting the feature.

## Open questions

No unresolved intent questions. Prompt retirement and snapshot behavior across separately invoked workflows require specification before implementation. Detailed behavior and acceptance criteria belong in [spec.md](spec.md); implementation and verification belong in [plan.md](plan.md).
