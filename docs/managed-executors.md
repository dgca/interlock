# Managed Agent execution

Interlock can launch installed Claude Code, Codex, and Pi harnesses, as well as user-defined custom harnesses (`harness: "custom"`), when an Agent assignment becomes ready. The execution manager runs inside the existing server. Keep Interlock running; no separate worker or open chat is required. Connected MCP agents and manual completion remain available.

## Configure a harness

Open **AI Settings → Harnesses**. Interlock checks for `claude`, `codex`, and `pi` on the server's PATH and reads their versions. **Detected** means the version check passed. It does not verify authentication or model access. Install and authenticate the harness using its native setup. See [Claude Agent SDK authentication](https://platform.claude.com/docs/en/agent-sdk/overview), [Codex authentication](https://developers.openai.com/codex/auth/), and [Pi setup](https://pi.dev/).

Each built-in harness and custom integration has one row. Choose **Edit defaults** to set its model, thinking effort, and permissions. Use **Advanced settings** for the executable path, working directory, and per-harness assignment limit. An omitted directory uses the server's working directory. Executable and directory overrides must be absolute paths. Use **Add integration** to open the custom harness editor. To reopen an existing configuration, expand **Edit defaults** and choose **Edit integration**.

Built-in harness IDs are `claude-code`, `codex`, and `pi`. Existing named configuration IDs still resolve in workflows and presets. The API and MCP can still inspect and update them. Local profiles and server settings can declare `allowedRoots`. An invalid or out-of-bounds directory leaves the assignment unclaimed with a `cwd_blocked` reason. A continuity group pins the directory when its session starts. Advanced profiles can declare tool and skill names for requirement matching. Interlock does not install or verify those capabilities.

In **Workflow settings**, choose a **Default Agent executor** and **Agent permissions**, then save and publish. **Use harness default** inherits each selected profile’s default. An explicit **Read only**, **Standard** or **Full access** choice overrides the default for all managed Agents in this workflow, including node-specific executor selections. Connected agents retain their own permissions. The effective mode and its source appear beside the executor selection and in execution details. Agent **Execution → Executor** can inherit that default, choose another profile, or require a connected agent. In JSON, workflow `executor` is a profile ID. Agent `executor` overrides it; `null` selects connected-agent execution; omission inherits the workflow default. Workflow `agentPermissions` stores the optional override as `read-only`, `standard` or `full-access`; omission inherits the harness default. The published assignment captures the override, and later edits do not change existing attempts. Existing definitions without these fields keep their behavior. Missing, disabled or incompatible profiles leave work unclaimed with a reason. Executor references and workflow permission overrides travel in exports; local profile paths, defaults and native sessions do not.

Batch items use their owning workflow’s settings; invoked workflows use their own published settings. Agent permission modes do not restrict Script or Fetch execution.

The manager discovers ready assignments globally, including work started by scripts or in detached workflows. It uses the existing exclusive claim path, so a connected worker and managed harness cannot own the same attempt simultaneously. Budgets, shared resources, output validation and retry limits still apply. Managed local Git trials remain blocked because these adapters do not implement the scoped-tool containment contract.

## Choose a model

Harness **Default model** offers **Use CLI default**, models reported by the configured native harness, and custom model IDs. Catalogs load when you open the picker or configure thinking effort for a selected model; **Refresh models** bypasses the cache. Discovery initializes the native integration without sending a user prompt or starting an Agent turn. It uses the configured executable and working directory, including unsaved path edits in harness settings, and never claims work. Authentication and native startup policy still apply. Claude discovery disables ordinary hooks and configured MCP servers; administrator-required hooks can still run. Pi discovery disables extensions, MCP, skills, and project context files and uses an ephemeral session.

The picker reads Claude Code's SDK `supportedModels()`, Codex's app-server `model/list`, and Pi's RPC `get_available_models`, rather than a generic provider catalog. Lists can vary with the installed version, account and project configuration, and do not guarantee a later request will succeed. Catalogs return at most 100 models and cache for five minutes; failed reads cache for 30 seconds. Discovery is bounded to 15 seconds plus process cleanup and version detection. Failures preserve the saved model; refresh or enter a custom ID. No fallback model is substituted by Interlock.

