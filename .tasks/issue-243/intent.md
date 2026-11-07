# Intent: M4 Session Visibility: Name Templates, Deep Links & Live Tail

## Baseline Git Information
- **Task Branch**: `feat/issue-243`
- **Base Commit**: `8f7172e2cf6f768b59e377e8a9d16a505b822d56`

## Problem Statement
Operators monitoring long-running agent workflows struggle to identify which active agent session corresponds to which workflow item, requiring manual log hunting. In complex multi-agent pipelines with dozens of steps, generic session IDs or opaque process identifiers make correlation across Interlock's Run Inspector and native agent harnesses (such as Pi or custom harness launchers) cumbersome and slow.

## Desired Outcome
1. **Templated Session Naming**:
   - Support session name templates evaluated from run data (e.g. `{{externalTask.id}} {{node.label}}: {{externalTask.title}}` or fallback tokens like `{{runId}}`, `{{node.id}}`, etc.).
   - Configure session name templates at profile level (or workflow/node level where applicable) and pass resolved session names to harnesses that support naming (H6 custom launcher, Pi, etc.).
2. **Harness Deep Links & Session Resume**:
   - Expose native `sessionId` alongside a copyable resume command or clickable deep link in inspection (run/work API, briefing, MCP) and UI (Run Inspector) when provided by the harness adapter or custom launcher.
3. **Bounded Live Message Tail in Run Inspector**:
   - Maintain a bounded live tail buffer (e.g. last 20 messages) of recent session progress in Run Inspector and executor inspection without leaking credentials or overwhelming memory.
4. **Verification & Non-Leaking Safety**:
   - Unit and integration tests verify template evaluation, deep link generation, and live tail buffering without exposing claim tokens or secret credentials.

## Affected Users and Systems
- **Operators & Workflow Authors**: Easily identify sessions in external dashboards or CLI lists, copy resume commands, and view live progress directly in Run Inspector.
- **Packages Touched**:
  - `packages/core`: Type definitions and schemas for session name templates, deep links, resume commands, and live tail messages.
  - `packages/runtime`: `ExecutorManager` session naming interpolation, harness adapters (custom, Pi), and live message ring buffer.
  - `packages/server`: Routing and endpoints exposing session visibility and live message tail.
  - `packages/mcp`: Inspection tool responses (`manage_executors`, `get_run_briefing`) exposing session info and live progress safely.
  - `packages/ui`: Run Inspector UI displaying live tail, native session ID, copyable resume command, and deep link.
- **Documentation**:
  - `docs/managed-executors.md`
  - `docs/architecture.md`

## Settled Decisions
- Review policy: `auto`.
- Standard template syntax: mustache-style `{{field}}` expressions evaluated against run context (run, node, work, externalTask).
- Live tail buffer: Bounded ring buffer per active execution (e.g. 20 messages) kept in memory and exposed in inspection.
- Security: Never leak claim tokens, internal tickets, or authorization secrets into session names, deep links, resume commands, or live tail logs.

## Constraints & Principles
- Follow `AGENTS.md` guidelines: execution rules in `packages/runtime`, contracts/schemas in `packages/core`, UI components in `packages/ui`.
- Add a patch changeset for `@type_of/interlock`.
- Keep changes tested and verified via `pnpm test`, `pnpm build`, and `pnpm format:check`.
