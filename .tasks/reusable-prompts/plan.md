# Reusable prompts implementation plan

Behavior and acceptance criteria are defined in [spec.md](spec.md); scope and authorization are in [intent.md](intent.md). Spec review proceeds under existing authorization and the human decision S1. The task branch is `codex/reusable-prompts`; its baseline before planning is `46f7655`.

## Verified repository facts

SQLite uses generic document collections, with compatible optional fields preferred over migrations. Runtime's `newRun` creates ordinary, detached, and Batch item runs; only Batch item runs receive `batchNodeId`. Agent assignments persist the node prompt and policy. Existing claim and explicit retry paths can reuse a persisted capture without reading the library again.

The server exposes tRPC, and HTTP MCP calls the same caller directly. The stdio MCP bridge maps those procedures in `packages/mcp/src/client.ts`. UI uses React Router, a shared App context, Mantine theme, and shared dirty-navigation protection. Agent settings live in `NodeInspector`. Workflow transfer currently uses format version 1 and validates imports transactionally.

## Implementation sequence

1. Add prompt contracts and pure composition in core. Keep `promptIds` optional on Agent definitions, and add optional captures to Run and WorkRequest. Validate distinct IDs at publication while allowing incomplete drafts. Add prompt records, revision history, usage lookup, revision-protected updates, guarded deletion, capture resolution, and reference diagnostics at the existing storage/runtime seams. No database rewrite is needed. Covers AC3, AC4, AC6, AC9.
2. Capture all Agent prompt references in the current workflow graph at each non-Batch run startup. Batch item runs inherit capture. Compose assignments from that persisted capture; retain capture on retry and restart. Keep compact projections unchanged. Covers AC3, AC4, AC5, AC9.
3. Add prompt procedures to the shared server and MCP client and tool registrations. Extend definition guidance, discovery and claim instructions, validation, and transfer descriptions together. Preserve CLI JSON paths. Covers AC6, AC8, AC9.
4. Extend portable bundles with optional prompt records, preserving existing prompt-free format-1 bundles. Detect missing dependencies and divergent shared content before completing the transactional import. Reject prompt-bearing exports on older readers rather than allowing them to strip references. Use a new bundle format version for prompt-bearing exports if the current reader would otherwise drop the data. Covers AC7, AC9.
5. Add Prompts routes, library and editor, using the shared theme and navigation protection. Feed saved prompts through App context to Agent settings, with ordered selection, content inspection, and a composed preview. Extend assignment inspection with captured prompt identities and revisions. Covers AC1, AC2, AC5, AC6.
6. Update affected user and agent documentation, CLI help where transfer behavior is described, and a pending patch changeset. Finish with the checks below and commit intended changes for the workflow's independent review. Covers AC8, AC9.

## Verification

Use temporary or in-memory databases only. Add focused behavioral coverage for prompt updates, no-op and stale revision saves, retained history, reference errors and delete guards, composition order, published definitions remaining unchanged, startup capture across later steps and Batch items, separate child and detached captures, claim reclaim, retry, loops, and reopening a stored database. Map results to AC3 through AC6 and AC9.

Extend transfer tests for dependencies and children, shared IDs, empty-library import, idempotence, conflict rollback, missing prompts, and legacy bundles. Covers AC7 and AC9. Extend existing HTTP and stdio transport tests to discover prompt tools, exercise their revision and lifecycle contract, author references, and receive the composed captured assignment. Covers AC5, AC6, AC8.

Use existing UI tests for save protection, routes, and ordered Agent settings where they give meaningful regression coverage. Confirm missing references stay visible. Covers AC1, AC2, AC6. No new automation framework is required.

Run the relevant tests, `pnpm build`, `pnpm test:package`, and `pnpm format:check`. Run the complete test suite once to check the affected shared contracts. Repeat only checks affected by subsequent corrections.

## Representative UI journey

Start a separate preview engine with a temporary database and a free port, preserving the user's running engine. Through actual browser controls:

1. Open Prompts, create two named prompts, type Markdown content, save, search, and reopen. Expect persisted text and a clean editor. Edit text and attempt navigation, then keep editing and discard. Covers AC1.
2. Open a workflow's Agent settings, select both prompts, reorder them, inspect content, and change task instructions. Expect preview order and task text to match the controls. Apply, save, reopen, and inspect Raw. Covers AC2.
3. Publish and run the workflow, inspect its assignment and captured revisions, then edit a shared prompt and start another run. Expect old and new runs to show their respective content. Try deleting the referenced prompt and expect dependent-workflow feedback. Covers AC3, AC5, AC6.

Record observed results, method, and evidence references here. Broaden the journey only for a concrete failure or uncovered required interaction.

## Risks and review

Avoid accidental reference stripping by old bundle readers. Preserve empty optional fields in older definitions and exact legacy prompt text. Keep shared prompt changes separate from immutable workflow definitions. UI refreshes must not overwrite dirty text or advance its save revision. Dependent prompt deletion considers every published version, matching workflow dependency guards.

The SDLC workflow requires fresh-context implementation review. Apply the code-review skill's independent review agents at the exact committed task head. Pass the run and assignment identifiers and artifact paths without inherited implementation history. Do not claim fresh context in this conversation. Finish locally after a passing review.

## Results

Implementation and checks pending.
