# Intent: H6 Custom Harness Definitions & Launcher Adapter (`harness: "custom"`)

## Baseline Git Information
- **Task Branch**: `feat/issue-233`
- **Base Commit**: `9f64487bf52deead307e4acba47939bae883b8c7`

## Problem Statement
Running unattended workflows with arbitrary agent CLI tools or desktop agent applications currently requires an external coordinator or manual human intervention. Interlock only natively supported built-in harnesses (`codex`, `claude-code`, `pi`). Users with proprietary agents, internal agent microservices, Docker/Kubernetes container workers, or tmux/daemon runners could not register them as first-class executors in the Interlock UI, CLI, MCP (`manage_executors`), and workflow runtime.

## Desired Outcome
1. Users can define custom harness profiles (`harness: "custom"`) across UI, CLI, MCP (`manage_executors`), and the shared server API.
2. Interlock supports two execution modes for custom harnesses:
   - **Direct Turn Mode**: Interlock invokes the agent per assignment turn (via local subprocess CLI command or remote HTTP POST) with assignment context JSON and awaits the result envelope (`{ output, sessionId?, model?, provider?, usage? }`), with `ExecutorManager` managing claim, lease renewal, and submission.
   - **Delegated Claim-Ticket Mode (Launcher)**: Interlock executes a `launch` command or HTTP endpoint, issuing a cryptographically secure one-time `claimTicket` bound to `workId` that only the launched session can present to MCP `claim_work`. It manages execution through optional lifecycle hooks (`status`, `message`, `stop`, `archive`).
3. Launch calls are idempotent: replaying the same `idempotencyKey` returns the existing session handle.
4. Status polling (`working` | `idle` | `needs_attention` | `ended`) integrates with recovery and idle nudges via `message`.
5. When the session's final assignment in the run finishes, Interlock calls `archive`.
6. A reference CLI custom harness script and contract integration test suite exercise both direct and launcher modes.
7. The UI in `packages/ui` provides a rich configuration experience adhering to the user-approved UI design in `.tasks/issue-233/ui-design.md`.

## Affected Users and Systems
- **Workflow Authors & Operators**: Can register custom agent tools, containerized agents, or HTTP agent services as executors.
- **Workflow Engine (`packages/core`, `packages/runtime`, `packages/server`, `packages/mcp`)**: Validates profiles, authorizes tickets, manages lifecycle, and executes turns.
- **UI (`packages/ui`)**: Adds custom harness creation and configuration dialog in the Harnesses settings view.

## Settled Decisions
- **UI Design**: Already reviewed and approved by the user (recorded in `.tasks/issue-233/decision.md`, detailed in `.tasks/issue-233/ui-design.md` and `.tasks/issue-233/proposal.md`).
- **Modes**: Two distinct modes: Direct Turn mode (subprocess / HTTP) and Delegated Launcher mode (subprocess / HTTP with lifecycle hooks).
- **Claim Tickets**: One-time token bound to `workId` issued during launch that only the launched session can present to `claim_work`.
- **Review Policy**: `auto`.

## Constraints & Principles
- Follow repository conventions in `AGENTS.md`: execution rules in `packages/runtime`, contracts/graph validation in `packages/core`, persistence in `packages/storage`.
- Prefix every new environment variable defined by Interlock with `INTERLOCK_`.
- Backward compatibility: Built-in harnesses (`claude-code`, `codex`, `pi`) must continue functioning without disruption.
- Clean separation between draft-save validation and execution runtime validation.
- All testing and building strictly inside `/Users/dan/dev/interlock-worktrees/issue-233`.
