# Specification: M4 Session Visibility: Name Templates, Deep Links & Live Tail

## Overview
This specification defines observable behavior and contracts for Issue #243: templated session naming, harness deep links and resume commands, and bounded live message tail in Run Inspector.

Reference [Intent](./intent.md) for problem context, goals, and constraints.

---

## Acceptance Criteria

### AC1: Session Name Templates
1. An executor profile can optionally define `sessionNameTemplate: string` (e.g. `{{externalTask.id}} {{node.label}}: {{externalTask.title}}`).
2. At launch/turn dispatch time, Interlock evaluates `sessionNameTemplate` against run context:
   - `externalTask`: `{ id, system, url, title }`
   - `node`: `{ id, label, kind }`
   - `run`: `{ id, status }`
   - `work`: `{ id, attempt }`
3. Missing or undefined fields resolve to empty string without throwing.
4. Resolved session names are trimmed, bounded to a maximum length (e.g. 200 characters), and sanitized of newlines/control characters.
5. If no `sessionNameTemplate` is defined on the profile, Interlock falls back to default naming: `interlock-${work.runId}-${work.id}` (or existing harness convention).
6. The evaluated session name is passed:
   - To custom harness direct turn and launcher mode via context JSON payload `sessionName`, environment variable `INTERLOCK_SESSION_NAME`, and token `$INTERLOCK_SESSION_NAME`.
   - To Pi via `--session-name` argument when launching a new session.

### AC2: Native Session ID, Resume Commands & Deep Links
1. `ManagedExecution` in `packages/core` includes:
   - `sessionId?: string`
   - `resumeCommand?: string`
   - `deepLink?: string`
2. An executor profile can configure:
   - `resumeCommandTemplate?: string` (e.g. `my-harness resume {{sessionId}}`)
   - `deepLinkTemplate?: string` (e.g. `https://agent.corp.internal/sessions/{{sessionId}}`)
3. Templates are evaluated when `sessionId` is established, substituting `{{sessionId}}`, `{{workId}}`, `{{runId}}`, `{{cwd}}`.
4. Harnesses can also report `resumeCommand` and `deepLink` directly:
   - Custom turn envelope and launcher status/output response can return `resumeCommand?: string` and `deepLink?: string`.
   - Pi adapter automatically sets `resumeCommand: "pi --session " + sessionId`.
   - Claude adapter automatically sets `resumeCommand: "claude resume " + sessionId`.
5. Direct values returned by a harness take precedence over template-evaluated values.

### AC3: Bounded Live Tail Buffer in Run Inspector
1. Interlock maintains a bounded ring buffer of the most recent progress messages (last 20 messages) per execution attempt.
2. In `ManagedExecutionPanel` / `RunInspector`, the live message tail is displayed prominently for active or waiting executions:
   - Shows timestamp and message.
   - Updates as progress messages arrive without requiring expanding collapsed details.
   - For completed or failed attempts, shows the final 20 messages in execution details.
3. Message entries are sanitized to prevent credential leaks (stripping authorization tokens, tickets, or sensitive keys).

### AC4: API & MCP Inspection
1. `manage_executors` with action `inspect` returns `sessionId`, `resumeCommand`, `deepLink`, and `logs` (bounded to latest 20 items).
2. Work discovery summaries (`managedWorkSummarySchema`) expose `sessionId`, `resumeCommand`, `deepLink` when available.
3. Briefing items (`get_run_briefing`) preserve access to session resume details when human intervention is needed.

### AC5: Security and Non-Leaking Verification
1. Claim tokens, internal tickets, and secret credentials are never interpolated into session names, resume commands, deep links, or logs.
2. URLs in deep links must use `http:` or `https:` protocols.

---

## UI Proposal

### Layout & Placement in `ManagedExecutionPanel`
1. **Session Visibility Banner / Header**:
   - When `sessionId` is present, display a dedicated row:
     - **Session ID**: monospace text tag.
     - **Copy Resume Command**: A button with copy icon (using `navigator.clipboard.writeText`) that copies `resumeCommand` to clipboard with visual feedback ("Copied!").
     - **Open in Harness / Deep Link**: A clickable link button opening `deepLink` in a new tab (`target="_blank" rel="noopener noreferrer"`).
2. **Live Tail Section**:
   - For currently active/running attempts (and held/needs_attention attempts), show a **Live progress** box above the collapsibles.
   - Bounded box displaying up to 20 recent messages with timestamps.
   - Monospace typography, subtle border, auto-scrolling to bottom on new messages.
   - When empty, shows a subtle placeholder ("Waiting for agent activity...").
3. **Responsive & Keyboard Behavior**:
   - All interactive elements (copy button, deep link) are fully keyboard-navigable (`Tab`, `Enter`, `Space`).
   - On narrow screens (< 600px), buttons stack cleanly without overflowing.
