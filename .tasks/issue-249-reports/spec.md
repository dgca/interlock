# Tagged report behavior

Scope and authorization come from [intent](intent.md). These criteria complete #249's report requirement without changing #247's existing metrics.

## Acceptance criteria

- AC1: `report.summary` and MCP `workflow_report` accept optional `tags` with the existing run tag bounds, at most 16 pairs, nonempty keys up to 64 characters and string values up to 64 characters. Matching is case-sensitive, literal and requires every pair. Empty tags match the same runs as omission. Invalid filters reject before report execution.
- AC2: Storage uses the existing `run_tags` index before the newest-run sample limit. Tags combine with workflow and date constraints. Every duration, outcome, usage and attribution calculation includes only the selected sample. Unfiltered report outputs/defaults remain compatible, including limit 500, maximum 5000 and no date default.
- AC3: CLI `interlock report` accepts repeatable `--tag KEY=VALUE` consistent with run-list filtering, preserving values after the first equals sign. MCP discovery documents the same filter and bounds through both transports without adding tools or enlarging response scope.
- AC4: Reports UI exposes the existing reusable tag filter control near its other filters. Applying and clearing tags fetches the filtered and unfiltered report respectively. Empty results and server validation errors use the existing states; keyboard, focus and narrow-screen behavior follow the reused control.
- AC5: Navigating among `/runs`, `/report` and `/workflows/:workflowId/report` keeps React hook order stable and displays the correct report route.
- AC6: README, affected guides, CLI help and MCP definitions describe actual filtering and settled report limits. Report docs describe interpolated percentiles and remove obsolete report-unavailable claims. A pending patch changeset states user-visible changes.

## UI proposal

Keep the report page's existing filter group and result sections. Add the same bounded TagFilters used on Runs, with an explicit apply action matching report filters. Existing report loading, error and empty states handle tag requests. Navigation changes only make both route hooks unconditional, preserving report selection and titles. No new page or explanatory filler is required.

## Decisions

Reuse the existing tag contract and indexed exact matching rather than introducing report-only semantics. Correct inaccurate documentation instead of changing established report defaults or percentile computation. The explicit follow-up authorizes this compatibility choice. No unresolved product decisions remain.
