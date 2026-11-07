# Deterministic step resource behavior

The problem, scope, and authorization are defined in [intent.md](intent.md).

## Acceptance criteria

- AC1. Script, Fetch, and polling Wait nodes accept optional `resources` using existing value bindings. At most eight distinct trimmed names of 1–120 characters are permitted, without control characters. Publication validates bindings and literals as for Agent resources. Non-poll Wait declarations are rejected at publication. Draft saves remain independent of publication readiness.
- AC2. Resources resolve from the step's resolved input and normal run binding scope once per execution. Admission reserves all names transactionally before any process or request launches. A conflict reserves none, launches no operation, and leaves the execution pending.
- AC3. Contention appears in run `waiting.kind: resource`, bounded briefing blockers, and inspection with exact owner identities. Resource queueing does not spend Script or Fetch timeout, polling check timeout, or polling Wait timeout. Once acquired, existing operation and wait deadline rules apply.
- AC4. Completed or cooperatively failed operations release their exact reservations. Polling checks hold resources only while a check runs and release between checks. Late settlement cannot release a replacement owner's reservations. Existing Agent claim behavior remains compatible.
- AC5. Interrupted or unconfirmed operations retain uncertain reservations across restart and cancellation until stopped reconciliation. Foreground Script and Fetch interruption does not replay. Polling checks cannot replay while their old ownership is uncertain. Background Script restart supervision preserves its reservation until an authenticated outcome or explicit stopped reconciliation establishes safety.
- AC6. Existing resource inspection and stopped-release operations support exact deterministic execution ownership and attempt identity, through shared server API, CLI, and MCP. Active ownership rejects premature manual release. History cleanup remains blocked while any reservation remains.
- AC7. Required behavior docs `docs/work-resources.md`, `docs/architecture.md`, and `docs/v1.md` describe deterministic admission, queue clocks, polling lifetime, restart/cancellation, and reconciliation. Affected README, CLI help, MCP discovery contracts and lifecycle instructions agree with implementation. A patch changeset records the user-visible feature.
- AC8. Automated checks cover mixed Agent and deterministic contention, atomic multi-name acquisition, queue clock exclusion, successful and failed release, polling inter-check release, restart uncertainty, explicit reconciliation, cancellation races, and backward compatibility. Full tests, build, and formatting pass before final review.

## Decisions and risks

The issue asks for the existing cooperative lock model, so it retains library-local names, no FIFO promise, and no process fencing. Polling ownership is per check so an idle poll cannot monopolize a shared resource. Queue time pauses only the resource-blocked portion of the polling deadline; ordinary Wait timers remain wall-clock timers.

Deterministic reservations expose execution identity rather than creating fake Agent assignments. Old Agent owner and request shapes remain valid. Uncertainty is conservative even where a caller cannot prove whether a remote HTTP effect completed. Explicit stopped confirmation establishes that an old operation no longer uses its resources, not that its external effect did not occur.

## UI impact

No new dedicated editor controls are required for this backend-focused issue. Raw workflow editing and existing API authoring accept declarations. Existing resource blocker and reservation views must render deterministic owners with a readable execution reference, preserve empty and error states, and keep existing navigation and keyboard behavior. Combined human UI verification is deferred by explicit coordinator authorization.

## Open questions

None requiring human input. Technical integration details and checks belong in [plan.md](plan.md).