In an Agent node, **Execution → Executor** groups harnesses and Agent presets below **Workflow default** and **Connected agent**. The menu offers **Workflow default** when it can resolve to a managed harness. It omits disabled or unavailable harnesses and presets without an eligible choice. If a saved selection becomes unavailable, the editor keeps it visible until you choose a replacement.

Select a harness to edit **Model** and **Thinking effort**. Node overrides win. Concrete workflow defaults apply when the workflow has no harness of its own or uses the same harness. A direct selection replaces an inherited preset. Remaining settings come from the selected harness, then its native defaults. Connected agents retain their own models and effort and can use the advisory **Model tier**. Batch items inherit their owning workflow; invoked workflows use their own settings. Publish to apply changes to new runs.

In JSON, a direct choice uses `executorMode: "harness"` and the local profile ID in `executor`. Its `model` is a literal model ID. Omit the mode to preserve existing alias-first routing in saved definitions. Work records retain the resolved override and source for model and effort. Managed retries and continuing sessions keep their captured settings.

### Thinking effort

Harness **Thinking effort** supplies a default. Workflow `agentEffort` and Agent `effort` optionally override it, in node → workflow → harness → native order. Omission inherits; explicit `null` selects **Use native default**, bypassing inherited effort. This allows a node to select another model without retaining an incompatible parent effort. Choose an explicit effective model to configure effort.

Effort choices come from Claude SDK `supportedEffortLevels` and Codex `supportedReasoningEfforts` in the same bounded model discovery. Pi reads `get_available_thinking_levels` after selecting each catalog model in its ephemeral discovery session. Pi model IDs include the provider, such as `openai/gpt-6-sol`; a custom bare ID must match exactly one available model. Codex's suggested `defaultReasoningEffort` is returned as metadata, not forced over native configuration. Missing metadata, custom model IDs and failed discovery do not invent choices. Explicit unsupported or unverifiable efforts leave work unclaimed with a reason; clear the effort or choose a supported model/level. Retrying the queued assignment reuses the cached discovery; **Refresh models** requests a new catalog. No thinking-token budget is introduced.

Published assignments retain `executorEffort` and `executorEffortSource`. The resolved profile and model/effort sources appear in execution details. Native defaults are labelled as such; Interlock does not claim to have measured a native default effort. Retries and continuing sessions retain their captured settings. A continuity group cannot silently change its pinned model or effort through a later explicit override; choose matching settings or another group.

## Sessions and permissions

Codex receives native structured-output schemas for a conservative supported subset. Other contracts, including conditional schemas, regex patterns, open objects, and optional object properties, use a JSON-encoded string inside the native result envelope. The assignment includes the complete original schema. Interlock decodes the result and validates it through the ordinary submission path; it does not remove constraints or make optional properties required. If the encoded string contains a complete JSON object or array followed by a short prose fragment, Interlock tries that JSON value through the same validation. This avoids repeating the assignment for a stray suffix. Truncated or ambiguous results still fail.

Ungrouped assignments start independent native sessions, including retries. A `current` assignment permits existing context; it does not inherit the conversation that started the workflow. A run-local `context.continuityGroup` reuses a manager-owned native session and serializes work in that group. `fresh` always starts independently and cannot use a continuity group. The managed assignment prompt states that isolation is already established, so the native Agent performs the work in that session instead of delegating again to satisfy connected-worker handoff instructions. Existing externally bound groups are not silently adopted.

The profile is captured at first claim, retained on retries and pinned for a continuity group. Later profile edits affect unbound work. The actual native model, when reported, is recorded alongside the resolved executable and directory. Advisory model tiers do not automatically select native models in this release.

Claude Code uses the official Agent SDK with the installed executable and native user/project/local configuration. Codex uses its app-server protocol. Both retain native project instructions and supported authentication. **Standard** follows native permission rules; actions already allowed by native rules may proceed without an Interlock prompt. Interlock forwards requests that reach the host and does not persist broader permission grants. **Full access** explicitly selects Claude’s `bypassPermissions` with SDK bypass enablement, or Codex’s `danger-full-access` sandbox with `never` approvals. It permits file changes and commands without routine approval stops. Native deny rules, mandatory questions and organization restrictions still apply. **Standard** maps to Claude’s default mode and Codex’s workspace-write sandbox with untrusted-command approvals. Codex Read only uses its read-only sandbox without permission escalation. **Read only** restricts supported native tools, but does not isolate project startup hooks or make an untrusted repository safe.

