# Draft and published diff preview

## Problem

The workflow editor publishes the current draft without showing how it differs from the latest immutable version. Authors must remember or inspect earlier definitions to understand the effect of a new publication, especially after several edits.

## Desired outcome

Before publishing, an author can review a concise comparison of the current editor draft with the latest published definition. The preview identifies added, removed, and changed nodes; route changes; prompt and setting changes; and workflow input and output contract changes. Each summary item offers enough detail to inspect the underlying change. A workflow with no published version has an honest first-publication preview.

## Affected users and systems

- Workflow authors using the visual or raw editor.
- The editor's read path for the latest published definition and its existing save and publish action.
- Documentation describing publication in the editor.

## Constraints

- Keep publication validation, version creation, and execution semantics as they are.
- Compare the draft the editor would publish, including unsaved edits when eligible, without treating canvas-only state as a workflow change.
- Preserve the distinction between saveable incomplete drafts and publishable definitions.
- Use the existing Mantine theme and editor controls. Keep the summary scannable and detail available on demand.
- Preserve the user's `.interlock` data; automated checks use temporary databases.
- Add a patch changeset for `@type_of/interlock` and check affected docs and MCP guidance.

## Success criteria

- The preview is available before the publish action and names its comparison baseline.
- Node additions, removals, and meaningful edits are visible, including prompts and settings. Route and workflow contract changes are visible.
- Readers can inspect the details behind each reported change.
- First publication and a draft with no meaningful change have clear states.
- Existing save, publish, and run behavior continues to pass relevant checks.

## Open questions

None required to establish the intent. The spec should decide how to present large prompt and JSON contract changes, and how to treat ordering or layout-only edits.

## Source request

> Build a draft-versus-published diff preview for the workflow editor. Before publishing, show what changed from the latest published version: added, removed, and changed nodes; routes; prompts and settings; and workflow contracts. Make the summary easy to scan, with details available to inspect. Handle workflows that have never been published. Preserve existing publication and execution behavior.
