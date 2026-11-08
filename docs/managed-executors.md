# Managed Agent execution

Interlock can launch installed Claude Code, Codex, and Pi harnesses, as well as user-defined custom harnesses (`harness: "custom"`), when an Agent assignment becomes ready. The execution manager runs inside the existing server. Keep Interlock running; no separate worker or open chat is required. Connected MCP agents and manual completion remain available.

## Configure a harness

Open **Harnesses** in the sidebar. Interlock checks for `claude`, `codex`, and `pi` on the server's PATH and reads their version. **Detected** means an executable answered the version check, not that authentication or model access works. Checks make no model calls. Install and authenticate the harness using its supported native setup before starting work. Interlock does not collect credentials, install harnesses, or promise that every subscription supports unattended third-party execution. See [Claude Agent SDK authentication](https://platform.claude.com/docs/en/agent-sdk/overview), [Codex authentication](https://developers.openai.com/codex/auth/), and [Pi setup](https://pi.dev/).

Default configurations start disabled. Configure the working directory, optional model and default permissions, then enable the profile. An omitted directory uses the server's working directory. Executable and directory overrides must be absolute paths. Harness profiles and server settings can also declare `allowedRoots` (an array of absolute directory paths) to constrain dynamic and configured working directories. When `allowedRoots` are defined, working directories must resolve to an existing directory contained inside one of the declared roots; paths resolving outside `allowedRoots` or missing directories leave Agent assignments unclaimed with an explicit `cwd_blocked` blocker reason rather than falling back to default directories. In continuity groups, the resolved directory is pinned on initial session launch so subsequent assignments cannot shift the session directory. Native harness configuration supplies installed tools, MCP connections and skills. Interlock does not install or load them through harness settings. Advanced API/MCP profiles can retain tools/skills declarations for existing requirement matching; these are exact-name assertions, not verified inventories or instructions to invoke a skill. Unmet requirements leave assignments visibly blocked. Multiple configurations can use the same harness.

Harness rows summarize their saved model and permission defaults. **Configure** groups the editable fields into execution defaults and **Advanced settings**. **Configuration ID** is the stable reference workflows and MCP use; renaming the configuration does not change it. The detected native version appears with the executable path. Refreshing installation details preserves an open form’s edits; **Cancel** or **Cancel editing** discards them. Failed saves retain edits and offer **Reload configuration** to replace them with the saved values.

In **Workflow settings**, choose a **Default Agent executor** and **Agent permissions**, then save and publish. **Use harness default** inherits each selected profile’s default. An explicit **Read only**, **Standard** or **Full access** choice overrides the default for all managed Agents in this workflow, including node-specific executor selections. Connected agents retain their own permissions. The effective mode and its source appear beside the executor selection and in execution details. Agent **Execution → Executor** can inherit that default, choose another profile, or require a connected agent. In JSON, workflow `executor` is a profile ID. Agent `executor` overrides it; `null` selects connected-agent execution; omission inherits the workflow default. Workflow `agentPermissions` stores the optional override as `read-only`, `standard` or `full-access`; omission inherits the harness default. The published assignment captures the override, and later edits do not change existing attempts. Existing definitions without these fields keep their behavior. Missing, disabled or incompatible profiles leave work unclaimed with a reason. Executor references and workflow permission overrides travel in exports; local profile paths, defaults and native sessions do not.

Batch items use their owning workflow’s settings; invoked workflows use their own published settings. Agent permission modes do not restrict Script or Fetch execution.

The manager discovers ready assignments globally, including work started by scripts or in detached workflows. It uses the existing exclusive claim path, so a connected worker and managed harness cannot own the same attempt simultaneously. Budgets, shared resources, output validation and retry limits still apply. Managed local Git trials remain blocked because these adapters do not implement the scoped-tool containment contract.

## Choose a model

Harness **Default model** offers **Use CLI default**, models reported by the configured native harness, and custom model IDs. Catalogs load when you open the picker or configure thinking effort for a selected model; **Refresh models** bypasses the cache. Discovery initializes the native integration without sending a user prompt or starting an Agent turn. It uses the configured executable and working directory, including unsaved path edits in harness settings, and never claims work. Authentication and native startup policy still apply. Claude discovery disables ordinary hooks and configured MCP servers; administrator-required hooks can still run. Pi discovery disables extensions, MCP, skills, and project context files and uses an ephemeral session.

