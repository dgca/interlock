# Arrange drafts during authoring

Set top-level `layout: "tidy"` on MCP `create_workflow`, `update_workflow`, or `edit_workflow` to arrange the saved draft. The shared API uses the same option on `workflows.create`, `createSummary`, `update`, `updateSummary`, and `edit`.

The option runs the same Dagre implementation, card geometry, Batch layout, and port-aware crossing reduction as the editor's **Tidy → Dagre**. It is independent of the browser's last selected Tidy mode. Nested Batch positions stay relative to their parent.

Use it when creating a workflow or making structural changes. Omit it for text-only changes or to preserve a manual layout. Without the option, position handling is unchanged, including the `{x:0,y:0}` default for omitted node positions.

## Create or update

Include `layout` beside the definition, not inside it:

```json
{
  "name": "New workflow",
  "definition": {
    "nodes": [
      { "id": "entry", "kind": "entry", "label": "Input" },
      { "id": "exit", "kind": "exit", "label": "Output" }
    ],
    "edges": [{ "id": "finish", "source": "entry", "target": "exit" }]
  },
  "layout": "tidy"
}
```

Incomplete routes and disconnected nodes can still be saved. Publication checks remain separate from layout.

For a full replacement, send `id`, `draftRevision`, `draft`, and `layout` to `update_workflow`. To arrange the stored draft without replacing it, omit `draft`:

```json
{
  "id": "WORKFLOW_ID",
  "draftRevision": 3,
  "layout": "tidy"
}
```

Read the current revision with `get_workflow` first. Layout and other requested changes save together. Missing or stale revisions reject without saving metadata or positions. Layout-only updates count as a draft save and increment its revision once.

## Combine layout with edits

Add `layout: "tidy"` beside `edits` in `edit_workflow`. Layout runs after all edits pass save validation. The response's `changes.nodes.updated` includes existing nodes moved by layout. Edits and layout share one revision increment; a request that changes neither keeps its revision and timestamp. An empty edits array can arrange the stored draft.

`detail: "summary"` on create/update and `diagnostics: "summary"` on edit keep their existing compact response behavior. Read `get_workflow` when you need saved positions. This feature does not add a layout preview or return an additional full definition.

## CLI

Legacy single-workflow creation through `import` accepts `layout` in its JSON input:

```sh
interlock import @workflow.json
interlock update WORKFLOW_ID '{"draftRevision":3,"layout":"tidy"}'
interlock edit WORKFLOW_ID '{"draftRevision":4,"edits":[],"layout":"tidy"}'
```

`update` accepts metadata or a replacement draft, with the same revision rules as the shared API. `edit` accepts stable-ID edits and optional diagnostic mode. Both accept JSON or `@file`. Portable bundle import retains the positions in the bundle; it does not request layout.

## Limits

Only `"tidy"` is accepted, and it always uses Dagre. ELK remains available in the editor. Incremental placement of missing positions and read-only layout preview are outside this increment.

Layout changes positions only. It does not publish, change retained versions or runs, alter graph execution rules, or repair invalid routes. The request is not a workflow setting and is not saved or exported in the definition. Dagre computes on the local server; large graphs add work to the draft save.
