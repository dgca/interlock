# Implementation Plan: M6: Optional prompt pinning at publish & CLI bundle sync

## Overview and Reference
This document plans the implementation and verification of opt-in prompt pinning at publish time and CLI bundle import with dry-run semantic diffs and transactional cascade publication.
For acceptance criteria, refer to [spec.md](spec.md); for problem and scope, refer to [intent.md](intent.md).

## Intended Code Areas

### 1. `packages/core` (Maps to AC1, AC2, AC3)
- `packages/core/src/index.ts`:
  - Add `pinPromptsAtPublish: z.boolean().optional()` to `definitionSchema`.
  - Add `pinnedPromptRevisions?: Record<string, number>` to `WorkflowVersion`.
- `packages/core/src/transfer.ts`:
  - Update `workflowBundleSchema` to allow `pinnedPromptRevisions: z.record(z.string(), z.number().int().positive()).optional()` on each version in `versions`.
- `packages/core/src/workflowDiff.ts`:
  - Provide reusable semantic comparison utilities (`diffWorkflowDefinitions`, `compareWorkflow`) that compare definitions ignoring node positions (`layout`) and object key ordering.

### 2. `packages/runtime` (Maps to AC1, AC2, AC3, AC4)
- `packages/runtime/src/prompts.ts`:
  - Ensure `Prompts.capture(definition, pinnedRevisions?)` supports fetching prompt snapshots for specific pinned revisions if supplied.
- `packages/runtime/src/index.ts`:
  - In `publishVersion(id)`: if `definition.pinPromptsAtPublish` is true, map referenced prompt IDs to their current revisions: `pinnedPromptRevisions = Object.fromEntries(promptIds(definition).map(id => [id, this.prompts.get(id).revision]))`, and store on the `WorkflowVersion`.
  - In `newRun(...)`: fetch the `WorkflowVersion`; if it has `pinnedPromptRevisions`, capture prompt snapshots using those exact revisions instead of floating to latest.
- `packages/runtime/src/transfer.ts`:
  - Include `pinnedPromptRevisions` when exporting workflow versions in `exportWorkflows`.
  - Persist `pinnedPromptRevisions` when importing workflow versions in `importWorkflows`.
  - Add `publish?: boolean` and `cascade?: boolean` to `importWorkflows` options: if `publish: true`, execute publication across imported workflows inside the same transaction.
  - Add `diffBundleImport` / semantic dry-run support: inspect incoming bundle against existing store workflows and versions, returning a semantic diff report without mutating the store.

### 3. `packages/server` (Maps to AC3, AC4)
- `packages/server/src/router.ts`:
  - Extend `workflows.import` input schema with `dryRun: z.boolean().optional()`, `publish: z.boolean().optional()`, `cascade: z.boolean().optional()`.
  - In `workflows.import` mutation:
    - If `input.dryRun` is true, invoke dry-run comparison and return the diff result.
    - Otherwise invoke `importWorkflows` with options (`publish`, `cascade`, etc.).

### 4. `packages/cli` (Maps to AC3, AC4)
- `packages/cli/src/commands.ts`:
  - Parse `--dry-run`, `--publish`, and `--cascade` flags for `import` command.
  - Pass options to `client.workflows.import.mutate`.
  - Return formatted diff report on dry-run or import results.
- `packages/cli/src/bin.ts`:
  - Update command help text for `import`.

### 5. Documentation, Tests & Release (Maps to AC5)
- Update `docs/prompts.md`, `docs/architecture.md`, `docs/v1.md`, `README.md`.
- Add patch changeset for `@type_of/interlock`.

## Implementation Sequence

1. **Core Schemas & Diff Utilities**:
   - Add `pinPromptsAtPublish` to `definitionSchema`.
   - Add `pinnedPromptRevisions` to `WorkflowVersion` and `workflowBundleSchema`.
   - Expose semantic workflow comparison in `packages/core`.

2. **Publish Pinning & Run Startup Prompt Capture**:
   - Update `packages/runtime/src/index.ts` to pin prompt revisions at publish when `pinPromptsAtPublish: true`.
   - Update `newRun` to capture pinned prompt revisions when starting runs of a pinned workflow version.

3. **Bundle Import Dry-Run & Atomic / Cascade Publication**:
   - Implement bundle dry-run comparison against published definitions in `packages/runtime/src/transfer.ts`.
   - Implement transactional import + publication (`--publish [--cascade]`) in `importWorkflows`.
   - Wire options into `packages/server/src/router.ts` and `packages/cli/src/commands.ts`.

4. **Testing & Verification**:
   - Test prompt pinning at publish time and run startup capture (verifying that edits to prompts do not change runs of pinned versions).
   - Test `interlock import --dry-run` verifying semantic diff output and no database mutations.
   - Test `interlock import --publish --cascade` verifying atomic publication in topological order.
   - Run full workspace tests, build, and format check.

5. **Documentation & Changeset**:
   - Update docs and create changeset.

## Risk Analysis & Direct Checks
1. **Prompt revision drift after publish**:
   - *Direct check*: Publish workflow version 1 with `pinPromptsAtPublish: true`. Edit prompt to revision 2. Start a run of version 1. Verify `run.promptSnapshots` captures revision 1 content, not revision 2.
2. **Missing prompt revision at run start**:
   - *Direct check*: If a pinned prompt revision was somehow deleted or corrupted, starting the run fails with a descriptive `InterlockError` rather than silently using undefined or wrong text.
3. **Dry-run side-effect leakage**:
   - *Direct check*: Run `importWorkflows` with `dryRun: true` on an in-memory store. Verify store counts (`store.workflows()`, `store.listVersions()`) remain completely unchanged before and after.
4. **Cascade publish cycle detection in bundle import**:
   - *Direct check*: If imported bundle contains workflow dependency cycle, cascade publish inside import aborts and rolls back the entire transaction.

## Division of Responsibilities
- **Build**: Implement core schemas, runtime pinning, dry-run diffs, cascade publication, CLI flags, documentation updates, changeset, and automated tests.
- **Review**: Independent diff review and boundary verification.

## Open Questions
- None.
