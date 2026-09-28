# Draft and published diff preview spec

## Requirements

1. The workflow editor offers a review step before its existing publish action. The review names the baseline as the latest published version, or states that this is the first publication.
2. Compare the effective editor definition, including valid unsaved Visual or Raw edits that the publish action would save, with the latest immutable published definition. Never compare against a stale local copy when the review opens.
3. Summarize added, removed, and changed nodes and routes. Show prompt, node setting, node contract, workflow contract, and workflow execution-setting changes. Details must expose old and new values without truncating long prompts or JSON.
4. Keep the overview easy to scan. Group changes by type, show counts, and let readers expand individual items. Represent an unchanged definition and a first publication explicitly.
5. The review is read-only. Confirming it uses the editor's existing save-then-publish operation. Cancel leaves the draft untouched. Existing validation, stale-draft protection, immutable versions, and run pins continue to work.
6. The review supports all current node kinds, nested Batch members, route ports, and Raw edits. Invalid Raw content or a graph error continues to block publication.

## Proposed design

### Data and comparison

- Use the existing `workflows.versions` query when opening the review and select the latest returned version. No new persisted data or publication endpoint is needed. The query returns an empty list for an unpublished workflow.
- Compare `WorkflowDefinition` values in a pure UI function. Match nodes by stable node ID and routes by source node ID plus output port. An unchanged route's storage ID has no meaning in the summary. A route with the same source and port but a different target or target handle is a changed route. New or missing source/port pairs are additions or removals.
- Split node fields into prompt, input/output contracts, layout (`position`), and other settings. Include label, kind, Batch membership, bindings, context, and kind-specific fields in settings. A kind change under the same ID appears as a changed node with old and new kinds. Use field paths so a changed node can show exactly which parts differ.
- Compare workflow `inputSchema`, `outputSchema`, and `maxSteps` separately. Published versions contain definitions but not immutable name or description metadata, so the preview cannot claim to compare those fields. The review explains its scope as the workflow definition.
- Compare JSON objects structurally, independent of object-key order. Respect array order where it changes behavior, such as Switch case priority. Report layout-only edits as a separate, quieter count so Tidy does not bury execution changes. Do not include selection, viewport, collapse state, or other editor-only state.
- For first publication, show every draft node and route as added, plus the configured contracts and execution settings. Do not invent a published baseline. For no definition change, say so while allowing the existing publish action, which may intentionally create another immutable version.

### Editor interaction

- Change the current `Publish version` button to open a review dialog. Fetch versions on opening; show loading and retryable error states. Keep the dialog mounted over the editor so the draft cannot change underneath the reviewed snapshot.
- The dialog begins with a compact count summary and groups for nodes, routes, and workflow contracts/settings. Each change row identifies the affected node or route and its change type. Expanding a row shows old and new values, using readable text for prompts and formatted JSON for structured values. Long details scroll within the dialog.
- The primary dialog action publishes the reviewed definition through the current `save()` followed by `api.workflows.publish.mutate`. Keep the existing pending state and feedback. Close only after success; on failure keep the review open with the existing error feedback, so the author can retry or close it.
- If the editor learns of a newer published version while review is open, require a fresh comparison before confirming. The existing `remoteChanged` check continues to block stale draft edits.
- Keep review copy short and place guidance where it explains a real consequence. Use Mantine dialog and controls with the existing theme.

## Acceptance criteria

- A published workflow with one added node, one removed node, one changed Agent prompt and context setting, a rerouted edge, and changed input/output contracts reports each change once with inspectable before and after details.
- Editing a route's edge ID alone does not make a route change. Moving a node reports layout without obscuring prompt or setting changes. Reordering object keys in JSON contracts does not produce a change.
- A never-published workflow shows a first-publication state and its proposed nodes, routes, and contracts. An unchanged draft shows an explicit no-change state.
- Valid unsaved Raw edits appear in the review and publish after the normal save. Invalid Raw content or invalid graph routes cannot be published from the review.
- Cancel does not save. Confirm preserves the current save, publication, version pinning, and execution behavior. Server errors do not silently publish or dismiss the review.
- Relevant comparison tests, editor interaction checks, `pnpm build`, and `pnpm format:check` pass. Use temporary databases for any server tests.

## Alternatives and risks

- A server-side diff would duplicate editor presentation concerns and add an API contract. The current versions query is enough for a local editor, though it retrieves all versions. If version histories become large, add a latest-version query separately.
- Text diffing entire serialized definitions would be hard to scan and would flag key ordering and edge IDs. Structural comparison keeps the review tied to authoring concepts.
- A version may appear while the dialog is open, or a save may fail due to a draft revision conflict. Refresh the preview when the known latest version changes and rely on the existing save error for revision conflicts. The review is guidance, not a new transactional publication guard.
- Large prompts and schemas can make the dialog long. Collapse per-item details and constrain the detail region while keeping complete content accessible.

## Unresolved questions

None blocking. The implementation can adjust row wording and visual spacing after checking the editor in the browser.
