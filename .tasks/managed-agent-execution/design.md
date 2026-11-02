# Managed Agent execution

## Confirmed scope

Issue #71. Direct implementation, explicitly selected by the user. Claude Code and Codex are required; OpenCode is deferred because native permission, session and recovery behavior deserves its own adapter validation. No Channels or separate monitoring daemon. Use Impeccable for the UI and preserve Interlock's established Mantine identity. The user requested a draft PR while implementation is in progress.

## Architecture

- Portable optional workflow executor reference, with Agent override and explicit null for connected-agent execution. Existing definitions keep their behavior.
- Local revisioned profiles and attempt/session records. No workflow credentials, paths or native sessions in portable exports.
- Server-owned execution manager subscribes to Store changes, with a one-second recovery check. It observes available work without advancing the engine, preventing a notification/pump feedback loop that starves script process completion.
- Shared claim, renewal, budget, resource, usage, submission and bounded failure paths. Adapters own native protocols and never claim/submit independently.
- Claude Agent SDK core with explicit installed executable. Codex app-server over stdio. Installed CLI discovery/version checks make no model calls.
- Independent ungrouped/fresh sessions; manager-owned logical continuity bindings map to native sessions and pin configuration within the run/group.
- Explicit native permission/question responses. Additional Codex sandbox grants and MCP elicitation decline. Read-only tool restrictions are not startup-hook containment.
- Interrupted execution is held and blocks fresh claims until explicit confirmation that the prior session/subprocesses stopped. Native processes are cancelled on disablement, claim loss and shutdown.
- One grouped MCP tool and corresponding CLI/shared API, with compact work status and on-demand bounded execution details. Local Git trials remain blocked for these adapters until their scoped-executor contract can be met.

## Validation and remaining work

The additional review is recorded in [review.md](review.md). Independent standards and specification reviewers found and verified fixes for process cleanup, uncertain replay, restart usage attribution and captured settings. Parent integration checks added claim/approval expiry guards, scoped native approvals, question validation, finite shutdown and diagnostic draining. The full suite passed 1,158 tests, followed by a focused native check for the last turn-identity guard. Build, package and formatting checks are repeated before pushing. Tests use deterministic native stand-ins, never real accounts.

Before marking ready: finish rendered desktop/mobile checks and Impeccable finish review/documentation. Verify real Claude Code and Codex authentication/permissions deliberately in supported environments; fixture tests do not establish enterprise/subscription compatibility. Keep the patch changeset pending.

## Permission settings clarification

The user meant workflow settings, not a new workspace concept. Harnesses define default Read only, Standard or Full access permissions. Workflow `agentPermissions` optionally overrides the selected harness default for managed Agent nodes, including node-specific executor selections; connected execution keeps its native permissions. The default workflow choice is Use harness default. Effective mode/source appear beside selectors and in execution provenance. Old draft profile `ask` values normalize to Standard. Published assignments retain their captured override, and retries/continuity retain resolved settings. Full access selects native bypass/broad-access controls explicitly, with existing native deny and organization rules retained.

The permission settings extension received an Impeccable finish-review `ship` verdict after desktop/mobile captures and an empty detector pass. The documenter comparison is in [permissions-ui-review.md](permissions-ui-review.md). This verdict covers harness and workflow permission settings, not the entire run approval/recovery UI. The updated full suite passed 1,172 tests; native mode mapping and MCP set/unset tests use stand-ins without model calls.

## Final runtime-limit scope

The user explicitly dropped Agent runtime limits. The 30-minute harness cutoff and its control are removed; no workflow time-limit setting is introduced. Managed assignments continue until completion, explicit failure, cancellation, profile disablement or claim loss. Claims keep renewing while work or human input is pending. Retired timeoutMs values in earlier draft local profiles and continuity snapshots are ignored when resolving current execution; historical records are not rewritten. Existing Script/Fetch timeouts, optional unclaimed Agent deadlines and renewable leases retain their shipped behavior. Concurrency stays a shared per-harness-configuration capacity limit with no workflow override.

## Native model discovery and workflow defaults

The user approved native model pickers with custom IDs and an optional workflow `agentModel` override. Harness model omission uses the CLI default; workflow omission inherits each selected harness default. The existing advisory context tier does not select a concrete model. Runtime captures overrides on published assignments and retains resolved profiles for retries/continuity. The shared API exposes one bounded models operation inside manage_executors and an equivalent UI query. Catalogs are queried on demand, cached by harness/executable/directory, and never start an Agent turn. No new MCP tool or global discovery payload is added. Native startup and managed policy can still apply during discovery.

## Final shared concurrency decision

The user replaced both prior concurrency controls with one app-wide managed-assignment limit at the top of Harnesses, default 3, range 1–8. It spans all configurations and workflows, with a read-only workflow hint linking back. No per-profile limit or hidden four-job cap remains. Lowering allows in-flight work to finish; raising admits queued work. Persist settings with revision protection; settings are local and not exported. Earlier draft profile/snapshot concurrency fields are ignored. Existing connected-agent claim behavior and continuity exclusions are unchanged.

## Unlimited assignment option

The user approved explicit Limited/Unlimited choices, with Limited to 3 remaining the default. Limited accepts positive whole numbers without the prior ceiling of 8; numeric values must be exactly representable as JavaScript safe integers. Unlimited persists as concurrency:null, never zero. Runtime removes only the shared admission cap; claim requirements, exclusive resources, continuity, workflow sequencing and native policies remain in force. Returning to Limited leaves current work running and waits for capacity. Workflow settings show the actual Limited or Unlimited state.

## Concurrency dropdown refinement

The user reviewed the side-by-side radios and approved a compact native dropdown instead. Options are Limit to and Unlimited; the positive numeric field is shown only for Limit to. On narrow screens the dropdown sits above the number and Save action. The canonical numeric/null settings contract and default of 3 are unchanged.
