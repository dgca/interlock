# Specification: M6: Optional prompt pinning at publish & CLI bundle sync

## Overview and Reference
This specification defines the functional requirements, schemas, execution rules, and CLI behaviors for opt-in prompt pinning at publish time and enhanced CLI bundle import with dry-run diffs and cascade publication.
For problem background, high-level outcomes, constraints, and baseline information, refer to [intent.md](intent.md).

## Acceptance Criteria

### AC1: Opt-in Prompt Pinning at Publish
- In `packages/core`:
  - `WorkflowDefinition` includes an optional boolean setting `pinPromptsAtPublish?: boolean`. Defaults to `false` when omitted or undefined.
  - `WorkflowVersion` includes an optional mapping `pinnedPromptRevisions?: Record<string, number>`.
  - When bundle transfer schemas (`workflowBundleSchema`) validate versions, `pinnedPromptRevisions` is supported on each exported/imported version record.
- In `packages/runtime`:
  - When publishing a workflow (`publishVersion`):
    - If `definition.pinPromptsAtPublish` is true, Interlock collects all referenced saved prompt IDs in the definition (via `promptIds(definition)`).
    - For each referenced prompt, it captures the prompt's current saved `revision` from the store (via `this.prompts.get(id).revision`).
    - The resulting map `{ [promptId]: revision }` is recorded on the published `WorkflowVersion` under `pinnedPromptRevisions`.
    - If `pinPromptsAtPublish` is false or omitted, `pinnedPromptRevisions` is omitted (or undefined) on the `WorkflowVersion`.

### AC2: Run Startup Respects Pinned Prompt Revisions
- In `packages/runtime` (`prompts.ts` and `index.ts` / `runStarts.ts`):
  - At run initialization (`newRun` / `prompts.capture`), Interlock checks if the target `WorkflowVersion` has `pinnedPromptRevisions`.
  - If `pinnedPromptRevisions` are present:
    - For each referenced prompt ID, `this.prompts.get(id, pinnedRevision)` fetches the prompt content at that exact pinned revision from prompt revision history.
    - If the prompt at that pinned revision is missing or deleted, startup fails with an `InterlockError` indicating the missing prompt revision.
    - The run's `promptSnapshots` capture that exact pinned prompt revision and content, rather than floating to the latest saved revision.
  - If `pinnedPromptRevisions` are absent (default/unpinned):
    - Behavior is unchanged: `this.prompts.get(id)` fetches the latest saved prompt revision.

### AC3: CLI Bundle Import Semantic Dry-Run (`interlock import --dry-run`)
- In `packages/core` and `packages/server` / `packages/cli`:
  - `interlock import <file|json> --dry-run`:
    - Validates the bundle without mutating the database (read-only preview).
    - Compares each workflow definition in the bundle against existing published definitions (if any version exists) or drafts.
    - Compares definitions semantically:
      - Ignores canvas layout positions (`node.position`).
      - Ignores JSON object key order (`structuralEqual` / `sameValue`).
      - Distinguishes added workflows, modified workflows, unchanged workflows, and added/modified nodes, routes, contracts, and execution settings.
    - Returns a structured dry-run report containing:
      - `dryRun: true`
      - `workflows`: array of workflow diff summaries (e.g. `workflowId`, `name`, `status: "added" | "changed" | "unchanged"`, `changes`).
      - `prompts`: array of prompt diff/status summaries.
      - `triggers`: array of trigger diff/status summaries.
    - CLI outputs the dry-run diff report in formatted JSON (consistent with CLI conventions).
    - Does NOT write to the database or mutate any workflow, prompt, or version records.

### AC4: CLI Bundle Import Atomic / Cascade Publishing (`interlock import --publish [--cascade]`)
- In `packages/server` (`router.ts` & `transfer.ts`) and `packages/cli` (`commands.ts`):
  - Add `publish?: boolean` and `cascade?: boolean` options to the `workflows.import` mutation.
  - Add `--publish` and `--cascade` flags to `interlock import` in the CLI.
  - When `--publish` is specified:
    - After successfully importing the bundle within the transaction, Interlock publishes the imported workflows.
    - When `--cascade` is also provided, publication cascades through dependent workflows in topological order, updating downstream workflow node version references atomically.
    - The entire operation (import + publish / cascade) runs inside a single database transaction: if any publication, cycle check, or validation fails, the entire import is rolled back.
    - Returns the imported workflow results and the published version summaries.

### AC5: Documentation, Tests & Changeset
- Automated tests verify:
  - Workflow version publication with `pinPromptsAtPublish: true` records `pinnedPromptRevisions`.
  - Runs of pinned workflow versions capture the pinned prompt content even if the prompt is later updated.
  - `interlock import --dry-run` performs semantic diffs and leaves the store unmutated.
  - `interlock import --publish --cascade` atomically imports and publishes workflows in dependency order.
- Documentation updates:
  - `docs/prompts.md`: document `pinPromptsAtPublish` behavior and run snapshot guarantees.
  - `docs/architecture.md`: document prompt pinning in execution semantics and CLI bundle sync.
  - `docs/v1.md`: update feature limits and capabilities.
  - `README.md`: document `--dry-run`, `--publish`, and `--cascade` CLI flags.
- Add patch changeset for `@type_of/interlock`.

## Decisions and Alternatives Considered
- **Placement of `pinnedPromptRevisions`**: Placing it on `WorkflowVersion` rather than mutating `WorkflowDefinition` keeps `WorkflowDefinition` clean and separates the workflow structure from the immutable publication snapshot metadata.
- **Dry-run Execution**: Performing dry-run comparison at the server/API layer ensures that CLI, MCP, and UI callers share identical semantic comparison semantics.
- **Transactionality**: Running cascade publication within the same `store.transaction` as import ensures that a failure in publication or cycle detection does not leave partially imported or inconsistent workflow records in the database.

## Open Questions
- None.
