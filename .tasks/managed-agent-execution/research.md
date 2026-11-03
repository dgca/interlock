# Agent dispatch patterns for Interlock

Researched 2026-11-01 for brainstorming around issue #71. This note records product evidence, then draws design implications. It does not propose implementing the old issue verbatim. No providers were invoked and no product behavior was changed.

## What other products do

| Example      | How work reaches an agent                                                                                                    | What owns execution                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Vibe Kanban  | Starting a workspace or session launches a selected coding agent. MCP clients can also request a workspace or send a prompt. | A local process manager and per-harness executors.                               |
| Claude Squad | The user creates or resumes terminal agent sessions.                                                                         | tmux sessions with separate Git worktrees and a terminal UI.                     |
| OpenHands    | A service dispatches scheduled or event-triggered runs to a conversation runtime.                                            | The OpenHands Agent Server and SDK, rather than an external Claude Code session. |

These are useful architectural examples, not a ranking or a recommendation to adopt them. Vibe Kanban's current README announces that the product is sunsetting. Its implementation remains a close reference for supporting several external coding agents. [Vibe Kanban repository](https://github.com/BloopAI/vibe-kanban)

### Vibe Kanban launches managed harness sessions

Each supported agent must be installed and authenticated before use. Users select a harness when creating an attempt. Named profiles capture model and permission settings. The documented task flow creates a Git worktree, runs setup, sends the task to the agent, streams progress, and supports follow-up messages. [Supported agents](https://github.com/BloopAI/vibe-kanban/blob/main/docs/supported-coding-agents.mdx), [agent profiles](https://github.com/BloopAI/vibe-kanban/blob/main/docs/configuration-customisation/agent-configurations.mdx), [execution flow](https://github.com/BloopAI/vibe-kanban/blob/main/docs/core-features/monitoring-task-execution.mdx)

The Claude executor launches a subprocess in a chosen directory with controlled arguments and environment. It uses Claude's print mode and bidirectional streaming JSON, retains a session ID for later resumption, connects a control and approval service, and provides a cancellation token. This is a session launched and tracked by Vibe Kanban. It is not an injection into an arbitrary terminal already open on the user's computer. [Claude executor, pinned source](https://github.com/BloopAI/vibe-kanban/blob/7c3807084daad0d9d315064f60fa869de254f027/crates/executors/src/executors/claude.rs)

Vibe Kanban exposes separate MCP operations to create a workspace, create a session, send a session prompt, and inspect an execution's status and final message. That API distinction keeps workspace, conversation, and one execution attempt separate. [MCP session operations](https://github.com/BloopAI/vibe-kanban/blob/main/docs/integrations/vibe-kanban-mcp-server.mdx)

Caveat: the monitoring guide describes approval support more narrowly than the current Claude executor implementation. Treat per-harness features as capabilities to verify against code and tests, rather than assuming that every agent has identical behavior.

### Claude Squad manages interactive terminals

Claude Squad starts external programs such as Claude Code, Codex, or Aider. Its documented design uses one tmux terminal session and one Git worktree per agent. Users can attach to sessions, inspect changes, pause, and resume. This preserves an interactive terminal experience rather than making every harness conform to one structured application API. [Claude Squad README](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/README.md)

Its optional auto-accept daemon polls stored sessions. When a started, unpaused session appears to be waiting at a prompt, the daemon sends Enter. That loop concerns terminal prompt acceptance, not a durable application work queue. [Daemon source](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/daemon/daemon.go)

Inference: terminal management is useful for visible human handoff, but keystroke and prompt detection would be a weak default foundation for Interlock's structured claims and output contracts. A worker can own a new terminal if desired without promising control over any pre-existing terminal.

### OpenHands separates dispatch from execution

OpenHands' automation service owns schedules, incoming webhooks, run history, dispatch, and sandbox lifecycle orchestration. Its README labels the service beta. The Agent Server and Software Agent SDK own conversations, tools, workspaces, and events. [Automation service](https://github.com/OpenHands/automation/blob/407bf8a021cce90656ee8d92292bd742b550080f/README.md)

The dispatcher polls persisted pending runs, can lock rows to prevent concurrent dispatchers from selecting the same job, marks selected runs running, and launches background tasks. It also handles organization concurrency limits, launch failures, and asynchronous completion. This is substantially more than starting a command and assuming that process exit equals successful work. [Dispatcher source](https://github.com/OpenHands/automation/blob/407bf8a021cce90656ee8d92292bd742b550080f/openhands/automation/dispatcher.py)

The Agent Server exposes conversations over HTTP and WebSocket, stores conversation data, and supports local or remote clients. OpenHands can execute in a local workspace or in a container through its workspace implementations. It runs its own agent runtime using configured models and tools. Calling a Claude model through that runtime does not mean it is running Claude Code. [Agent Server architecture](https://github.com/OpenHands/docs/blob/main/sdk/arch/agent-server.mdx), [SDK architecture](https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx)

## A cross-harness protocol can help, but is not the worker

Agent Client Protocol defines structured communication between an application and an agent. The client launches an agent subprocess and exchanges JSON-RPC over stdin and stdout. Sessions have separate context and history. New-session requests carry a working directory and MCP server configuration. Loading a prior session is a negotiated capability. [ACP architecture](https://agentclientprotocol.com/get-started/architecture), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup)

ACP carries streamed session updates, tool activity, cancellation, and permission requests. The documented standard transport is currently stdio, while a remote transport is being specified. [Prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls), [transports](https://agentclientprotocol.com/protocol/v1/transports)

Inference: ACP could reduce adapter work for compatible agents. It does not decide which Interlock assignment to claim, reserve concurrency, renew a claim, retain an execution attempt, or validate and submit that assignment's output. Nor does support for ACP establish support for every harness feature or control over a user's existing chat.

## Patterns worth discussing

The following are design inferences, not claims about features all of these products already share.

A reliable solution has two jobs: a durable work dispatcher and a managed session lifecycle. The dispatcher finds eligible work and records which attempt owns it. The session manager starts or resumes the selected harness, supplies its context and tools, watches progress, and stops or escalates it. These jobs can live in one local worker process without being built into every Agent node.

A managed session differs from an arbitrary terminal already open on the user's computer. Vibe Kanban supplies the former. Claude Squad demonstrates visible terminal attachment, but its prompt-detection daemon is a weak foundation for structured workflow completion. The OpenHands boundary shows how launch, execution, and scheduling can remain separate concerns.

The useful question for Lucy is which assignments an automatic worker should own, including runs started by scripts. The worker needs deliberate scope and capacity limits. Completion should distinguish validated output, human input, provider trouble, and interruption. A final natural-language response or a process exit alone does not establish a valid Interlock result. Model usage and billing remain dependent on the chosen harness and authentication.

## Zed provides another external-harness example

Zed uses ACP to host external agents in its Agent Panel, including Claude, Codex and OpenCode. They run as separate processes. The agent usually owns its authentication, model selection, tools and native settings. Zed can forward MCP configuration, but its own agent profiles and skills do not automatically apply to an external agent. It distinguishes these structured integrations from terminal-backed threads. [Zed external agents](https://zed.dev/docs/ai/external-agents)

Inference: a consistent user interface does not require identical harness internals. Interlock can retain one execution concept while adapters report their actual capabilities. ACP is worth evaluating alongside native SDKs, not assuming as a universal lowest-common-denominator contract.

## Current harness entrypoints

Claude Code supports noninteractive execution through `claude -p`, with structured or streamed output and explicit session resumption. The CLI's `--bare` mode deliberately skips normal configuration discovery and changes authentication behavior, so launching a process does not by itself promise the same setup as Lucy's interactive session. [Headless Claude Code](https://code.claude.com/docs/en/headless)

The Claude Agent SDK runs the Claude Code binary and supplies its agent loop, tools, permissions and session management. This differs from calling Claude's model API and building a new tool loop in Interlock. [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

SDK sessions retain conversation history and can resume by ID. Fresh reviewers need an independent session rather than a resumed author session. [Session behavior](https://code.claude.com/docs/en/agent-sdk/sessions)

Tool approvals and clarification questions can reach the application's callback, pausing until an answer. Long waits can use a documented deferral path and persisted session resumption. This supports a visible Needs human state rather than disabling approvals to keep background work moving. [Approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)

Structured outputs can target a JSON Schema. Missing structured output or exhausted output repair must still be handled as failure, even if a textual response looks successful. Interlock should remain the final authority for its own captured output contract. [Structured output](https://code.claude.com/docs/en/agent-sdk/structured-outputs)

Codex's official SDK supports starting, continuing and resuming local threads. Its App Server exposes richer streamed events and approval requests. The documentation distinguishes background-job automation through the SDK from building a rich custom client with App Server. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [App Server](https://learn.chatgpt.com/docs/app-server)

OpenCode exposes an HTTP server for session creation, messages, aborts, status, events and permission responses. This is another usable control contract, with a different transport from a print-mode subprocess. [OpenCode server](https://opencode.ai/docs/server/)

### Existing conversations are a separate integration

Claude Code Channels can deliver events from an MCP server into an already-running session. It is a research preview, requires an open session, requires explicit Team/Enterprise enablement, and is unavailable on the documented third-party inference providers. It does not launch a closed session. [Channels](https://code.claude.com/docs/en/channels)

The custom-channel reference currently requires a stdio connection and a development allowlist bypass for unapproved custom channels. The bypass is interactive-only and ignored in print mode or the SDK. Therefore the existing Interlock HTTP MCP connection is not automatically an always-on channel. Treat a channel integration as a separate optional route, not the portable foundation of automatic execution. [Channels reference](https://code.claude.com/docs/en/channels-reference)

### Authentication needs a real workplace check

The Claude SDK overview restricts third-party products offering claude.ai login without prior approval. Meanwhile the current support article says SDK, print-mode and third-party app usage still draws from subscription limits, with changes paused, and also describes linked API credits. These pages answer different product/access questions and should not be collapsed into a promise that every work subscription can power a distributed Interlock integration. Verify the intended local-launch path, organizational controls and credentials before committing to a billing model. No credentials or real accounts were inspected here. [SDK product guidance](https://code.claude.com/docs/en/agent-sdk/overview), [current plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## Interlock's current boundary

Verified against merged main `ca32b7b782030a68e8b767c868cc4f39700b7dff`, after PR #192. Issue #71 describes named executor profiles but explicitly remains an unapproved design. Lucy's immediate need is automatic pickup and actual execution; per-node executor choice is a further configuration decision. [Issue #71](https://github.com/dgca/interlock/issues/71)

Interlock already has work discovery, exclusive claims, renewal, result validation, holds, usage attribution and resource coordination. Connecting MCP or starting a workflow does not start an agent. Global discovery sees available assignments across runs. Root-scoped discovery includes graph descendants, but a Script making a separate ordinary `start_run` API call creates another root. A conversational loop following one root can therefore miss independently created work. [Harness guide](https://github.com/dgca/interlock/blob/ca32b7b782030a68e8b767c868cc4f39700b7dff/docs/connect-harness.md), [available work](https://github.com/dgca/interlock/blob/ca32b7b782030a68e8b767c868cc4f39700b7dff/packages/runtime/src/index.ts#L2080), [run-start API](https://github.com/dgca/interlock/blob/ca32b7b782030a68e8b767c868cc4f39700b7dff/packages/server/src/router.ts#L482)

Run-local continuity groups already record executor/session identity. Groups do not inherit across invoked workflows, detached runs or Batch items. Interlock currently checks declarations, while the harness supplies actual context continuity and fresh isolation. A managed worker should reuse these semantics rather than invent another session binding system. [Continuity guide](https://github.com/dgca/interlock/blob/ca32b7b782030a68e8b767c868cc4f39700b7dff/docs/context-continuity.md)

## Agreed first-release constraints

The user requires both Claude Code and Codex in the first release of managed execution. These unblock Lucy's use and give the project a second harness for testing. Channels are out of scope for this release. The design must support additional harnesses without treating Claude Code's settings or lifecycle as the common contract. This does not authorize implementation yet; the session remains brainstorming.

## Proposed direction for the discussion

The following design is a recommendation, not an implemented contract or an agreed ticket.

Use an opt-in execution manager inside the existing Interlock server with complete Claude Code and Codex adapters in the first release. The user accepted automatic dispatch when Agent assignments become ready, without requiring a separate monitoring daemon. Exercise the same shared execution interface through both adapters before fixing the interface. Consider OpenCode and ACP-compatible agents as future adapters, without requiring ACP as the transport for the first release.

Let a user enable automatic execution for deliberately selected workflows or a defined scope. New eligible work should be found regardless of whether a user, Script or other workflow started the run. Avoid making every unassigned Agent in the whole library automatically executable merely because a worker exists. Consider a workflow default executor before adding overrides to every node.

The worker should own discovery, claims, lease renewal and validated submission outside the model loop. It starts or resumes the harness session and passes the assignment, project directory, allowed tools and required context. Keep executor configuration local and references portable. Retain external MCP/manual workers and use the same claim rules so two executors cannot own one assignment.

The first complete path should surface queued, running, needs human, failed and interrupted work, with logs, stop controls and bounded concurrency. A restart must reconcile persisted attempts with actual sessions and processes; an expired lease does not prove external actions stopped. Context continuity, fresh review, permissions, actual usage reporting and recovery are necessary product behavior, not incidental adapter details. Existing Interlock MCP tools should remain the normal inspection path without provider-specific tool proliferation.

The worker module should own assignment eligibility, claims, lease renewal, concurrency, lifecycle records and validated submission. Harness adapters should own session creation/resumption, progress and result translation, permission and user-input translation, cancellation and actual usage extraction. Both adapters should undergo the same contract tests, with deterministic test doubles in routine CI and separate opt-in real-account smoke checks. Harness-specific settings stay in local profiles. Required capabilities must be checked honestly; unsupported context or permission requirements must not be silently weakened.

The next product choice is where execution is selected. A proposed workflow default can keep ordinary authoring simple, while an optional Agent-node override can support different harnesses or profiles for implementation and review. An unconfigured workflow retains manual/connected-agent behavior. The exact scope, inheritance, per-run overrides and UX are not yet decided.

## Sources and limits

Source snapshots inspected: Vibe Kanban `7c3807084daad0d9d315064f60fa869de254f027`, Claude Squad `ce1ffb4392b01f38e2c4599c7c84d2a93973b138`, OpenHands Automation `407bf8a021cce90656ee8d92292bd742b550080f`, and OpenHands SDK `98849457621881ae2414719b82b8bc1cf535b4ab`. Documentation links without commit pins can change. This research inspected public documentation and source; it did not test installed product behavior, provider authentication, billing, crash recovery, or policy restrictions in Lucy's work environment.

## Optional extra harnesses

Follow-up research on 2026-11-01. Claude Code and Codex are required for the first release. The following is a bounded assessment of additional adapters, not a commitment to ship them.

Gemini CLI has a native ACP mode. Its official guide covers new and loaded sessions, prompts, cancellation, approval modes, MCP, and local telemetry. A shared ACP client could reuse much of the session transport. Its headless JSON output is an envelope containing a final response string and usage statistics, rather than a demonstrated arbitrary output-schema contract. Gemini authentication may use cached Google credentials, an API key, or Vertex AI. Organization accounts can require a Cloud project. Exact flags and source paths differ across current documentation, so an adapter still needs a tested version and capability checks. Specific question-handoff behavior and schema enforcement were not verified here. [ACP mode](https://geminicli.com/docs/cli/acp-mode/), [headless output](https://geminicli.com/docs/cli/headless/), [authentication](https://geminicli.com/docs/get-started/authentication/)

GitHub Copilot CLI offers native ACP in public preview. Its official SDK provides permission and user-input callbacks, session resumption, abort, and usage events. The Node SDK source supports a per-run response schema; this does not establish equivalent schema support over standard ACP. Copilot's ACP guide specifically says session creation does not carry tool filters or reasoning settings: those come from the server's launch configuration. The CLI documentation also excludes Fleet from ACP mode. Users must install and authenticate the runtime or configure a supported BYOK provider. These are manageable adapter concerns, but they exceed changing an executable name. [ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server), [SDK capabilities](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility), [SDK response-schema source](https://github.com/github/copilot-sdk/blob/68de1a7afe4bc9e7435d185825043bd9dc9c47cf/nodejs/src/types.ts), [CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)

Assessment: both are feasible later adapters. ACP reduces custom connection and session-event code. It does not remove harness-specific permission behavior, user questions, result validation, measured usage mapping, credentials, restart recovery, or compatibility tests. Neither optional harness is clearly cheap enough to promise for the first release before the required two establish the shared execution lifecycle. No real provider sessions were run.

## Scope recommendation after the extra-harness review

Keep Claude Code and Codex as required release targets. OpenCode is the first optional addition to try after those adapters establish the shared interface. Its official SDK supplies JSON-schema results, session operations, cancellation and permission responses, while its server exposes event streams. ACP is another supported control path. These are promising entrypoints, not proof of a low-effort complete adapter. [OpenCode SDK](https://opencode.ai/docs/sdk/), [server](https://opencode.ai/docs/server/), [ACP](https://opencode.ai/docs/acp/)

Include OpenCode in the first release only if it uses the existing execution interface and settings UI, meets the same session/permission/result/cancellation/recovery requirements, and passes the same contract checks plus a representative real integration check. Do not hold the release for an extra transport architecture or special configuration screens. Defer Gemini and Copilot for now. ACP support alone does not establish compatible structured results or equivalent permissions and lifecycle behavior.

This is a scope recommendation under the user's authorization to add more harnesses only if relatively light. Actual adapter effort remains unmeasured because implementation has not begun.