Pi uses its native RPC protocol and retains native authentication, project instructions, extensions, MCP connections, and skills. The adapter is tested with Pi 1.1.0 and requires `agent_settled`, exact session selection, and RPC extension dialogs. Interlock loads a temporary permission extension and verifies that it registered before sending the assignment. **Read only** allows Pi's `read`, `grep`, `find`, and `ls` tool names and blocks other tool calls, including MCP tools. **Standard** allows those read tools and asks for approval before every other tool call. **Full access** removes Interlock's tool approval check; installed Pi extensions can still deny actions. Trusted startup code and extensions run outside this tool policy, so these modes are not an OS sandbox. Pi extension confirmations and select, input, or editor dialogs appear in the run inspector. Pi must return a JSON result envelope; Interlock validates the unwrapped result through the ordinary submission path.

The badge beside **Runs** counts runs waiting for a human response, replacement model, or recovery confirmation. Use the **Needs attention** tab to open the relevant assignment. Owned child work counts under its parent; detached runs count independently. Normal execution queues do not trigger the badge.

Open the run inspector and choose **Review request** to answer a pending permission or question. When several steps need a response, the review menu lists them by assignment and item. The selected assignment appears before step data and technical details. Its status distinguishes waiting for your response from an agent working. **Allow once** or **Deny** applies to that exact active request. Native Codex additional sandbox-grant requests, session-wide file grants, secret-input requests and MCP elicitations are declined in this release. File approvals require captured paths and patches; incomplete approval details are declined. Questions allow custom answers only when the native request supports them. Human answers must come from the user, not another agent's guess.

