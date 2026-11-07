# Schedule UI design context

UI design run `e45a3f5d-2885-4e7c-8754-8361ccca722b`, published UI design v2. Requested task root is `.tasks/issue-236`; this invocation owns its `ui/` subdirectory. There is no existing schedule UI baseline. This is an addition within the current product, not a visual redesign.

## Scope and authority

Design workflow schedule CRUD, enable/disable/delete, interval and cron timing, input template and fire bindings, overlap and missed-fire policies, optional failure pause, inspection, and schedule attention. Live issue #236 and parent #223 were fetched on 2026-11-07. Their complete text is retained in this run input. `source-snapshot.json` records current checkout HEAD and target fingerprints. Production tree was clean before artifacts.

The user explicitly said, "I can do a design review at the end as well. No need to pause on those." `reviewPolicy` is `auto`. This authorizes design choices and continuation; it is not human approval of a rendered proposal. No current screenshot has received human approval. Parent will arrange implementation and independent reviews. This task does not implement production features or commit, push, publish, or merge.

## Product references

Read `AGENTS.md`, `CONTEXT.md`, UI and pause/admission sections of `docs/architecture.md`, `docs/ui-patterns.md`, and `PRODUCT.md`. Preserve the dark Mantine palette, Sidebar, workflow header/subnavigation, shared Modal layout, JSON editor, and explicit pause-hold controls. Main references are `packages/ui/src/features/workflows/WorkflowEditor.tsx`, `packages/ui/src/features/pauses/PauseControls.tsx`, `packages/ui/src/features/runs/RunList.tsx`, `packages/ui/src/components/JsonEditor/JsonEditor.tsx`, and `packages/ui/src/theme/theme.ts`.

Impeccable context loaded once. This is Operate mode. The workflow explicitly requires a rendered fixture prototype, overriding shape's planning-only stopping point. The supplied brief and current authorization resolve scope and visual authority, so the subagent substitutes the detailed parent brief for a new user interview. Writing is checked with unslop. Browser interaction uses the Playwright CLI.

## Allowed work and evidence

Only files under `.tasks/issue-236/ui/`. A fixture-only Vite preview may import existing components and theme without changing them. No production API or scheduler is called, and no database is needed. Fixture times and status are labeled in a separate prototype-only control panel. Browser session and server are isolated and stopped after captures. There is no supplied running URL; the preview's source is verified by explicit Vite root and imports from this worktree. No claim is made about the user's running engine. Viewports are 1440, 900, and 390 pixels.

## Settled direction

Schedules are immediately persisted operational records, separate from workflow draft save and publication. Add a Schedules workflow tab. Inspection and recent fires precede editing. Settings use the established modal with local edits and an explicit Save action. Start disabled by default. Explain the published target and require a published version before enable. Local library/workflow pause holds are distinct from a schedule's enabled state and auto-pause. Keep one exact schedule action per mutation and never imply releasing one hold clears all holds.
