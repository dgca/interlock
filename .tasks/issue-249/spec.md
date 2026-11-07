# Run tag behavior

[Intent](intent.md) owns scope and authorization. GitHub #249 defines the tag limits and affected run discovery. All decisions below fit that request and existing engine behavior.

## Acceptance criteria

- AC1: Optional `tags: Record<string, string>` accepts up to 16 entries. Keys are nonempty and at most 64 JavaScript string units. Values are at most 64, including empty strings. Matching is exact and case-sensitive. Preserve punctuation and whitespace without normalization. Omission preserves legacy untagged behavior.
- AC2: Ordinary starts through API, CLI, MCP and UI validate tags before mutation and capture a copy. An idempotent replay recovers the original tags. Reusing the key with different supplied tags rejects. Active-task reuse preserves the existing run tags rather than merging or changing them.
- AC3: Schedule, webhook and lifecycle-event configurations accept static top-level tags. New runs capture the configured tags. Non-start webhook actions do not retag existing runs. Trigger export/import preserves tags through the existing disabled-by-default transfer rules.
- AC4: Workflow children, detached children, Batch items and continue-as-new members inherit their originating run tags. Lifecycle handlers get only their configured tags; their event input includes source run tags for explicit attribution.
- AC5: Tags appear on retained run records, list results, UI summaries and inspector, briefings and compact start/submission summaries. No arbitrary input or output body is added to summaries.
- AC6: Optional tags on run queries and paginated Runs summary queries require every exact key/value pair. Empty filters mean no tag restriction. Filters compose with workflow, status, tab and pagination; counts reflect the filtered scope. A durable storage index supports filtering and backfills existing tagged run documents on upgrade. Updates and deletions cannot leave stale matches.
- AC7: UI offers optional tag rows in Run start, schedule and event configuration; the existing full JSON webhook editor accepts tags. Runs exposes explicit key/value filter controls with Apply and Clear and preserves filters through navigation. Invalid, duplicate or oversized entries prevent submission with nearby feedback. Existing loading, empty and error states remain applicable; filter controls reset pagination. Rows use labeled keyboard-accessible controls and fit narrow screens.
- AC8: Documentation and MCP discovery state limits, exact matching, immutable captures, inheritance and trigger behavior. M10 performance reports remain planned; this change supplies indexed run queries without claiming report filtering exists.

## Decisions and risks

Tags remain non-secret metadata, visible to connected clients and exported history. Static trigger tags meet the requested start support without adding a second binding language. Inheritance supplies repository and batch attribution across ordinary execution trees. Event handlers are independently configured rather than silently merging possibly conflicting metadata from their source.

SQLite indexing uses bound key/value parameters, not tag names interpolated into JSON paths. The index follows run document writes and deletes transactionally. Existing runs without tags remain valid.

No material decisions remain unresolved. Human UI review is deferred by the requester.
