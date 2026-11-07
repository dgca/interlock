# Independent pause holds

Branch: `feat/issue-230`. Original baseCommit: `8e7ac9fb51bcdbbb82c622233e9f327d1f2ab84a`.

Operators and automation need to stop workflow execution during deployments and incidents without clearing another actor's pause. Interlock will own persistent library and workflow holds, with exact-ID release through its shared API, CLI, MCP, and existing Mantine UI.

The change covers execution admission, step boundaries, external input acceptance, active-time accounting, and current stage/waiting/actor projections. Reads, editing, inspection, cancellation, cleanup, and pending input revisions remain usable. In-flight work may finish, with subsequent progress held at the next boundary.

Schedules, inbound webhook delivery, doctor, automatic retry windows, stall monitoring, and total Agent deadlines remain future work. Their future implementations must use the same pause evaluation and recorded blocked intervals. Wait deadlines keep wall-clock meaning.

Source: GitHub dgca/interlock#230 and parent #223, fetched live 2026-11-07. UI direction is .tasks/issue-230/ui/ui-design.md from published UI design v2 run 7eaea61e-5b68-4d61-ad34-c97b37785cae. Its status is ready under existing authorization, not human-approved. The user superseded the initial design pause with "I can do a design review at the end as well. No need to pause on those." Technical and design decisions within scope can proceed under that authorization.

Work stays in /Users/dan/dev/interlock-worktrees/issue-230 on feat/issue-230. All test mutations use temporary isolated databases and task-owned servers. Shared server state and the user's .interlock data are protected. Preserve the design artifacts. Required documentation and MCP guidance ship with the change and a patch changeset. Stop when fresh final Review change becomes available; the parent coordinator arranges independent UI and implementation reviews before any push or PR.

Success means one operator can release their own hold while every other applicable hold continues to prevent execution. Pause state and its reasons survive restart and remain inspectable. No material intent question remains unresolved.
