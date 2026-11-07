# Intent: M6: Optional prompt pinning at publish & CLI bundle sync

## Baseline Information
- **Task Branch**: `feat/issue-245`
- **Base Commit**: `8c720e70838847999fa3036a27b0a1c4c2c7d975`
- **Issue**: dgca/interlock#245
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-245`

## Problem Statement
Deploying workflow changes across environments currently risks prompt/workflow version skew or accidental overwrites during multi-file updates:
1. **Prompt/Workflow Version Skew**: Currently, runs capture the latest saved prompt revisions at start time. If a workflow was published and validated against a specific prompt text, subsequent edits to the saved prompt can change the prompt used by runs of that published workflow version unless prompt pinning is opted into.
2. **Missing Diff Previews During CLI Import**: `interlock import` lacks a `--dry-run` mode to preview semantic differences against currently published definitions (ignoring diagram layout and property key order) before making changes.
3. **Multi-File / Multi-Workflow Deployment Synchronization**: Deploying workflows across environments via bundle import lacks an atomic/transactional publish capability (`--publish --cascade`) to ensure that imported workflows and their dependencies or bundle items are published safely together.

## Desired Outcome
1. **Opt-in Prompt Pinning at Publish Time**:
   - Add `pinPromptsAtPublish: boolean` (optional, default `false`) to `WorkflowDefinition`.
   - When enabled, publishing a workflow version captures and stores the exact current `revision` of all referenced saved prompts in the immutable `WorkflowVersion` (e.g., `pinnedPromptRevisions?: Record<string, number>`).
   - At run startup, if a workflow version has pinned prompt revisions, the run captures those exact pinned prompt revisions instead of floating to the latest saved revisions.
2. **Semantic Dry-Run for CLI Bundle Import**:
   - Add `--dry-run` to `interlock import`.
   - Compares bundle definitions semantically against existing published definitions, ignoring visual layout coordinates/positions (`layout`, `position`, etc.) and object key ordering.
   - Outputs a readable summary/diff of changes without mutating database state.
3. **Atomic / Cascade Publishing on CLI Import**:
   - Add `--publish` and `--cascade` flags to `interlock import`.
   - Allows importing workflows and publishing them (and their dependencies) in a single transactional / cascade operation.
4. **Testing, Documentation & Changeset**:
   - Comprehensive unit and integration tests covering prompt revision pinning, semantic dry-run diffs, and cascade publishing via CLI.
   - Documentation updates in `docs/prompts.md`, `docs/architecture.md`, `docs/v1.md`, and `README.md`.
   - A patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Authors and Operators**: Gain control over prompt pinning and safe GitOps-style deployment using the CLI.
- **`packages/core`**: Type definitions for `WorkflowDefinition` (adding `pinPromptsAtPublish?: boolean`) and `WorkflowVersion` (adding `pinnedPromptRevisions?: Record<string, number>`), plus schema validation.
- **`packages/runtime`**: Workflow publication logic and run startup prompt capture (`prompts.ts` / `runStarts.ts`) to honor pinned revisions.
- **`packages/server`**: Bundle import/export endpoints, semantic diff logic, and cascade publish orchestration.
- **`packages/cli`**: `interlock import` options (`--dry-run`, `--publish`, `--cascade`).

## Settled Decisions
- `pinPromptsAtPublish` is opt-in and defaults to `false` for backwards compatibility.
- Pinned prompt revisions are recorded immutably in the published `WorkflowVersion`.
- Semantic diffs ignore layout metadata (`layout`, node x/y coordinates) and key order.
- Changeset will be a `patch` release for `@type_of/interlock`.

## Open Questions
- None.
