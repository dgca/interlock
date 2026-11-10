# Arrange workflows without changing their content

Dragging nodes or using **Tidy** saves their positions automatically. Layout does
not require **Save draft**, change `draftRevision`, or publish a version. Undo and
Redo save the resulting arrangement. Discarding content edits retains saved
positions for surviving nodes. Node, route, contract, and execution-setting edits
still use the draft save and publication flow.

Layouts belong to the workflow and are shared across browsers connected to the
same Interlock instance. The editor reports pending or failed layout saves and
offers retry after a failure. Keep Interlock available until a pending save
finishes. Existing embedded positions remain the fallback until a saved layout
exists. Batch child positions remain relative to their parent.

Published definitions and historical run graphs retain their captured positions.
New publications capture the current layout without changing older versions.
`draftMatchesLatest` compares content rather than presentation coordinates, so a
layout-only difference does not produce an unpublished-draft diagnostic.

## Arrange through MCP or the shared API

Set top-level `layout: "tidy"` on MCP `create_workflow`, `update_workflow`, or
`edit_workflow` to run full-workflow Dagre. The shared API accepts the same option
on `workflows.create`, `createSummary`, `update`, `updateSummary`, and `edit`.
It uses the editor's Dagre geometry, Batch scopes, and port-aware crossing
reduction. ELK remains an editor option.

```json
{
  "id": "WORKFLOW_ID",
  "draftRevision": 3,
  "layout": "tidy"
}
```

Read the current revision with `get_workflow` first. Missing or stale revisions
reject the request without saving metadata, content, or positions. Layout and
content changes in one request commit together. Only content changes advance
`draftRevision`; layout-only changes leave the workflow timestamp unchanged.

Use `layout: "preserve"` when replacing content while retaining the separately
saved positions of existing nodes. New nodes use their supplied positions. Omit
`layout` to accept supplied position changes. Incomplete routes and disconnected
nodes remain saveable; publication checks stay separate.

`edit_workflow` applies layout after all edits pass save validation. Moved nodes
appear in `changes.nodes.updated` even when the content revision stays unchanged.
An empty edits array can arrange the stored graph. A request that changes neither
content nor positions preserves both revisions.

Full workflow reads return current positions in `draft.nodes[].position`, plus
`layoutRevision`. Compact authoring summaries retain their existing shape. The
editor uses `workflows.saveLayout` with `id`, `expectedRevision`, and a position
map to save presentation independently. That operation merges node positions,
checks the layout revision, and never writes draft content.

## CLI

```sh
interlock update WORKFLOW_ID '{"draftRevision":3,"layout":"tidy"}'
interlock edit WORKFLOW_ID '{"draftRevision":3,"edits":[],"layout":"tidy"}'
```

Use the current content revision for each command. Layout-only commands do not
advance it. Legacy single-workflow creation through `import` also accepts `layout`
beside `definition`. Both `update` and `edit` accept JSON or `@file`.

## Export and import

Bundle formats remain unchanged. Export embeds the current layout in draft node
positions and keeps every published definition and deletion identity intact.
Explicit draft export uses the supplied draft's positions. Import reads embedded
draft positions into the separate layout record, including old bundles and legacy
single-workflow files. No bulk rewrite of old definitions is required.

Position-only differences in an existing draft update layout without a content
conflict or content-revision increment. Content and metadata replacements retain
their revision/force checks. Published versions still require exact matching
content, including their original positions. Any import failure rolls back layout
updates with the rest of the import.