The picker reads Claude Code's SDK `supportedModels()`, Codex's app-server `model/list`, and Pi's RPC `get_available_models`, rather than a generic provider catalog. Lists can vary with the installed version, account and project configuration, and do not guarantee a later request will succeed. Catalogs return at most 100 models and cache for five minutes; failed reads cache for 30 seconds. Discovery is bounded to 15 seconds plus process cleanup and version detection. Failures preserve the saved model; refresh or enter a custom ID. No fallback model is substituted by Interlock.

Workflow **Agent model** offers **Use harness default** or an explicit model ID, stored as optional `agentModel`. Agent **Execution → Model** offers **Use workflow default** or a node-specific `model`. Model precedence is node, workflow, selected harness configuration, then native CLI default. These settings apply only to managed execution. For workflows using multiple harnesses, choose a default ID they all accept, override individual nodes, or inherit each harness’s model. Connected agents retain their own model. Batch items inherit their owning workflow; invoked workflows use their own setting. Publish to apply changes to new runs. Published assignments capture the selected override and source as `executorModel`/`executorModelSource`; retries and continuing sessions retain the resolved profile/model. Effective model and source appear in settings and execution details. The workflow override travels in exports; model catalogs and local profile defaults do not. Connected Agent nodes show the advisory **Model tier** control. Managed nodes show concrete **Model** and **Thinking effort** controls instead. Switching executors preserves hidden values without applying managed settings to connected agents. Existing advisory tiers are retained and never translated into native models or efforts.

### Thinking effort

Harness **Thinking effort** supplies a default. Workflow `agentEffort` and Agent `effort` optionally override it, in node → workflow → harness → native order. Omission inherits; explicit `null` selects **Use native default**, bypassing inherited effort. This allows a node to select another model without retaining an incompatible parent effort. Choose an explicit effective model to configure effort.

Effort choices come from Claude SDK `supportedEffortLevels` and Codex `supportedReasoningEfforts` in the same bounded model discovery. Pi reads `get_available_thinking_levels` after selecting each catalog model in its ephemeral discovery session. Pi model IDs include the provider, such as `openai/gpt-6-sol`; a custom bare ID must match exactly one available model. Codex's suggested `defaultReasoningEffort` is returned as metadata, not forced over native configuration. Missing metadata, custom model IDs and failed discovery do not invent choices. Explicit unsupported or unverifiable efforts leave work unclaimed with a reason; clear the effort or choose a supported model/level. Retrying the queued assignment reuses the cached discovery; **Refresh models** requests a new catalog. No thinking-token budget is introduced.

Published assignments retain `executorEffort` and `executorEffortSource`. The resolved profile and model/effort sources appear in execution details. Native defaults are labelled as such; Interlock does not claim to have measured a native default effort. Retries and continuing sessions retain their captured settings. A continuity group cannot silently change its pinned model or effort through a later explicit override; choose matching settings or another group.

## Sessions and permissions

Ungrouped assignments start independent native sessions, including retries. A `current` assignment permits existing context; it does not inherit the conversation that started the workflow. A run-local `context.continuityGroup` reuses a manager-owned native session and serializes work in that group. `fresh` always starts independently and cannot use a continuity group. The managed assignment prompt states that isolation is already established, so the native Agent performs the work in that session instead of delegating again to satisfy connected-worker handoff instructions. Existing externally bound groups are not silently adopted.

The profile is captured at first claim, retained on retries and pinned for a continuity group. Later profile edits affect unbound work. The actual native model, when reported, is recorded alongside the resolved executable and directory. Advisory model tiers do not automatically select native models in this release.

Claude Code uses the official Agent SDK with the installed executable and native user/project/local configuration. Codex uses its app-server protocol. Both retain native project instructions and supported authentication. **Standard** follows native permission rules; actions already allowed by native rules may proceed without an Interlock prompt. Interlock forwards requests that reach the host and does not persist broader permission grants. **Full access** explicitly selects Claude’s `bypassPermissions` with SDK bypass enablement, or Codex’s `danger-full-access` sandbox with `never` approvals. It permits file changes and commands without routine approval stops. Native deny rules, mandatory questions and organization restrictions still apply. **Standard** maps to Claude’s default mode and Codex’s workspace-write sandbox with untrusted-command approvals. Codex Read only uses its read-only sandbox without permission escalation. **Read only** restricts supported native tools, but does not isolate project startup hooks or make an untrusted repository safe.