Progress records contain bounded tool/status updates. New managed executions also capture visible conversation content within the [transcript limits](#transcripts-and-operator-messages). Native output and error text can contain task data; use non-secret task inputs. Interlock records reported usage where available. Missing measurements stay unknown. Pi aggregates response usage for each assignment, including continued sessions. Resumed cumulative counters from other harnesses are differenced when a baseline is known; uncertain resumed history is not charged again. Provider cost estimates are not account billing.

## Transcripts and operator messages

Select a managed Agent step in the run inspector. The **Conversation / Details** segmented control switches views. **Conversation** opens its recent messages and tool activity, with guidance input below the scrollable history. The persistent footer controls navigate to the oldest retained content, older or newer entries, or the latest messages. Navigation stays visible while the conversation scrolls. The header's attempt selector reads earlier attempts without offering to message or stop them. **Details** contains session information, capture statistics, retention limits, prompt/context, and step data. Pending approvals, questions, and recovery controls remain visible above either view.

Codex, Claude Code, and Pi capture visible assistant text, tool calls, and tool results. Custom commands and launchers expose partial progress capture. Historical attempts have no reconstructed conversation. Binary content and private reasoning are excluded. Unknown capture or unsupported message delivery is shown explicitly.

Transcript safeguards are always active, independently of optional run-history retention:

| Limit                                                  | Value                                          |
| ------------------------------------------------------ | ---------------------------------------------- |
| Serialized entry                                       | 32 KiB, with truncation markers                |
| Per execution                                          | 2,000 entries and 10 MiB                       |
| Library transcript data and reserved delivery receipts | 256 MiB                                        |
| Age                                                    | 14 days after execution ends                   |
| Read page                                              | 50 entries by default, at most 100 and 256 KiB |

Old entries give way to recent content. At library capacity, ended transcripts are pruned before active content. Active delivery receipts remain protected against duplicate sends. A minute sweep expires ended content in bounded batches even without new runs. Reaching a capture limit does not stop the Agent. Entries larger than 1 MiB before redaction are omitted rather than partially scanned. Truncation, expiry, pruning, and capture failures appear beside the reader.

The budget measures retained serialized data with reserved metadata, not the entire SQLite file. Indexes, free allocated pages, backups, and native harness logs are separate. Deleted pages are reused. Interlock limits retained journal size and skips transcript writes when a reader pins more than 16 MiB of WAL data that a passive checkpoint cannot clear. A durable gap marker survives resumed capture and restart; omissions during journal pressure are coalesced, so the displayed omission count is a lower bound. This safeguard does not cap unrelated workflow writes or an external process's disk use. No automatic full-database compaction runs. [History cleanup](history-cleanup.md) removes transcript entries and receipts with their managed execution records.

Known run-captured Secret values and active claim/ticket credentials are masked before transcript persistence. Unsafe redaction omits content. This cannot identify every credential independently obtained by a native tool. Transcript recording does not give Agents implicit access to variables, change permissions, or approve pending tool requests.

For a supported active session, enter guidance in **Message agent**, then choose **Send message**. Codex steers the expected active turn. Claude Code consumes live input after current tool calls finish. Pi queues steering in the existing run. Custom launchers use their captured `messageCommand` or `messageUrl`. A direct custom command without a message channel cannot receive guidance. No fallback starts another turn or session.

Messages accept 1 through 4,000 characters, with at most 100 unique requests per execution. A receipt records the local operator label, source, time, and outcome. Request IDs and operator labels containing known protected values are rejected before persistence or dispatch. Choose safe metadata rather than retrying the rejected values. These labels provide attribution in the local single-user service, not authentication. **Accepted** means the harness accepted input, not that the Agent followed it. A delivery timeout, transport error, or restart may leave **Unknown**. Check delivery status instead of resending. The inspector preserves submitted identity through a lost response and retains an acknowledged outcome if refresh fails.

CLI examples use the existing executor command:

```sh
interlock executors '{"action":"transcript","executionId":"EXECUTION_ID","limit":50}'
interlock executors '{"action":"message","executionId":"EXECUTION_ID","requestId":"guidance-1","message":"Use the vendored dependency."}'
interlock executors '{"action":"receipt","executionId":"EXECUTION_ID","requestId":"guidance-1"}'
```

Use a returned `older` value as `before`, or `newer` as `after`. Omit both for the latest page. Gaps remain explicit if a cursor's content was pruned. MCP `manage_executors` accepts the same objects inside `request`. Shared API callers use `executors.transcript`, `executors.receipt`, and `executors.manage`. Unknown execution IDs reject. These reads do not advance runs or renew claims.

Reuse a message's request ID with identical content and operator label to retrieve its existing receipt without another dispatch. Different content under that ID rejects. `pending` and `unknown` never authorize automatic resend. A missing receipt includes whether receipts for the ended attempt were pruned. Ended, interrupted, expired, cancelled, or replaced claims cannot receive a new message. Pending delivery also blocks history deletion until it settles.

## Custom harnesses

Use **Create integration** for a new configuration and **Save changes** for an existing one. If a save conflicts with another edit, select **Load latest** and confirm before replacing your draft. If Interlock cannot confirm a save, **Check saved integration** reads its saved configuration before you retry.

Interlock supports user-defined custom harnesses (`harness: "custom"`) to execute external agent CLI tools, standalone scripts, or desktop/hosted agent applications. Custom profiles support two execution modes:

- **Direct Turn Mode (`mode: "direct"`)**: Interlock manages the assignment claim, renews the claim lease, executes the command or HTTP endpoint, and submits the returned result envelope.
- **Delegated Claim-Ticket Mode (`mode: "launcher"`)**: Interlock launches an external session and issues a one-time `claimTicket`. The launched session claims the work via MCP `claim_work` using this ticket, executes autonomously, and submits its own result.

Subprocess commands (turn, launch, status, message, stop and archive) inherit the server's full environment by default. Set `environmentMode: "minimal"` to pass only `PATH`, `HOME`, locale variables (`LANG`, `LANGUAGE`, `LC_*`), `INTERLOCK_*`, the profile's `env` values and any names listed in `environmentPassthrough`. Profiles without `environmentMode` keep `inherit`. When a minimal command fails and its source or error output mentions a withheld server variable, the error names it and the fix. HTTP transports are unaffected.

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
  "usage": [{ "provider": "custom", "model": "agent-model", "inputTokens": 100, "outputTokens": 50 }]
}
```

Interlock validates `output` against `outputSchema` and submits the result. Invalid result envelopes consume the ordinary failure allowance. Process exits and HTTP errors without an accepted result leave external effects uncertain and hold the assignment for reconciliation after any configured transient recovery attempts. An unconfirmed subprocess stop always interrupts the execution without automatic retry.

### Delegated Claim-Ticket Mode (Launcher)

Launcher mode delegates execution to an external agent application (such as a desktop app or standalone agent runner). Interlock executes `launchCommand` or HTTP POST `launchUrl`, providing the assignment context and a one-time `claimTicket`.

- **Claim Ticket Authorization**: Interlock records the `claimTicket` bound exclusively to `workId`. Only the launched session presenting this exact ticket to MCP `claim_work` can claim the assignment. Any other claimant is rejected with an authorization error. Upon successful claim, the ticket is consumed.
- **Launch Idempotency**: Replaying a launch with the same `idempotencyKey` returns the existing session handle, avoiding duplicate process launches on retries.
- **Lifecycle Hooks**: Custom launcher profiles can define optional lifecycle hooks (via subprocess command or HTTP POST endpoint):
  - `statusCommand` / `statusUrl`: Interlock polls session state (`working`, `idle`, `needs_attention`, `ended`).
  - `messageCommand` / `messageUrl`: Delivers idle nudges or recovery instructions to the external session.
  - `stopCommand` / `stopUrl`: Requests the external session to stop on assignment cancellation or an explicit stop action.
  - `archiveCommand` / `archiveUrl`: Invoked when the session's final assignment in the run completes.

### Pull transport for launchers Interlock cannot call

Some hosts can make outbound HTTP requests but cannot run a command or accept a connection: an app plugin, a browser extension, or a runner behind NAT. For these, set `transport: "pull"` on a launcher profile, or choose **Delegated launcher** and **Pull** in **Edit integration**. Interlock queues each launcher operation, and the client polls for it, performs it, and reports the result. No bridge process is needed. The pull transport supports launcher mode only.

```sh
interlock executors '{"action":"save","profile":{"id":"app-plugin","harness":"custom","name":"App plugin","enabled":true,"mode":"launcher","transport":"pull","expectedRevision":0}}'
interlock launcher '{"action":"credential","profileId":"app-plugin"}'
```

The second command creates a launcher credential and prints it once. Store it in the client. Running the command again replaces the credential. The old one stops working at once, including for a poll that is waiting. Interlock keeps only a digest of it.

The client calls these routes under `/api`. Send the credential in `X-Interlock-Launcher-Credential`. When the server requires the [API token](connect-harness.md#api-token), also send `Authorization: Bearer <token>`.

| Route                                                             | Body                                      | Response                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /api/launchers/:profileId/poll`                             | `{ "clientId", "waitMs"?, "limit"? }`     | `{ "operations": [{ "operationId", "kind", "leaseToken", "leaseExpiresAt", "payload" }], "leaseMs" }` |
| `POST /api/launchers/:profileId/operations/:operationId/complete` | `{ "leaseToken", "result" }`              | `{ "operationId", "accepted", "late" }`                                                               |
| `POST /api/launchers/:profileId/operations/:operationId/fail`     | `{ "leaseToken", "error", "retryable"? }` | `{ "operationId", "requeued" }`                                                                       |

