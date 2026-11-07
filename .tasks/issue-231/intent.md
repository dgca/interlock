# Run stage and waiting visibility

Task branch: `feat/issue-231`. Original base: `4ffc5a78b03c53975dd69a20b2e462c86898a863`.

Issue [#231](https://github.com/dgca/interlock/issues/231), under [#223](https://github.com/dgca/interlock/issues/223), asks for board-ready run state without reconstructing it from node properties or logs.

People author stage labels on workflow nodes. Agents, boards, and the run inspector receive a shared stage, waiting reason, and actor projection. Task correlation can include a readable title.

Success means callers can identify the current stage and who can move a run forward from a compact summary. The engine remains domain agnostic and preserves existing workflows.

The request authorizes autonomous technical decisions with SDLC auto review. The coordinator requires an independent fresh final review before delivery, and owns CI, merge, and cleanup. No release or publication is authorized.

Scope is limited to current lifecycle states. Pause and admission queues are future features on this baseline; their waiting vocabulary is reserved, without inventing new runtime behavior. Runtime owns projection, core owns contracts, storage owns persistence. Existing Bash defaults and incomplete-draft saves remain intact. Tests use temporary data and UI servers use isolated ports.

Behavior and acceptance criteria belong in spec.md. Implementation and verification belong in plan.md. No unresolved intent questions remain.