Pi uses its native RPC protocol and retains native authentication, project instructions, extensions, MCP connections, and skills. The adapter is tested with Pi 1.1.0 and requires `agent_settled`, exact session selection, and RPC extension dialogs. Interlock loads a temporary permission extension and verifies that it registered before sending the assignment. **Read only** allows Pi's `read`, `grep`, `find`, and `ls` tool names and blocks other tool calls, including MCP tools. **Standard** allows those read tools and asks for approval before every other tool call. **Full access** removes Interlock's tool approval check; installed Pi extensions can still deny actions. Trusted startup code and extensions run outside this tool policy, so these modes are not an OS sandbox. Pi extension confirmations and select, input, or editor dialogs appear in the run inspector. Pi must return a JSON result envelope; Interlock validates the unwrapped result through the ordinary submission path.

The badge beside **Runs** counts runs waiting for a human response, replacement model, or recovery confirmation. Use the **Needs attention** tab to open the relevant assignment. Owned child work counts under its parent; detached runs count independently. Normal execution queues do not trigger the badge.

Open the run inspector and choose **Review request** to answer a pending permission or question. When several steps need a response, the review menu lists them by assignment and item. The selected assignment appears before step data and technical details. Its status distinguishes waiting for your response from an agent working. **Allow once** or **Deny** applies to that exact active request. Native Codex additional sandbox-grant requests, session-wide file grants, secret-input requests and MCP elicitations are declined in this release. File approvals require captured paths and patches; incomplete approval details are declined. Questions allow custom answers only when the native request supports them. Human answers must come from the user, not another agent's guess.

Progress records contain bounded tool/status updates, not full conversations. Native output and error text can contain task data; use non-secret task inputs. Interlock records reported usage where available. Missing measurements stay unknown. Pi aggregates response usage for each assignment, including continued sessions. Resumed cumulative counters from other harnesses are differenced when a baseline is known; uncertain resumed history is not charged again. Provider cost estimates are not account billing.

## Custom harnesses

Interlock supports user-defined custom harnesses (`harness: "custom"`) to execute external agent CLI tools, standalone scripts, or desktop/hosted agent applications. Custom profiles support two execution modes:

- **Direct Turn Mode (`mode: "direct"`)**: Interlock manages the assignment claim, renews the claim lease, executes the command or HTTP endpoint, and submits the returned result envelope.
- **Delegated Claim-Ticket Mode (`mode: "launcher"`)**: Interlock launches an external session and issues a one-time `claimTicket`. The launched session claims the work via MCP `claim_work` using this ticket, executes autonomously, and submits its own result.

### Direct Turn Mode

Direct turn mode executes a subprocess command (`turnCommand`) or HTTP POST endpoint (`turnUrl`). Interlock passes assignment context JSON via stdin or the HTTP request body:

```json
{
  "idempotencyKey": "UUID",
  "workId": "WORK_ID",
  "attempt": 1,
  "prompt": "COMPOSED_PROMPT",
  "input": {},
  "outputSchema": {},
  "cwd": "/path/to/workdir",
  "model": "model-id",
  "effort": "high",
  "permissions": "standard",
  "sessionName": "run-label",
  "sessionId": "CONTINUITY_SESSION_ID"
}
```

The command or HTTP endpoint must return a JSON result envelope:

```json
{
  "output": { ... },
  "sessionId": "optional-session-id",
  "model": "optional-model",
  "provider": "optional-provider",
  "usage": { "promptTokens": 100, "completionTokens": 50 }
}
```

Interlock validates `output` against `outputSchema` and submits the result. A non-zero process exit code or HTTP error status records an execution failure and consumes an attempt according to the workflow's retry policy.

### Delegated Claim-Ticket Mode (Launcher)

Launcher mode delegates execution to an external agent application (such as a desktop app or standalone agent runner). Interlock executes `launchCommand` or HTTP POST `launchUrl`, providing the assignment context and a one-time `claimTicket`.

- **Claim Ticket Authorization**: Interlock records the `claimTicket` bound exclusively to `workId`. Only the launched session presenting this exact ticket to MCP `claim_work` can claim the assignment. Any other claimant is rejected with an authorization error. Upon successful claim, the ticket is consumed.
- **Launch Idempotency**: Replaying a launch with the same `idempotencyKey` returns the existing session handle, avoiding duplicate process launches on retries.
- **Lifecycle Hooks**: Custom launcher profiles can define optional lifecycle hooks (via subprocess command or HTTP POST endpoint):
  - `statusCommand` / `statusUrl`: Interlock polls session state (`working`, `idle`, `needs_attention`, `ended`).
  - `messageCommand` / `messageUrl`: Delivers idle nudges or recovery instructions to the external session.
  - `stopCommand` / `stopUrl`: Requests the external session to stop on assignment cancellation or server shutdown.
  - `archiveCommand` / `archiveUrl`: Invoked when the session's final assignment in the run completes.

