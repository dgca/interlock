# UI design context

Run 7eaea61e-5b68-4d61-ad34-c97b37785cae, published UI design v2. Checkout /Users/dan/dev/interlock-worktrees/issue-230, branch feat/issue-230, HEAD 8e7ac9fb51bcdbbb82c622233e9f327d1f2ab84a. Initial source tree clean. See source-snapshot.json for target fingerprints.

## Scope

Library and workflow execution pause controls, active hold reasons, exact-ID release and run waiting projections for GitHub issue [230](https://github.com/dgca/interlock/issues/230), under parent [223](https://github.com/dgca/interlock/issues/223). Multiple independent holds accumulate. New claims/launches and step advancement stop at boundaries; in-flight steps finish. Input revisions, reads, cancellation and cleanup remain usable. Parent's schedules, webhooks, doctor and retry/stall systems are not UI implementation scope while unavailable.

## Decisions and authorization

The user's exact superseding authorization, relayed by coordinating parent: "I can do a design review at the end as well. No need to pause on those." Existing reviewPolicy auto applies. The user also authorizes autonomous merges after review/CI, with no release. This design invocation will not implement feature source, push, merge, publish, or release. This authorization permits choosing a proposal within the issue and repo conventions. It is not actual human approval of the rendered proposal. decisionSource is existing_authorization and humanResponse stays empty.

## References and constraints

Read AGENTS.md, CONTEXT.md, docs/architecture.md, PRODUCT.md and current issue/parent from live GitHub. Preserve Mantine dark theme, restrained amber paused state, existing Sidebar, page headers and modal layout. Sources: packages/ui/src/App.tsx, theme/theme.ts, components/Sidebar, WorkflowLibrary, WorkflowEditor, RunInspector and runProjectionText. Operate mode. Hindsight recalls purposeful Mantine UI and autonomous progress when decisions are settled; current user instructions take precedence.

Impeccable context launcher ran once. Existing product guidance is in PRODUCT.md; no DESIGN.md present. No design-system repair in scope. Use impeccable, unslop and playwright-cli. Prototype and evidence writes stay in .tasks/issue-230/ui. No production source writes. Source snapshot is independent from generated task evidence.

No external URL supplied. Start only task-owned servers with isolated fixture data. Baseline will import actual current UI components in fixture mode, using a dedicated temporary database/server where API reads are needed; never use real .interlock data. Rendered evidence names source snapshot and viewports. Baseline does not implement pause state; matched proposal states disclose their additions.

