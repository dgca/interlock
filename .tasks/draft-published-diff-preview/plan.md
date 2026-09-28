# Draft and published diff preview plan

## Verified repository facts

- `WorkflowEditor.tsx` holds the effective Visual or Raw definition, calls `save()`, then invokes `api.workflows.publish`. Its publish button already blocks invalid Raw content, graph errors, stale draft state, and pending actions.
- `workflows.versions` returns immutable `WorkflowVersion` records and is used by `RunDialog`. A version contains the definition and version number, not the workflow's mutable name or description.
- `packages/ui/src/components/Modal/Modal.tsx` wraps Mantine dialogs. The UI theme and editor layout live in `packages/ui/src/theme` and `WorkflowEditor.module.css`.
- `tests/workflowEditor.test.ts` mounts the editor in jsdom with mocked RPC calls. `tests/rawDefinition.test.ts` covers Raw parsing. The root scripts provide `pnpm test`, `pnpm build`, and `pnpm format:check`.
- README and `docs/architecture.md` describe editor publication. `packages/mcp/src/server.ts` defines MCP publication guidance. No API or MCP changes are planned.

## Implementation sequence

1. Add a pure UI comparison module for `WorkflowDefinition`. Match nodes by ID and routes by source/port. Compare JSON structurally with stable object-key handling. Return grouped, typed change entries with old/new values, including first-publication and layout-only states.
2. Add a publish review dialog using Mantine and the shared `Modal` wrapper. Fetch versions on open, show loading/error states, present counts and expandable items, and render full prompt and JSON details in a bounded scroll region.
3. Connect the dialog to `WorkflowEditor.tsx`. Pass the effective draft snapshot on open, retain current publish eligibility checks, and confirm through the existing `save()` then `publish` calls. Refresh the review if the known latest version changes. Keep cancel read-only.
4. Add focused comparison tests and editor interaction tests for first publication, unchanged drafts, valid Raw edits, invalid states, cancel, confirm, and errors. Check route identity, object-key order, and layout-only handling.
5. Update README, architecture and scope docs to describe the preview. Review affected CLI help and MCP publication definitions against the unchanged shared API, recording any gap. Add a patch changeset for `@type_of/interlock`.

## Verification

- Run focused comparison and editor tests first, then tests relevant to publication and Raw editing.
- Run `pnpm build` for TypeScript and UI compilation, and `pnpm format:check` after formatting touched files.
- Inspect the dialog in a browser at ordinary and narrow widths if a local development session can be started safely. Use a temporary database so checks do not touch the user's `.interlock` data.
- Review the final diff against the approved spec, including the save and publish path, documentation, and MCP guidance. Confirm no published definition or run logic changed.

## Risks and response

- The versions query retrieves the full history. Keep the change within the existing API for now; measure or revisit if a real history-size problem appears.
- A remote publication can make a preview stale. Compare the fetched baseline with the editor's current latest version before confirming, and refresh on mismatch. The server's current save conflict behavior remains the last check for draft races.
- Raw edits and editor history create multiple draft representations. Use the same `effectiveDraft` that `save()` uses, and freeze it for the modal review. A source edit cannot occur while the dialog covers the editor.
- Large schemas or prompts can overwhelm the overview. Start collapsed and make complete details scrollable.

## Proof of completion

The branch contains the accepted intent, spec, and plan, the comparison and dialog code, focused tests, affected docs, and a pending patch changeset. Focused tests, build, and format checks pass. The review step checks behavior against the approved artifacts before a PR is prepared for human review.

## Verification results

- `pnpm test`: 391 tests passed across 39 files after rebasing on current `main`. This included HTTP and stdio MCP transport tests.
- `pnpm exec vitest run tests/workflowDiff.test.ts tests/workflowEditor.test.ts tests/rawDefinition.test.ts tests/cascadePublish.test.ts`: 47 tests passed after the final editor change.
- `pnpm build` and `pnpm format:check`: passed after the final editor change.
- Browser check against a temporary database: reviewed unchanged and first-publication dialogs, expanded first-publication details, published a new test workflow, then reviewed an unsaved prompt change. Checked 1200px and 390px viewports; the dialog kept details scrollable and its actions visible.
- Compared README, `docs/architecture.md`, `docs/v1.md`, CLI publish syntax, and MCP list, get, create, update, and publish guidance with the unchanged server API. No MCP definition change was needed. The full MCP tool set was not audited.

## Open questions

None blocking. Browser inspection may lead to spacing or label adjustments within the approved design.