### Template tokens and working directories

Command lines and HTTP URLs support environment variable token replacement:

- `$INTERLOCK_WORK_ID`
- `$INTERLOCK_RUN_ID`
- `$INTERLOCK_EXECUTION_ID`
- `$INTERLOCK_NODE_ID`
- `$INTERLOCK_SESSION_ID`
- `$INTERLOCK_CWD`
- `$INTERLOCK_CLAIM_TOKEN`
- `$INTERLOCK_CLAIM_TICKET`
- `$INTERLOCK_SESSION_NAME`

Custom harness commands do not require absolute executable paths; binary names resolved from `PATH` and arbitrary shell commands are permitted. Configured and dynamic `cwd` values must resolve to an existing directory contained inside the declared `allowedRoots`.

## Session visibility: name templates, deep links and live tail

Managed execution surfaces native session identity, inspection shortcuts, and active progress tail across the UI, API, and MCP tools (`manage_executors` action `inspect`, run briefings).

### Session name templates

Workflows and executor profiles can provide human-readable session names passed to native harnesses (such as Pi's `--session-name` or custom launchers via `$INTERLOCK_SESSION_NAME` and `sessionName` payload fields). Session names are evaluated from run context:

- `{{externalTask.id}}` - External task identifier (e.g. `243`)
- `{{externalTask.title}}` - External task title
- `{{node.label}}` - Current workflow node label
- `{{node.id}}` - Current workflow node ID
- `{{runId}}` - Current workflow run ID
- `{{workId}}` - Current work assignment ID
- `{{session.id}}` - Session identifier

Precedence follows: **Agent node override** (`node.sessionNameTemplate`) > **Workflow default** (`workflow.sessionNameTemplate`) > **Profile default** (`profile.sessionNameTemplate`). Unresolved mustache tags gracefully fall back to blank.

### Resume commands and deep links

When an agent session runs, Interlock captures its native session ID and resolves copyable resume commands and clickable deep links:

- **Built-in CLI harnesses**:
  - Claude Code: `claude resume <sessionId>`
  - Pi: `pi --session <sessionId>`
- **Custom harnesses**: Custom profiles configure templates using `{{sessionId}}`, `{{runId}}`, `{{workId}}`, etc.:
  - `resumeCommandTemplate`: e.g. `my-cli resume {{sessionId}}`
  - `deepLinkTemplate`: e.g. `https://agent-cloud.internal/sessions/{{sessionId}}` or `app://sessions/{{sessionId}}`
- **Launcher status hook**: Custom launchers returning `resumeCommand` or `deepLink` in status poll responses update inspection dynamically.
- **Security & Sanitization**: Deep links allow only safe URI protocols (`http:`, `https:`, and custom app schemes like `vscode:`, `app:`). Dangerous schemes (such as `javascript:` or `data:`) are rejected and omitted. Claim tokens and credentials are never exposed in resume commands, deep links, or session names.

### Live progress tail buffer

The executor manager maintains an in-memory ring buffer of the latest 20 progress messages per session. During active execution, the Run Inspector displays this live tail to monitor agent progress in real time without persisting unbounded stdout/stderr logs.

## Replace a refused model

A recognized model-unavailable or unsupported-model error before task actions places the assignment on hold with **Choose a model** status. Interlock confirms native process cleanup and releases the attempt's resource reservations. The run retains completed work and waits for a replacement. This hold survives server restart, uses no execution slot, and does not consume the Agent failure budget. Authentication, quota, unknown transport failures, and model errors after task actions retain their existing failure or interruption handling.

Open **Choose a model**, select or enter an exact replacement model ID, then choose **Retry with selected model**. Discovery offers native catalog entries, not proof of account access. A refused replacement returns to the same selection flow. Each retry requires an explicit choice; Interlock never automatically substitutes a model.

The retry uses a fresh claim and normal concurrency, resource, timer, and run-budget admission. It resets thinking effort to the replacement's native default and preserves captured permissions, tools, directory, executable, and assignment input. Ungrouped work starts independently. A continuity group retains its native session and uses the replacement for subsequent assignments with matching captured intent. Conflicting explicit overrides remain blocked. Execution details label the model and effort as selected/reset for recovery. Earlier attempts retain their original settings.

Use `manage_executors` action `retry_model` with the exact `executionId` and human-selected `model`. Generic hold resume and ordinary claims cannot bypass model selection. Repeating the same accepted selection is idempotent; stale, changed-hold, or cancelled requests reject. Published definitions, local harness defaults, and native CLI configuration are not edited.

## Stop and recover

**Stop agent** beside the selected assignment asks the native process to stop. [Tree cancellation](workflow-execution.md#cancel-a-run-tree) applies the same stop and recovery boundary to all selected managed assignments, including detached descendants only when explicitly included. Cancellation, a disabled profile, claim loss, server shutdown or restart can leave external effects uncertain. The assignment is held where possible, and another claim is blocked. Pending questions become cancelled.

Delegated launches persist a `starting` execution before dispatch. Cancellation during the launch keeps that execution as a quiescence blocker. A late launch response does not grant a usable claim ticket and requests the configured stop operation. Cancellation also stops already launched sessions before archiving them. The stop request or response does not release uncertain ownership. After the launch and stop operations settle, verify the exact remote session and subprocesses stopped, then reconcile its `executionId`. A launch cancelled before its first claim has no resource reservation to release, but still requires that stop confirmation.

### Recovery policies

Managed execution supports automated recovery policies configured across three precedence levels: **Agent node override** > **Workflow definition default** > **Harness profile default** (defaulting to 0 / disabled).

- **Missing result continuation (`continueOnMissingResult`)**:
  - `maxTurns` (0–10, default 0): Number of continuation prompts to send within the same native session when an agent turn finishes without returning a valid structured result envelope (`{ "result": ... }`).
  - `message` (optional): Custom prompt instructing the agent to return the required output schema envelope. Defaults to standard schema guidance.
  - When continuation turns are exhausted without a valid result, the attempt fails cleanly with a descriptive error.
- **Transient retry (`transientRetry`)**:
  - `maxRetries` (0–10, default 0): Maximum retry attempts for transient errors within a rolling window before escalating.
  - `windowMs` (ms, default 300,000 / 5 min): Rolling time window for transient retry counting. Active pause holds (H3 pause state) are excluded from elapsed time calculations.
  - `initialBackoffMs` (ms, default 1,000): Base exponential backoff delay (`initialBackoffMs * 2^retryCount`). Delays freeze while a run is paused.
  - When transient retries exceed `maxRetries` within the rolling window, the work escalates to a **Needs attention** hold (category `other`) with checkpointed diagnostics, pausing execution for operator review rather than failing the attempt or looping indefinitely.
- **Error classification**:
  - **Permanent errors**: Billing, quota, authentication, bad request (HTTP 400), context length exceeded, content policy violations, and model refusals (`needs_model`) are rejected immediately without retry.
  - **Transient errors**: Network drops (`ECONNRESET`, `ETIMEDOUT`, `fetch failed`), request timeouts, rate limits (HTTP 429), and server errors (HTTP 500, 502, 503, 504, overload) are eligible for transient backoff retries.
  - **Missing result**: Turns ending without a valid output envelope trigger session continuation before attempt failure.
- **Recovery event telemetry**:
  - Recovery attempts record telemetry events (`errorClass: "transient" | "permanent" | "missing_result"`, `messageExcerpt`, `action: "continue" | "retry" | "escalate" | "fail"`, `at: string`) on the attempt record, visible in execution details and Run Inspector.

Interlock attempts bounded process-group cleanup for all adapters, including children whose parent has exited. This is not an operating-system sandbox; assignments must stop their own background work before returning. Stop the old session and any surviving subprocesses, inspect external effects, then explicitly confirm that they stopped in the inspector. **How to check this session** shows the directory and native session identity. **Retry assignment** reconciles a held assignment and queues a new attempt. A cancelled assignment offers **Confirm stopped** to release reservations without restarting the run. Reconciliation releases uncertain resource reservations and resumes held work with a fresh claim. It does not revive a cancelled run. Deleting history is blocked while managed execution is active or uncertain. Do not confirm merely because a lease expired or a process disappeared from Interlock.

A managed attempt can retain `needs_human` after its harness ended, for example when recovery retries are exhausted. If the attempt has `endedAt` and no pending permission or question requests, use MCP `manage_executors` or `interlock executors` with `action: "reconcile"`, its exact `executionId`, and `confirmStopped: true`. First verify that the session and subprocesses stopped. Reconciliation rejects until active jobs and stop operations settle. An ended `needs_human` attempt with pending human requests rejects. It clears the ended managed blocker so a [quiescent event trigger](events.md#quiescent-teardown) can dispatch. It does not revive a cancelled run or reset failure and claim budgets.

**Concurrent assignments** at the top of Harnesses offers a dropdown with **Limit to** and a positive whole-number field, or **Unlimited**, which hides the number field. The default is **Limit to 3**. There is no eight-assignment ceiling. Unlimited starts every ready managed assignment that meets the normal execution requirements; resource coordination, continuity and workflow sequencing still apply. Additional assignments wait for capacity. Raising the limit can start queued work immediately. Lowering it lets active assignments finish and delays new starts until there is room. Workflow settings show the shared limit and link back to Harnesses. Each profile can also set **Concurrent assignments** to a positive whole number. Leave the field blank for no profile limit, represented by omitted or null `concurrency`. Both the shared and current profile limits must permit a new dispatch. A saturated profile does not prevent other profiles from using available shared slots. Profile changes affect new dispatches without interrupting active work; historical attempts retain their captured configuration. Delegated launchers count from pending launch through the active assignment, including the period before ticket claim. Workflow `maxActiveRuns` separately limits admitted workflow runs; see [start admission](idempotent-run-starts.md#queue-starts-until-capacity-is-available). Assignments waiting for human input still occupy a slot. Connected agents, manual claims and Batch item-path concurrency retain their existing behavior. In MCP/API settings, `concurrency` is the positive numeric limit or `null` for Unlimited; zero is invalid. The setting stays local and persists across server restarts; it is excluded from workflow exports. Existing stored profile `concurrency` values remain in effect after upgrade. Clear the profile field to remove its limit. Agent `maxExecutionMs` optionally bounds total active duration per claim attempt. Omission leaves duration unlimited. Named pauses and declared holds, including `needs_human`, are excluded. Claims renew before expiry; they are ownership leases, not task deadlines. Native harness and provider limits still apply. Existing Script/Fetch execution timeouts and optional unclaimed Agent deadlines retain their behavior. Explicit completed native failures and invalid results consume the existing failure budget, except recognized early model refusals, which wait for an explicit replacement selection. Transport loss and unexpected adapter errors hold the assignment for reconciliation; no unbounded repair loop is added. There are at most 20 local profiles and 100 human requests per execution. Inspection returns the latest attempt, up to 20 recent progress entries, pending requests and the last three resolved requests, plus at most ten compact older-attempt records.

## MCP and CLI

One `manage_executors` tool handles these operations through the shared server API. The CLI accepts the same request JSON with `interlock executors`, defaulting to read-only list. Examples:

```sh
interlock executors
interlock executors '{"action":"settings"}'
interlock executors '{"action":"save_settings","concurrency":3,"allowedRoots":["/worktrees"],"expectedRevision":0}'
interlock executors '{"action":"save_settings","concurrency":null,"expectedRevision":1}'
interlock executors '{"action":"list","refresh":true}'
interlock executors '{"action":"models","profileId":"codex","refresh":true}'
interlock executors '{"action":"save","profile":{"id":"codex","harness":"codex","name":"Codex","enabled":true,"cwd":"/worktrees/default","allowedRoots":["/worktrees"],"expectedRevision":0}}'
interlock executors '{"action":"save","profile":{"id":"custom-direct","harness":"custom","name":"Custom Turn","enabled":true,"mode":"direct","transport":"subprocess","turnCommand":"node ./agent-turn.js","cwd":"/worktrees/default","expectedRevision":0}}'
interlock executors '{"action":"save","profile":{"id":"custom-launcher","harness":"custom","name":"Custom Launcher","enabled":true,"mode":"launcher","transport":"subprocess","launchCommand":"node ./launcher.js launch","statusCommand":"node ./launcher.js status","cwd":"/worktrees/default","expectedRevision":0}}'
interlock executors '{"action":"inspect","workId":"WORK_ID"}'
interlock executors '{"action":"respond","executionId":"EXECUTION_ID","requestId":"REQUEST_ID","answer":{"allow":false}}'
interlock executors '{"action":"retry_model","executionId":"EXECUTION_ID","model":"openai/gpt-6.1-sol"}'
interlock executors '{"action":"stop","executionId":"EXECUTION_ID"}'
interlock executors '{"action":"reconcile","executionId":"EXECUTION_ID","confirmStopped":true}'
```

Profile `permissions` defaults to `standard`; `read-only` and `full-access` are also supported. The previous draft value `ask` is accepted and normalized to `standard` without changing saved revisions. Save replaces a profile and requires its current revision as `expectedRevision`. Omit returned `revision` and `detection` fields. Keep existing settings when updating; omitted settings reset to defaults. New and unsaved built-in profiles use revision zero. Questions use `answer.answers` keyed by exact question IDs with arrays of chosen answers. Inspection never returns claim tokens. Work discovery includes compact `executor`/`managedExecution` fields, while briefing `next:inspect_executor` supplies a read-only inspection call for human attention. Neither discovery nor inspection starts a model call.

The initial adapters target macOS/Linux installations. Native account access, enterprise restrictions and CLI version compatibility still require validation in the user's environment. OpenCode, other harnesses, Channels, remote workers, automatic permission decisions and automatic harness installation are outside this increment.

## Execution provenance and anti-spoofing

Interlock records verified execution provenance on every completed node execution:

```json
{
  "profileId": "codex",
  "harness": "codex",
  "sessionId": "native-session-123",
  "requestedModel": "gpt-4o",
  "actualModel": "gpt-4o-2024-08-06",
  "provider": "openai",
  "effort": "medium",
  "attempt": 1,
  "visitCount": 1,
  "startedAt": "2026-11-07T10:00:00.000Z",
  "endedAt": "2026-11-07T10:00:15.000Z",
  "usage": [
    {
      "provider": "openai",
      "model": "gpt-4o-2024-08-06",
      "inputTokens": 100,
      "outputTokens": 50
    }
  ]
}
```

- **Verified source of truth**: Provenance is populated directly from the engine state and executor manager records upon node acceptance.
- **Anti-spoofing**: Workers cannot overwrite, inject, or spoof provenance fields in their output envelope. Input bindings and branch routing read from verified provenance rather than agent output.
- **Exposed in data bindings and Branch conditions**: Downstream steps can bind provenance fields via `source: "execution"`. Standalone Branch and Switch nodes can evaluate `execution.<nodeId>.<path>` directly (e.g. `execution.agentStep.actualModel`).
- **Loop visit count**: `visitCount` records the 1-based completed execution count of `<nodeId>` in the current run and Batch scope, enabling direct loop counting and termination without pass-through state.
- **Script injection**: Foreground and background scripts receive `INTERLOCK_EXECUTION_PROVENANCE_FILE` containing all prior node execution records.

## Provider diversity constraints (`distinctProviderFrom`)

Multi-agent code review and verification workflows require review steps to execute on distinct model providers from the author and preceding reviewers (for example, Anthropic vs. OpenAI vs. Google). Interlock supports declarative provider diversity constraints directly on Agent nodes without external glue scripts.

### Configuration

On any `kind: "agent"` node:

- `distinctProviderFrom: string[]`: Upstream Agent node IDs whose executing model providers must differ from this step.
- `candidateModels?: string[]`: Ordered candidate models or profile targets to evaluate against diversity constraints.

```json
{
  "id": "reviewer",
  "kind": "agent",
  "label": "Independent Reviewer",
  "prompt": "Review the author's implementation...",
  "distinctProviderFrom": ["author"],
  "candidateModels": ["claude-3-7-sonnet", "gpt-4o", "gemini-2.0-flash"]
}
```

### Deterministic selection and resolution order

At dispatch time, Interlock iterates through candidate models in order and selects the first candidate whose provider does not collide with the actual providers recorded in execution provenance by completed executions of referenced upstream nodes:

1. **Catalog & Slash notation**: Model strings containing a slash (e.g. `anthropic/claude-3-5-sonnet`, `openai/gpt-4o`) extract the substring preceding `/`.
2. **Profile explicit provider**: Explicit `provider` declared on an executor profile.
3. **Configurable prefix table**: Server settings in `providerPrefixes` extending or overriding default mappings.
4. **Built-in prefix defaults**:
   - `claude*` -> `anthropic`
   - `gpt*`, `chatgpt*`, `o1*`, `o3*`, `o4*` -> `openai`
   - `gemini*` -> `google`
   - `deepseek*` -> `deepseek`
   - `mistral*`, `codestral*` -> `mistral`
   - `qwen*` -> `alibaba`
   - `llama*` -> `meta`

### Anti-collusion and blocker semantics

Interlock guarantees that review steps never silently fall back to an excluded provider:

- **`provider_diversity_unmet`**: If any referenced upstream node has not executed yet or its provider cannot be determined, the work remains unclaimed.
- **`provider_diversity_exhausted`**: If all candidate models belong to excluded providers, or if a pinned continuity group session provider collides with upstream providers, the work remains unclaimed with this blocker reason.
- Attempting to claim blocked work or claiming with a conflicting model/provider is rejected.

## Test an installed Pi

After authenticating Pi, run the opt-in live check from a checkout:

```sh
pnpm exec tsx scripts/pi-smoke.ts openai/gpt-6-sol
```

Choose an exact model your account supports, or omit the model to use Pi's native default. The check uses a temporary database and working directory. It starts two Agent assignments, reads a generated nonce with Pi's read tool, and verifies that the second assignment recalls it in the same native session. It makes real model calls and leaves native Pi session history. It does not run in routine tests or use your Interlock database.

## Recover an idle launcher

A claimed-idle stall remains observational unless an effective `idleRecovery` policy enables recovery. Configure it alongside a positive `claimedIdleStallMs` at library, workflow or node scope. Node fields override workflow fields, then library defaults; `null` disables inheritance.

```json
{
  "claimedIdleStallMs": 300000,
  "idleRecovery": {
    "maxRecoveries": 2,
    "message": "Continue the assignment and return its required result, or report the blocker."
  }
}
```

`maxRecoveries` accepts 0 through 10 and defaults to 0. The optional message defaults to a request to continue or report the blocker and accepts 1 through 4,000 characters. Automated recovery currently requires a custom launcher with `message`, `stop` and `status` operations. Native/direct adapters retain stalled attention for operator recovery. Repeated idle status polls alone no longer send unsolicited messages.

When status is `idle` and no claim progress or renewal has occurred for the active threshold, Interlock sends the configured message once. If another active threshold elapses without progress or renewal, it calls `stop`, then requires `status: "ended"` before releasing the session and redispatching through ordinary admission. Message and stop delivery have a ten-second operation timeout. Delivery errors or an unconfirmed stop hold work for explicit reconciliation. A missing operation leaves stalled attention visible.

The recovery count is persisted on the assignment and does not reset across claim attempts or renewals. A nudge spends one recovery allowance even if delivery is uncertain. Inspection records idle recovery actions as `nudge` and `relaunch` with bounded excerpts. Confirmed stop/relaunch also spends the ordinary Agent attempt allowance. Reaching the cap leaves the stalled item for inspection. Claims, run budgets, resources, pause admission, profile caps and claim tickets retain their existing checks. Each relaunch creates a fresh ticket, and a stale token cannot submit the new attempt. Interlock does not promise restoration of an external provider session. Grouped sessions retain their identity constraints.

A renewal or progress callback cancels pending escalation. Completion, a hold or a changed claim prevents a stale asynchronous response from redispatching work. Pause time is excluded from both idle intervals and no recovery starts while paused. Restart treats the old managed session as uncertain and requires the existing stop confirmation; it never replays a persisted nudge or stop as proof of safety. See [active clocks](timers.md#stall-detection-and-active-attempt-deadlines).

Active execution deadline revocation also interrupts managed supervision. Retryable work is held with recovery attention, and exhausted work retains recovery attention when stop confirmation is still needed. A configured launcher stop operation is requested, but its response alone does not clear uncertain ownership. Confirm the session and subprocesses stopped through `reconcile`. Reconciliation waits for an in-flight stop operation to settle, releases exact-attempt reservations and permits a fresh ticket only for work that can still run. It does not reset failure or claim budgets. Late nudge failures and stale status responses cannot revive the revoked attempt.

## Model aliases

Workflows and Agent nodes can reference logical model aliases (e.g. `builder`, `reviewer`, `evaluator`) instead of hardcoded model IDs. Aliases map to an ordered list of candidate targets:

```json
{
  "name": "reviewer",
  "description": "Code and architecture review alias",
  "candidates": [
    {
      "model": "claude-3-7-sonnet",
      "effort": "high",
      "profileId": "claude-code"
    },
    { "model": "gpt-4o", "effort": "medium" }
  ]
}
```

- **Referencing aliases**: Use an alias anywhere a model ID is accepted, including workflow `agentModel`, Agent node `model`, Agent node `candidateModels`, and `distinctProviderFrom` constraints.
- **Candidate fallback**: Candidates are evaluated in declared order. The first candidate whose executor profile is available and enabled (or unconstrained) and matches any applicable provider diversity constraint is selected.
- **Run-start pinning**: Runs capture resolved alias definitions and revisions at start time in `modelAliasCaptures` (alongside `variableCaptures`). Editing or deleting an alias mid-run never mutates active runs; continued runs and batch items inherit the pinned captures.
- **Report attribution**: Assignments retain the selected captured alias revision and candidate; claim receipts preserve it for performance reports. Reported usage keeps its supplied model/provider. Legacy/native assignments and run-level overhead remain unassigned. See [report attribution](usage-reporting.md#metrics-and-limits).
- **Portable bundles**: Bundles export alias requirements (`modelAliases: [{ name: "reviewer" }]`) without local candidate overrides or private profile IDs (format version 6).
- **Management tool**: Manage aliases with the `manage_model_aliases` tool (`create`, `update`, `delete`, `list`, `inspect`). Updates and deletion require `expectedRevision`.
