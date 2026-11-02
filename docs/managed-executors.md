# Managed Agent execution

Interlock can launch installed Claude Code and Codex harnesses when an Agent assignment becomes ready. The execution manager runs inside the existing server. Keep Interlock running; no separate worker or open chat is required. Connected MCP agents and manual completion remain available.

## Configure a harness

Open **Harnesses** in the sidebar. Interlock checks for `claude` and `codex` on the server's PATH and reads their version. **Detected** means an executable answered the version check, not that authentication or model access works. Checks make no model calls. Install and authenticate the harness using its supported native setup before starting work. Interlock does not collect credentials, install harnesses, or promise that every subscription supports unattended third-party execution. See [Claude Agent SDK authentication](https://platform.claude.com/docs/en/agent-sdk/overview) and [Codex authentication](https://developers.openai.com/codex/auth/).

Default configurations start disabled. Configure the working directory, optional model and permissions, then enable the profile. An omitted directory uses the server's working directory. Executable and directory overrides must be absolute paths. Advanced settings include concurrency, execution timeout, and declared tools/skills already available in the native harness. Capability declarations do not install tools or provide containment. Multiple configurations can use the same harness.

In **Workflow settings**, choose a **Default Agent executor**, save and publish. Agent **Execution → Executor** can inherit that default, choose another profile, or require a connected agent. In JSON, workflow `executor` is a profile ID. Agent `executor` overrides it; `null` selects connected-agent execution; omission inherits the workflow default. Existing definitions without these fields keep their behavior. Missing, disabled or incompatible profiles leave work unclaimed with a reason. References travel in workflow exports; local paths, settings and native sessions do not.

The manager discovers ready assignments globally, including work started by scripts or in detached workflows. It uses the existing exclusive claim path, so a connected worker and managed harness cannot own the same attempt simultaneously. Budgets, shared resources, output validation and retry limits still apply. Managed local Git trials remain blocked because these adapters do not implement the scoped-tool containment contract.

## Sessions and permissions

Ungrouped assignments start independent native sessions, including retries. A `current` assignment permits existing context; it does not inherit the conversation that started the workflow. A run-local `context.continuityGroup` reuses a manager-owned native session and serializes work in that group. `fresh` always starts independently and cannot use a continuity group. Existing externally bound groups are not silently adopted.

The profile is captured at first claim, retained on retries and pinned for a continuity group. Later profile edits affect unbound work. The actual native model, when reported, is recorded alongside the resolved executable and directory. Advisory model tiers do not automatically select native models in this release.

Claude Code uses the official Agent SDK with the installed executable and native user/project/local configuration. Codex uses its app-server protocol. Both retain native project instructions and supported authentication. **Ask when the harness needs approval** follows native permission rules; actions already allowed by native rules may proceed without an Interlock prompt. Interlock forwards requests that reach the host and does not enable a bypass mode or persist broader permission grants. **Read-only tools** restricts supported native tools, but does not isolate project startup hooks or make an untrusted repository safe.

Open the run inspector to answer a pending permission or question. **Allow once** or **Deny** applies to that exact active request. Native Codex additional sandbox-grant requests, session-wide file grants, secret-input requests and MCP elicitations are declined in this release. File approvals require captured paths and patches; incomplete approval details are declined. Questions allow custom answers only when the native request supports them. Human answers must come from the user, not another agent's guess.

Progress records contain bounded tool/status updates, not full conversations. Native output and error text can contain task data; use non-secret task inputs. Interlock records reported usage where available. Missing measurements stay unknown. Resumed cumulative counters are differenced when a baseline is known; uncertain resumed history is not charged again. Provider cost estimates are not account billing.

## Stop and recover

**Execution details → Stop execution** asks the native process to stop. Cancellation, a disabled profile, timeout, claim loss, server shutdown or restart can leave external effects uncertain. The assignment is held where possible, and another claim is blocked. Pending questions become cancelled.

Interlock attempts bounded process-group cleanup for both adapters, including children whose parent has exited. This is not an operating-system sandbox; assignments must stop their own background work before returning. Stop the old session and any surviving subprocesses, inspect external effects, then explicitly confirm that they stopped in the inspector. Reconciliation releases uncertain resource reservations and resumes held work with a fresh claim. It does not revive a cancelled run. Deleting history is blocked while managed execution is active or uncertain. Do not confirm merely because a lease expired or a process disappeared from Interlock.

Global concurrency is four assignments. Each profile allows 1–8, default 1, within that global limit. Execution timeout defaults to 30 minutes, accepts 1 second–24 hours, and includes human waiting. Claims renew before expiry. Explicit completed native failures and invalid results consume the existing failure budget. Transport loss and unexpected adapter errors hold the assignment for reconciliation; no unbounded repair loop is added. There are at most 20 local profiles and 100 human requests per execution. Inspection returns the latest attempt, up to 20 recent progress entries, pending requests and the last three resolved requests, plus at most ten compact older-attempt records.

## MCP and CLI

One `manage_executors` tool handles these operations through the shared server API. The CLI accepts the same request JSON with `interlock executors`, defaulting to read-only list. Examples:

```sh
interlock executors
interlock executors '{"action":"list","refresh":true}'
interlock executors '{"action":"save","profile":{"id":"codex","harness":"codex","name":"Codex","enabled":true,"cwd":"/absolute/project","expectedRevision":0}}'
interlock executors '{"action":"inspect","workId":"WORK_ID"}'
interlock executors '{"action":"respond","executionId":"EXECUTION_ID","requestId":"REQUEST_ID","answer":{"allow":false}}'
interlock executors '{"action":"stop","executionId":"EXECUTION_ID"}'
interlock executors '{"action":"reconcile","executionId":"EXECUTION_ID","confirmStopped":true}'
```

Save replaces a profile and requires its current revision as `expectedRevision`. Omit returned `revision` and `detection` fields. Keep existing settings when updating; omitted settings reset to defaults. New and unsaved built-in profiles use revision zero. Questions use `answer.answers` keyed by exact question IDs with arrays of chosen answers. Inspection never returns claim tokens. Work discovery includes compact `executor`/`managedExecution` fields, while briefing `next:inspect_executor` supplies a read-only inspection call for human attention. Neither discovery nor inspection starts a model call.

The initial adapters target macOS/Linux installations. Native account access, enterprise restrictions and CLI version compatibility still require validation in the user's environment. OpenCode, other harnesses, Channels, remote workers, automatic permission decisions and automatic harness installation are outside this increment.
