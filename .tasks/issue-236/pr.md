## TL;DR

Periodic workflows currently depend on external schedulers that can stop silently. Add durable interval and cron schedules with idempotent starts, visible fire history, overlap/missed-fire policies and recoverable failure/lag attention.

Closes #236.

## Details

Manage schedules in each workflow's Schedules tab, CLI, two grouped MCP tools and the shared API. They target the latest published version, start disabled, honor named pause holds and workflow admission, and transfer disabled in format-5 bundles. Queue overlap waits for terminal predecessors independently of public success-only dependencies. Optional failure pauses never apply by default.

Intent, specification, plan and retained UI evidence are under `.tasks/issue-236/`. The plan documents timing/failure defaults, exact check/source provenance and the isolated fresh UI review recipe. A patch changeset remains pending.

## MCP impact

Add read_workflow_triggers and manage_workflow_triggers, with bounded pages and explicit on-demand inspection. Trigger lists omit input templates and bindings. Update export/import, deletion and cross-tool guidance for disabled portable schedules and admission/pause behavior. HTTP and stdio discovery match: 59 tools, approximately 267.6 kB definitions, 9979-byte server instructions. The definition guard increases from 260 to 270 kB to include schedule and bundle contracts; compact main-branch descriptions and removal of redundant guidance preserve the existing 10 kB instruction bound. The full affected schedule/start/pause/transfer/inspection workflow was checked, not the entire MCP tool set.

## Backwards compatible?

Yes. Existing workflows and manual starts retain their behavior; schedules are opt-in and created/imported disabled. Storage uses an additive indexed migration. Older portable formats remain readable; older readers reject new schedule-bearing format 5. Existing JavaScript defaults and legacy Bash paths are preserved.

## Validation

At the recorded source commit: 128 files and 1541 tests pass, including 25 deterministic schedule tests, true concurrent process firing, atomic rollback, restart, DST, overlap/admission and pause intervals between ticks. pnpm build, pnpm test:package and pnpm format:check pass. Installed package smoke covers schedule CLI and bundled cron parsing.

Actual controls cover CRUD/activation, validation recovery, rejected saves, acknowledged writes followed by failed reads, revision conflicts/reload, navigation retention and narrow focus. Fifteen inspected runtime images and the earlier design fixture evidence are retained with source provenance. Independent UI and fresh exact-head SDLC review remain required before delivery. No release or publication is part of this change.
