# Move existing workflows without recreating them

Issue [#99](https://github.com/dgca/interlock/issues/99) requires an existing library workflow to become its caller's child without restarting version numbering or splitting run history. Users also need to release a child back to the library or change its owner when references permit it.

Success means ownership changes preserve the workflow identity, definitions, draft and useful history, and enforce exclusive child reuse. The shared server API and MCP provide the operation; no new UI controls are required.

Only a proposed owner may reference a child. Check every draft and retained published version, including flat Workflow nodes inside Batch groups, and name foreign callers precisely. Children cannot own children. Historical blockers remain until explicitly removed through the cleanup introduced in [PR #109](https://github.com/dgca/interlock/pull/109); ownership changes must never silently rewrite or delete definitions. Import remains unable to change an existing workflow's ownership, even with force.

The user requested separate PRs per issue and backward compatibility, approved retaining exclusive ownership with "We should keep that", accepted MCP-only controls, and approved the recommendation with "Love it, let's do it". They selected the published SDLC workflow. The cleanup backup decision was subsequently settled by "Let's go with your recommendation" and is preserved here.

This is SDLC v4 run `441f9bb1-4d8e-4ebe-b806-88acaebad520`, with automatic planning reviews and human pauses for unresolved material decisions. Artifacts live in `.tasks/workflow-ownership/`. Branch `codex/workflow-ownership` starts at `bfcd3d3dd5ca587ba0117b24f00689af3d1e1b42` and its PR will be stacked on `codex/version-cleanup-and-ownership` while #109 remains open. Preserve unrelated work and the user's database; checks use temporary databases.

No intent decisions remain unresolved. Investigate concurrency protection and reference diagnostics during specification and planning.