The same calls are available as tRPC `launcher.poll`, `launcher.complete` and `launcher.fail`, and through `interlock launcher` with actions `poll`, `complete` and `fail`. The CLI reads the credential from `INTERLOCK_LAUNCHER_CREDENTIAL` unless the JSON includes `credential`.

- **Polling**: `waitMs` (0 to 25,000, default 20,000) keeps the request open until an operation is queued, then returns at once. `limit` is 1 to 10, default 1. A profile has one active client. Another `clientId` is refused with `launcher_client_conflict` until the active client goes offline or the credential is rotated, so keep the `clientId` stable across restarts.
- **Operations**: `kind` is `launch`, `status`, `message`, `stop` or `archive`. Payloads match the other transports. A launch carries `idempotencyKey`, `claimTicket`, `prompt`, `cwd` and the other launch fields. Status, stop and archive carry `workId`, `runId` and `sessionId`, and a message adds `message`.
- **Results**: a launch returns `{ "sessionHandle", "deepLink"?, "url"?, "resumeCommand"? }`; `sessionId` is accepted in place of `sessionHandle`. A status returns `{ "state" }`, with `working`, `idle`, `needs_attention` or `ended`. Other operations can return `{}`.
- **Leases**: a polled operation is leased to the client for 30 seconds. If the client does not complete or fail it in time, it returns to the queue and is delivered again with a new `leaseToken` and the same payload. A launch redelivered with an `idempotencyKey` the client has already handled must return the existing session, not start another. After an operation is completed, or delivered again, its earlier lease token is rejected. `fail` with `retryable: true` returns the operation to the queue; otherwise the operation fails. After five deliveries Interlock stops delivering it.
- **Timeouts and late results**: Interlock waits for a launch for `timeoutSeconds` (default 60) and for other operations for up to 30 seconds. A launch the client received but never reported is treated as uncertain: the execution is interrupted, and you confirm the session stopped before retrying. If its result arrives later, Interlock accepts it with `late: true`, records the session on the execution and queues a `stop` for it. A status that gets no answer leaves the session state unknown, and idle recovery does not treat it as idle.
- **Restarts**: queued `stop` and `archive` operations survive a restart. Launch, status and message operations that were not delivered are dropped. A delivered launch can still report a late result.
- **Client offline**: the profile list's `detection` shows `detected` while a client is online and `client` with `credential`, `lastPolledAt` and `clientId`. If no client has polled within `clientTimeoutSeconds` (**Client offline after** in the editor; 10 to 3,600, default 60), Interlock queues no launches for that profile. Its assignments stay unclaimed with the reason `launcher_client_offline` and appear in **Runs → Needs attention** as **Launcher client offline**. They start when the client polls again.
- **Queue limits**: a profile holds at most 200 pending operations. Operations for cancelled or finished assignments are dropped, except `stop` and `archive`.

