# Issue #233 UI Proposal: Custom Harness Definitions & Launcher Adapter

## Overview
This proposal defines the user interface design for GitHub issue #233: **H6: Custom harness definitions & launcher adapter (`harness: "custom"`)**.

It covers the additions to `packages/ui/src/features/executors/`, specifically the **Harnesses screen** and the new **Custom Profile Editor Dialog** (`CustomProfileDialog.tsx`), enabling users to configure both **Direct Turn** execution (CLI subprocess or HTTP endpoint) and **Delegated Claim-Ticket** execution (Launcher with lifecycle hooks).

---

## 1. Interaction Design & Workflow

### 1.1 Discovery & Listing
In `packages/ui/src/features/executors/Harnesses.tsx`:
- The existing profile list displays built-in harnesses (`Claude Code`, `Codex`, `Pi`) and any saved custom harnesses.
- Custom profiles feature:
  - Custom identity icon (Distinct CPU/Container icon in purple accent).
  - Mode badge: `custom: direct` or `custom: launcher`.
  - Protocol summary in subtitle: e.g. `Subprocess CLI · Turn: python -m agent · Timeout: 120s · standard permissions` or `HTTP POST https://agent.internal/launch · 4 hooks · full-access`.
  - Status badge: `Configured` (or `Ready` / `Endpoint Reachable`).
  - Standard `Enabled` switch and `Configure` action button.
- Clicking **Configure** on a custom profile opens the modal dialog (`CustomProfileDialog`), while built-in profiles continue using their compact inline configuration editor.

### 1.2 Creation Flow
- Clicking **Add configuration** expands the creation card.
- In the **Harness** dropdown, users can choose:
  - Codex
  - Claude Code
  - Pi
  - **Custom Harness (`harness: "custom"`)**
- Selecting Custom Harness presents a **Continue with Custom Setup…** button that immediately opens `CustomProfileDialog` with pre-filled defaults.

---

## 2. Detailed Modal Component Specification (`CustomProfileDialog.tsx`)

### 2.1 Dialog Architecture
- Uses Interlock's standardized `<Modal size="xl" title="Configure Custom Harness Profile" onClose={...}>` with `<ModalBody>` and `<ModalFooter>`.
- Internal form is split into four logical cards/fieldsets:

#### Card 1: General Information
- `name`: `<TextInput label="Configuration Name" required maxLength={120} />`
- `id`: `<TextInput label="Configuration ID" readOnly />` (auto-generated slug like `custom-python-agent-8f3a`).

#### Card 2: Execution Mode & Transport
- **Execution Mode**:
  `<SegmentedControl data={[{ label: 'Direct Turn Mode', value: 'direct' }, { label: 'Delegated Claim-Ticket Mode (Launcher)', value: 'launcher' }]} />`
  - *Direct Turn Mode*: Interlock invokes the harness directly per assignment turn and awaits the result envelope.
  - *Delegated Launcher Mode*: Interlock dispatches an assignment claim ticket to an external launcher/orchestrator which manages its own execution loop.
- **Transport Protocol**:
  `<SegmentedControl data={[{ label: 'Subprocess (CLI)', value: 'subprocess' }, { label: 'HTTP Endpoint', value: 'http' }]} />`
- **Execution Timeout**:
  `<NumberInput label="Execution Timeout (seconds)" min={1} placeholder="Optional" />`
- **Default Permissions**:
  `<NativeSelect label="Default Permissions" data={['standard', 'read-only', 'full-access']} />`
- **Environment Variables**:
  - Key-value table editor (`Name`, `Value`, delete button, `+ Add variable`).
  - Template chip inserters for:
    - `$INTERLOCK_WORK_ID`
    - `$INTERLOCK_RUN_ID`
    - `$INTERLOCK_CWD`
    - `$INTERLOCK_CLAIM_TOKEN`

#### Card 3: Endpoints & Commands / Lifecycle Hooks
- **When Direct Turn Mode**:
  - *If Subprocess*:
    - Turn Command input (`TextInput`, monospace), e.g. `python -m my_agent.turn --work-id $INTERLOCK_WORK_ID`.
  - *If HTTP Endpoint*:
    - Endpoint URL input (`TextInput`, monospace), e.g. `https://agent-service.internal/api/turn`.
    - HTTP Headers key-value editor (e.g. `Authorization: Bearer ...`).
