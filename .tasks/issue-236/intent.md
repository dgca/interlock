# Workflow schedules

Source: [H9 #236](https://github.com/dgca/interlock/issues/236), parent [#223](https://github.com/dgca/interlock/issues/223), fetched 2026-11-07. SDLC run `2db902b3-d9e0-40be-94fa-352aafe8045c`.

Task branch: `feat/issue-236`. Original baseCommit: `dcba6b6ff490d6a8d709a39233e56fddced3d944`.

Periodic triage and polling currently depend on external host schedulers. A failed watcher can stop unattended pipelines without an engine-visible reason. Interlock must own durable periodic starts, make missed or delayed work visible, and preserve its existing admission and pause rules.

Operators can manage schedules from their workflow, CLI, MCP, and shared API. Connected agents can inspect bounded fire history and recover an automatic pause without releasing unrelated named holds. Existing manual starts and incomplete workflow draft saves retain their contracts.

Scope covers schedule triggers only: intervals, five-field cron with IANA zones, literal JSON input plus explicit metadata bindings, overlap and missed-fire policies, transactional deterministic starts, optional failure pause, attention, inspection, and portable disabled imports. It does not introduce webhook/event triggers, a hosted scheduler, a new executor, or run-now behavior.

Use `.tasks/issue-236/ui/ui-design.md` and its inspected fixture evidence for the Mantine UI. New schedules start disabled and target the latest published version. Operational schedule writes are independent of workflow draft save. The user said, “I can do a design review at the end as well. No need to pause on those.” This permits continuing design decisions under existing authorization; it does not record rendered human approval.

Respect #230 library/workflow named holds and #235 admission queues, capacity, dependencies, and queued status. Schedule alerts count independently from run rows. Keep contracts in core, persistence in storage, execution in runtime, and callers on the shared API. Preserve JavaScript defaults and legacy Bash. Include a pending patch changeset, affected docs/help and the full affected MCP flow.

Success means an operator can replace a heartbeat cron job, observe every meaningful fire outcome, avoid duplicate starts after restart or competing servers, and understand lag or automatic pause without unbounded catch-up work.

Technical investigation in spec/plan will settle counting terminal failures, lag threshold, queue accounting, interval anchor and enable recovery. No unresolved material intent question needs human input. All tests use isolated temporary databases and ports. Parent coordinates independent UI/final change review, CI, merge and cleanup. Author stops before claiming final Review change, pushing, or opening a PR. No release or publication.
