# Atomic draft editing specification

See [intent](intent.md) for scope and authorization. These technical choices proceed under the user's request to implement issue 72 without approval pauses.

## Edit vocabulary and policies

`edit_workflow` accepts id, draftRevision, and edits. Operations are `add_node` with node, `update_node` with id, set, and optional unset, `remove_node` with id, `add_edge` with edge, `update_edge` with id, set, and optional unset, `remove_edge` with id, and `update_settings` with set and optional unset. Updates shallowly replace named fields, preserving other fields. IDs and node kinds cannot change. Unknown operation or definition fields reject the operation. Nested contracts remain JSON Schema objects, not a restricted vocabulary. Omitted language on existing scripts retains Bash. Added scripts default to JavaScript.

Removing a node recursively removes Batch members and incident edges, matching canvas deletion. Bindings in surviving nodes are preserved and diagnosed as publication blockers until explicitly repaired. Renaming or removing source ports preserves edges; the edit list must reconnect or remove them explicitly. Membership and scope remain explicit. Child-reference save checks reuse existing ownership rules. No operation edits workflow ownership or metadata.

Diagnostics accompany every edit and read-only `validate_workflow`. Each has severity, category, stable code, path, message, and relevant nodeId, edgeId, or operationIndex. Save errors prevent persistence. Publication blockers do not prevent saving incomplete drafts. Contract warnings never claim proof of compatibility. Validation accepts an optional candidate definition and never persists it.

The bounded contract subset covers declared primitive types, ordinary object properties and array items, known missing paths, binding projections, and pass-through routes. Explicit node input schemas do not replace upstream evidence. Complex schema keywords, unknown sources, ambiguous incoming contracts, root inputs in child contexts, and recursive inference report unknown. Runtime validation remains authoritative. Checks do not prove availability of earlier-node bindings or complete JSON Schema inclusion.

## Acceptance criteria

- AC1: Change one prompt or insert and reconnect a node without resending unrelated nodes or layout. Support every listed edit and workflow inputSchema, outputSchema, and maxSteps settings.
- AC2: Check the expected revision before applying edits. Apply in order to a copy and save once. Invalid operations identify their zero-based index; malformed data, unknown targets, conflicting IDs, or final save errors roll back everything. Empty or equivalent edits succeed without changing revision or timestamps; effective changes increment revision once.
- AC3: Shape and child-ownership errors block saving. Missing routes, graph or schema publication problems remain saveable. Return multiple independent diagnostics where practical and retain authoritative publication validation. Preflight never publishes, starts runs, or modifies drafts.
- AC4: Preserve unrelated fields, layout, pins, ownership, run history, and immutable versions. Preserve legacy Bash definitions and default newly added scripts to JavaScript.
- AC5: Apply the documented recursive Batch deletion, surviving binding, and port-edge policies. Scope and child-reference rules reuse current semantics. Nested membership errors remain publication diagnostics.
- AC6: Report supported primitive conflicts and known missing binding paths, including behind explicit input schemas. Unsupported schemas and ambiguous merges report unknown rather than compatibility.
- AC7: Expose operations and diagnostics through the shared API and both MCP transports. Discovery describes revision, rollback, no-op, language, deletion, and diagnostic semantics consistently across the affected authoring flow.
- AC8: Update documentation and add a pending patch changeset. Complete focused tests, build, formatting, and independent fresh-context implementation review before opening the PR.

## Alternatives and limits

Stable IDs avoid array-index patches that drift when nodes move. Shallow set plus unset avoids ambiguous merge semantics and allows precise optional-field removal. Preflight deliberately leaves unsupported schema compatibility unknown. Full-draft replacement remains available. No persistence migration is needed.