- **When Delegated Launcher Mode**:
  - Primary Launch Action (`launchCommand` or `launchUrl`):
    - Monospace input for launching container or daemon (e.g. `docker run -d --name agent-$INTERLOCK_WORK_ID my-agent:latest --claim $INTERLOCK_CLAIM_TOKEN`).
  - Optional Lifecycle Hooks (clean collapsible cards):
    1. **Status Polling Hook**: Monospace input for status check command or URL (polled periodically).
    2. **Message & Human Input Hook**: Monospace input for delivering questions/answers to agent.
    3. **Stop & Cancellation Hook**: Monospace input for terminating agent session on cancel.
    4. **Archive & Cleanup Hook**: Monospace input for removing container or archiving logs on finish.

#### Card 4: Directory Containment & Security
- `cwd`: Starting directory (`TextInput`, monospace, absolute path validation).
- `allowedRoots`: Multi-item absolute path containment list editor (per Issue #232 dynamic cwd binding).
  - Add root button, remove button.
  - Ensures tasks resolving outside allowed roots fail safely with `cwd_blocked`.

### 2.2 Modal Footer
- Inline error banner (hidden until validation error occurs).
- Action buttons:
  - `<Button variant="default" onClick={onClose}>Cancel</Button>`
  - `<Button variant="primary" type="submit">Save configuration</Button>`

---

## 3. Visual Layout Wireframes

### Harnesses Listing Row
```text
+----------------------------------------------------------------------------------------------------+
| [CPU] Local Python Agent  [custom: direct]                      [Configured]  [ (o) Enabled ] [Edit] |
|       Subprocess CLI · Turn: python -m agent.turn · Timeout: 120s · standard permissions           |
+----------------------------------------------------------------------------------------------------+
| [ROK] Remote Docker Launcher  [custom: launcher]                [   Ready  ]  [ (o) Enabled ] [Edit] |
|       HTTP POST https://agent-gateway.internal/launch · 4 hooks · full-access                        |
+----------------------------------------------------------------------------------------------------+
```

### Custom Profile Editor Modal (Direct Mode)
```text
+----------------------------------------------------------------------------------------------------+
| [X] Configure Custom Harness Profile                                                           (X) |
+----------------------------------------------------------------------------------------------------+
| 1. General Information                                                                             |
|    Configuration Name *                  Configuration ID (Readonly)                               |
|    [ Local Python Agent               ]  [ custom-python-agent                                   ] |
|                                                                                                    |
| 2. Execution Mode & Transport                                                                      |
|    Mode:      ( [ Direct Turn Mode ] |   Delegated Claim-Ticket Mode (Launcher)   )                 |
|    Transport: ( [ Subprocess (CLI) ] |   HTTP Endpoint                            )                 |
|    Timeout (s): [ 120                 ]  Permissions: [ Standard (Interlock policy)             v] |
|                                                                                                    |
|    Environment Variables:                                                  [+ Add variable]        |
|      [ AGENT_LOG_LEVEL             ] [ debug                         ]  [Trash]                    |
|      [ MODEL_NAME                  ] [ claude-3-7-sonnet             ]  [Trash]                    |
|    Tokens: [$INTERLOCK_WORK_ID] [$INTERLOCK_RUN_ID] [$INTERLOCK_CWD] [$INTERLOCK_CLAIM_TOKEN]      |
|                                                                                                    |
| 3. Turn Command & Invocation                                                                       |
|    Turn Command *                                                                                  |
|    [ python -m my_agent.turn --work-id $INTERLOCK_WORK_ID                                        ] |
|                                                                                                    |
| 4. Directory Containment & Security                                                                |
|    Working Directory (cwd): [ /Users/dan/dev/interlock                                           ] |
|    Allowed Roots:                                                          [+ Add allowed root]    |
|      [ /Users/dan/dev                                                ]  [Trash]                    |
|      [ /tmp/agent-workspaces                                         ]  [Trash]                    |
+----------------------------------------------------------------------------------------------------+
|                                                                         [ Cancel ] [ Save Config ] |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. Verification Evidence & Artifacts

- **Interactive Prototype**: `.tasks/issue-233/prototype/index.html`
- **Rendered Proof Screenshots**:
  - `01-harnesses-listing.png`: Main listing showing both built-in and custom harnesses.
  - `02-custom-profile-direct-mode.png`: Custom Profile Dialog in Direct Turn Mode (Subprocess CLI).
  - `03-custom-profile-launcher-mode.png`: Custom Profile Dialog in Delegated Launcher Mode with lifecycle hooks.
  - `04-mobile-narrow-viewport.png`: Mobile narrow responsive viewport (390px).
