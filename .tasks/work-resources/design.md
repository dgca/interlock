# Exclusive Agent resources

Issue #182, implemented directly at the user's selection. Based on main d7d67e1 after #190 merged. Branch codex/work-resources.

## Contract and scope

Optional Agent `resources` holds at most eight existing value bindings. Names resolve once at assignment creation, after Agent input bindings, without changing task input. Names trim outer whitespace, preserve case, contain 1–120 characters and exclude controls. Literal invalid/duplicate names, known object-valued bindings and invalid reference scopes reject at publication; incomplete drafts remain saveable. Dynamic invalid/duplicate names fail before an assignment is exposed. Empty requirements preserve existing behavior. Resource names are portable non-secret aliases; the local executor maps them to actual mutable resources.

Claims atomically acquire the complete resource set with the existing attempt, continuity and budget transaction. No partial reservation or budget/attempt spending occurs on conflict. Ordering is deterministic; first successful claim wins, with no reentrant assignment ownership, FIFO or starvation guarantee. This covers cooperating Agent claims only. Native Script/Fetch nodes, unmanaged writers, other libraries, process termination and OS/distributed fencing remain outside this feature.

## Ownership and recovery

Runtime WorkResources keeps one active record per normalized resource name in the additive workResources collection. Exact work ID, attempt and internal token hash guard ownership. No database schema migration or changes to published definitions are needed.

Accepted completion and cooperative failure release reservations after the executor has stopped resource use and related subprocesses. Rejected results and renewal retain ownership. Expiry, cancellation and claimed holds retain uncertain reservations; restart reconciles invalid claims conservatively. Detached work retains its independent lifetime. History deletion rejects while any affected reservation remains. Portable workflow bundles omit reservations; full database backups retain them.

The grouped manage_work_resources operation inspects at most eight reservations for one assignment, or releases all reservations for an exact uncertain attempt after actor/confirmStopped attestation. Active claims must first be held or cancelled. Repeated/stale recovery cannot release a replacement owner. Confirmation declares external quiescence; the server does not prove it or kill workers. Available work and compact nextWork exclude resource blockers. Briefings expose bounded conflict ownership and uncertain owner records even for terminal runs, with next:inspect_resources when recovery is needed.

Resource and budget blocking share suspended unclaimed time correctly across overlapping gates and holds. Owner changes update blocked work; reservation-only recovery touches the owning run's continuation revision without rewriting execution history. Storage owns filtered work/run reservation queries. Existing unconfigured assignment inspection avoids reservation lookup.

## UI

The existing Agent Execution section adds fixed-name chips with optional advanced value bindings. Run state identifies resource waiting and links the owning run. Uncertain ownership shows the exact attempt and a stop-confirmation checkbox before release; manual claim controls omit blocked assignments. Existing prompt, contract and execution fields remain intact.

Browser checks used a temporary sample library, with no real executor. Verified editor settings, normal contention, cancelled ownership, disabled/enabled confirmation, successful release, and newly claimable waiting work. Reviewed 1440×1000 and 1100×900 desktop layouts with no console errors. The 390×844 check exposes existing run-shell/sidebar clipping; broad phone-layout work is outside this change. The Impeccable detector returned no findings. Screenshots were captured locally during validation, not added to the package.

## Validation and affected-flow review

`pnpm test` passes all 1,095 tests in 94 files, including 27 new resource tests. `pnpm build`, `pnpm format:check`, `pnpm test:package` and `git diff --check` pass. The existing UI bundle-size warning remains. New tests cover cross-root racing claims over HTTP/stdio, all-or-none acquisition, dynamic and invalid names, independent resources, transactional rollback, capabilities/budgets, renewal/result validation, expiry/stale owners, cancellation/deletion, holds, overlapping deadlines, restart, detached boundaries, continuation wakeups, token privacy, export exclusions and shared API/CLI recovery. Tests use temporary databases and synthetic executors, without paid accounts or real board actions.

Reviewed the affected authoring/publication, claim/discovery, result/preflight, renew/fail/hold, cancel/retry, budget/deadline, continuation/wait, deletion and portable-export flows against the shared API. Updated README, architecture, current limits, harness/agent guidance, CLI help and a focused resource guide. This is an affected-flow review, not an audit of every MCP tool.

One grouped recovery tool is needed because uncertain ownership can outlive an expired/cancelled claim, which ordinary token-bound operations cannot release. HTTP and stdio discovery agree at 50 tools and 278,453 bytes, versus main's 49 tools and 269,409 bytes: 9,044 bytes, about 3.36%. Added context describes bounded requirements/ownership and correct stop recovery; operational detail stays in the resource guide. Pending root-package patch changeset; package version and changelog remain unchanged.