Errors return `{ "error", "code" }`: `launcher_credential_invalid` (403), `launcher_client_conflict` (409), `launcher_lease_invalid` (409), `launcher_operation_not_found` (404) and `launcher_poll_busy` (429, more than two waiting polls for a profile).

The reference launcher used by the contract tests, `packages/runtime/test/fixtures/custom-harness-reference.js`, includes a pull client: `node custom-harness-reference.js pull` with `INTERLOCK_LAUNCHER_PROFILE`, `INTERLOCK_LAUNCHER_CREDENTIAL` and optionally `INTERLOCK_URL` and `INTERLOCK_API_TOKEN`.

### Template tokens and working directories

Subprocess commands receive Interlock token values through the environment. HTTP URLs, headers, and configured environment values support token replacement:

- `$INTERLOCK_WORK_ID`
- `$INTERLOCK_RUN_ID`
- `$INTERLOCK_SESSION_ID`
- `$INTERLOCK_CWD`
- `$INTERLOCK_CLAIM_TOKEN`
- `$INTERLOCK_CLAIM_TICKET`
- `$INTERLOCK_SESSION_NAME`
- `$INTERLOCK_INPUT`
- `$INTERLOCK_MCP_URL` (launch only): the running server's `execute` [tool profile](connect-harness.md#choose-a-tool-profile) endpoint, also sent as `mcpUrl` in the launch payload. Configure the launched session's MCP client with it to claim and submit with fewer tools in context.
- `$INTERLOCK_API_TOKEN` (launch only, set only when the server requires the [API token](connect-harness.md#api-token)): send it as `Authorization: Bearer $INTERLOCK_API_TOKEN` from the launched session's MCP client. It is not included in the launch payload.

Commands use normal shell quoting. Double-quote token arguments, such as `agent --session "$INTERLOCK_SESSION_NAME"`, to preserve spaces and special characters as data. Single quotes keep token names literal. Token values never become shell source. Identity tokens are also available to scripts through their environment. Turn and launch commands receive the full assignment payload as JSON on stdin. Their `$INTERLOCK_INPUT` token exposes the assignment input; message commands use that token for the recovery message. Status, stop, and archive commands have no input token. The input token enters the subprocess environment only when explicitly referenced in the command. Use stdin for large inputs because operating systems limit environment and argument sizes.

Custom harness commands do not require absolute executable paths; binary names resolved from `PATH` and arbitrary shell commands are permitted. Configured and dynamic `cwd` values must resolve to an existing directory contained inside the declared `allowedRoots`.

Direct turns and launcher command operations stop their process group before reporting timeout, cancellation, or failure. Cleanup includes descendants left after the shell exits. A turn cannot retry automatically when termination cannot be confirmed; inspect external effects and reconcile the interrupted execution first. A successful launch command can leave its delegated session running. Server shutdown aborts and waits for owned command processes, then retains interrupted ownership for delegated sessions. It does not dispatch remote stop operations; verify those sessions stopped before reconciling. Status, message, archive, and stop commands have a ten-second limit; launch commands use the configured timeout or sixty seconds.

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
  - `windowMs` (ms, default 300,000 / 5 min): Rolling time window for transient retry counting. Active pause holds are excluded from elapsed time calculations.
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

**Concurrent assignments** in **AI Settings → Execution settings** offers a dropdown with **Limit to** and a positive whole-number field, or **Unlimited**, which hides the number field. The default is **Limit to 3**. There is no eight-assignment ceiling. Unlimited starts every ready managed assignment that meets the normal execution requirements; resource coordination, continuity and workflow sequencing still apply. Additional assignments wait for capacity. Raising the limit can start queued work immediately. Lowering it lets active assignments finish and delays new starts until there is room. Workflow settings show the shared limit and link back to AI Settings. Each profile can also set **Concurrent assignments** to a positive whole number. Leave the field blank for no profile limit, represented by omitted or null `concurrency`. Both the shared and current profile limits must permit a new dispatch. A saturated profile does not prevent other profiles from using available shared slots. Profile changes affect new dispatches without interrupting active work; historical attempts retain their captured configuration. Delegated launchers count from pending launch through the active assignment, including the period before ticket claim. Workflow `maxActiveRuns` separately limits admitted workflow runs; see [start admission](idempotent-run-starts.md#queue-starts-until-capacity-is-available). Assignments waiting for human input still occupy a slot. Connected agents, manual claims and Batch item-path concurrency retain their existing behavior. In MCP/API settings, `concurrency` is the positive numeric limit or `null` for Unlimited; zero is invalid. The setting stays local and persists across server restarts; it is excluded from workflow exports. Existing stored profile `concurrency` values remain in effect after upgrade. Clear the profile field to remove its limit. Agent `maxExecutionMs` optionally bounds total active duration per claim attempt. Omission leaves duration unlimited. Named pauses and declared holds, including `needs_human`, are excluded. Claims renew before expiry; they are ownership leases, not task deadlines. Native harness and provider limits still apply. Existing Script/Fetch execution timeouts and optional unclaimed Agent deadlines retain their behavior. Explicit completed native failures and invalid results consume the existing failure budget, except recognized early model refusals, which wait for an explicit replacement selection. Transport loss and unexpected adapter errors hold the assignment for reconciliation; no unbounded repair loop is added. There are at most 20 local profiles and 100 human requests per execution. Inspection returns the latest attempt, up to 20 recent progress entries, pending requests and the last three resolved requests, plus at most ten compact older-attempt records.

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

`maxRecoveries` accepts 0 through 10 and defaults to 0. The optional message defaults to a request to continue or report the blocker and accepts 1 through 4,000 characters. Automated recovery currently requires a custom launcher with `message`, `stop` and `status` operations; pull launchers have all three. Native/direct adapters retain stalled attention for operator recovery. Repeated idle status polls alone no longer send unsolicited messages.

When status is `idle` and no claim progress or renewal has occurred for the active threshold, Interlock sends the configured message once. If another active threshold elapses without progress or renewal, it calls `stop`, then requires `status: "ended"` before releasing the session and redispatching through ordinary admission. Message and stop delivery have a ten-second operation timeout. Delivery errors or an unconfirmed stop hold work for explicit reconciliation. A missing operation leaves stalled attention visible.

The recovery count is persisted on the assignment and does not reset across claim attempts or renewals. A nudge spends one recovery allowance even if delivery is uncertain. Inspection records idle recovery actions as `nudge` and `relaunch` with bounded excerpts. Confirmed stop/relaunch also spends the ordinary Agent attempt allowance. Reaching the cap leaves the stalled item for inspection. Claims, run budgets, resources, pause admission, profile caps and claim tickets retain their existing checks. Each relaunch creates a fresh ticket, and a stale token cannot submit the new attempt. Interlock does not promise restoration of an external provider session. Grouped sessions retain their identity constraints.

A renewal or progress callback cancels pending escalation. Completion, a hold or a changed claim prevents a stale asynchronous response from redispatching work. Pause time is excluded from both idle intervals and no recovery starts while paused. Restart treats the old managed session as uncertain and requires the existing stop confirmation; it never replays a persisted nudge or stop as proof of safety. See [active clocks](timers.md#stall-detection-and-active-attempt-deadlines).

Active execution deadline revocation also interrupts managed supervision. Retryable work is held with recovery attention, and exhausted work retains recovery attention when stop confirmation is still needed. A configured launcher stop operation is requested, but its response alone does not clear uncertain ownership. Confirm the session and subprocesses stopped through `reconcile`. Reconciliation waits for an in-flight stop operation to settle, releases exact-attempt reservations and permits a fresh ticket only for work that can still run. It does not reset failure or claim budgets. Late nudge failures and stale status responses cannot revive the revoked attempt.

<a id="model-aliases"></a>

## Agent presets

Open **AI Settings → Agent presets** and choose **New preset**. Name the preset and set the primary harness, model, and thinking effort. Add and reorder fallbacks if the primary choice may be unavailable. Then select the preset under an Agent node's **Executor**, or under **Agent model** in Workflow settings for nodes that inherit the default.

Interlock uses the first enabled, available choice that can enforce the requested permissions. A fallback is an alternative at assignment creation. It does not retry a failed request or skip a busy harness. The default permission setting uses the chosen harness's permissions unless the workflow supplies a mode. If both workflow and preset set a mode, the more restrictive one applies. A custom integration needs a command or URL for its configured mode and transport. It receives permission requests but does not enforce them through Interlock, so it is ineligible when the preset or workflow requires **Read only** or **Standard**.

Existing model aliases appear as presets. Their saved identities, candidate order, and workflow references stay intact. A legacy choice without a harness can still inherit a workflow harness. Nodes configured in earlier versions keep their execution behavior when you open and apply settings without choosing another executor.

To author a preset selection in JSON, set `executorMode: "preset"` and put the preset ID in `model`. Omit `executor`. Set workflow `agentModelMode: "preset"` with the preset ID in `agentModel` for inheriting nodes. Use `agentModelMode: "literal"` for a concrete workflow model ID. Definitions with no mode retain their legacy routing and accept preset names and IDs. An explicit node effort override wins for preset mode; otherwise use candidate effort, applicable workflow effort, and harness effort in that order. Null asks for the native default.

- Manage presets through the existing `manage_model_aliases` MCP tool and model alias API. Choices remain `{ model, effort?, profileId? }`. The optional preset `permissions` field applies to all choices. Set it to null on update to restore inheritance. Updates and deletions require `expectedRevision`. Set `exactId: true` with the saved preset ID to prevent inspection, update, or deletion from following a replacement by name.
- Runs capture the preset revision, choices, and permission override at startup. Editing or deleting a preset does not change those captures. A missing requirement used by an Agent or a preset with no configured candidate blocks a new start. Interlock checks candidate installations before creating work and fails the node if none pass. An unused workflow preset does not block explicitly configured nodes.
- Selections in Executor use stable IDs. Renaming a preset keeps those selections working. Update existing references by name after a rename.
- Bundles keep named requirements and stable references in `modelAliases`. They exclude local candidates, permission overrides, and profile details. The destination must configure the corresponding local preset.
- Claim receipts retain the captured preset revision and chosen candidate for [report attribution](usage-reporting.md#metrics-and-limits).
