# UI Design Specification: Custom Harness Definitions & Launcher Adapter (Issue #233)

## 1. User Task & Intent
- **Goal**: Enable users and operators to define, configure, test, and manage custom agent harness profiles (`harness: "custom"`) in Interlock without modifying core engine source code.
- **Problem**: Previously, Interlock only supported built-in native harnesses (`claude-code`, `codex`, `pi`). Users with proprietary agents, internal agent microservices, Docker/Kubernetes container workers, or tmux/daemon runners could not register them as first-class executors in the Interlock UI and workflow engine.
- **Desired Outcome**:
  1. Add and configure custom harness profiles directly in the **Harnesses** screen.
  2. Support two execution paradigms:
     - **Direct Turn Mode**: Interlock invokes the agent per assignment turn (via local subprocess CLI command or remote HTTP POST) and awaits output.
     - **Delegated Claim-Ticket Mode (Launcher)**: Interlock delegates assignment claim tickets to an external launcher/orchestrator (e.g. Docker container, worker daemon), monitoring and controlling execution via optional lifecycle hooks (`status`, `message`, `stop`, `archive`).
  3. Comply strictly with Interlock visual conventions (Mantine theme, design tokens, purposeful copy, responsive layouts).

---

## 2. Primary Actions & Interaction Sequence

### A. Main Harnesses Listing (`Harnesses.tsx`)
1. **Summary Badges & Metadata**:
   - Built-in harnesses display `Detected` / `Not installed` / `Unavailable`.
   - Custom profiles display `custom: direct` or `custom: launcher` badge (accent purple), along with transport indicator (`CLI Executable` or `HTTP Service`).
   - Profile subtitle succinctly summarizes configuration: e.g. `Subprocess CLI · Turn command: python -m agent · Timeout: 120s · standard permissions`.
   - Enable switch allows toggling between active/inactive.
2. **Add Custom Configuration**:
   - User clicks **Add configuration** at bottom.
   - Form expands with `Name` text input and `Harness` native select (`Codex`, `Claude Code`, `Pi`, `Custom Harness (harness: "custom")`).
   - Selecting `Custom Harness` presents **Continue with Custom Setup…**, which opens the dedicated `CustomProfileDialog` modal.

### B. Custom Profile Editor Dialog (`CustomProfileDialog.tsx`)
1. **Dialog Presentation**:
   - Standard Mantine Modal (`size="xl"`, 760px max width).
   - Clean grouping into 4 distinct sections:
     - **General Information**: Profile Name and read-only Configuration ID.
     - **Execution Mode & Transport**: SegmentedControl toggles between `Direct Turn Mode` and `Delegated Claim-Ticket Mode (Launcher)`, and between `Subprocess (CLI)` and `HTTP Endpoint`. Includes Execution Timeout and Default Permissions select.
     - **Environment Variables**: Key-value table for subprocess environment variables with quick-insert token chips (`$INTERLOCK_WORK_ID`, `$INTERLOCK_RUN_ID`, `$INTERLOCK_CWD`, `$INTERLOCK_CLAIM_TOKEN`).
     - **Endpoints & Commands / Lifecycle Hooks**: Dynamic section tailored to mode:
       * Direct Subprocess: Turn command line template with STDOUT JSON parsing.
       * Direct HTTP: Endpoint URL, HTTP method (POST), and HTTP headers key-value table.
       * Delegated Launcher: Launch command / HTTP URL, plus collapsible cards for 4 optional lifecycle hooks:
         1. *Status Polling Hook* (GET / command)
         2. *Message & Human Input Hook* (POST / command)
         3. *Stop & Cancellation Hook* (POST / command)
         4. *Archive & Cleanup Hook* (POST / command)
     - **Containment & Security**: Working directory (`cwd`) input, and `allowedRoots` multi-path containment editor (per Issue #232) ensuring sandboxed execution.
2. **Save & Validation Flow**:
   - Validates required fields (non-empty command or valid HTTP/HTTPS URL, absolute paths for `cwd` and `allowedRoots`).
   - If validation fails, an inline error banner appears next to the action buttons in the modal footer.
   - On save, submits to server API `executors.manage` action `'save'` with optimistic revision check (`expectedRevision`).

---

## 3. Visual Wireframes & ASCII Layouts

### A. Harnesses Screen Listing Row (Custom Harness)
```text
+----------------------------------------------------------------------------------------------------+
| [>]  Local Python Agent  [custom: direct]                      [Configured]  [ (o) Enabled ] [Edit] |
|      Subprocess CLI * Turn: python -m agent.turn * Timeout: 120s * standard permissions           |
+----------------------------------------------------------------------------------------------------+
| [^]  Remote Docker Launcher  [custom: launcher]                [   Ready  ]  [ (o) Enabled ] [Edit] |
|      HTTP POST https://agent-gateway.internal/launch * 4 hooks * full-access                        |
+----------------------------------------------------------------------------------------------------+
```

### B. Custom Profile Modal Dialog Layout (760px)
```text
+----------------------------------------------------------------------------------------------------+
| [X] Configure Custom Harness Profile                                                           (X) |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  +- 1. General Information --------------------------------------------------------------------+   |
|  | Configuration Name *                   Configuration ID                                     |   |
|  | [ Local Python Agent               ]   [ custom-python-agent                             ]  |   |
|  |                                        Stable identifier referenced in workflows and MCP.   |   |
|  +---------------------------------------------------------------------------------------------+   |
|                                                                                                    |
|  +- 2. Execution Mode & Transport -------------------------------------------------------------+   |
|  | Execution Mode:                                                                             |   |
|  | ( [ Direct Turn Mode ] |   Delegated Claim-Ticket Mode (Launcher)   )                       |   |
|  | Executes each assignment as an immediate single turn via subprocess or HTTP POST.           |   |
|  |                                                                                             |   |
|  | Transport Protocol:                                                                         |   |
|  | ( [ Subprocess (CLI) ] |   HTTP Endpoint                            )                       |   |
|  |                                                                                             |   |
|  | Timeout (seconds)                      Default Permissions                                  |   |
|  | [ 120                              ]   [ Standard (Interlock tool approval policy)       v] |   |
|  |                                                                                             |   |
|  | Environment Variables:                                            [+ Add variable]          |   |
|  |   VARIABLE NAME                   VALUE                                                     |   |
|  |   [ AGENT_LOG_LEVEL             ] [ debug                         ]  [Trash]                |   |
|  |   [ MODEL_NAME                  ] [ claude-3-7-sonnet             ]  [Trash]                |   |
|  | Template tokens: [$INTERLOCK_WORK_ID] [$INTERLOCK_RUN_ID] [$INTERLOCK_CWD]                  |   |
|  +---------------------------------------------------------------------------------------------+   |
|                                                                                                    |
|  +- 3. Turn Command & Invocation --------------------------------------------------------------+   |
|  | Turn Command *                                                                              |   |
|  | [ python -m my_agent.turn --work-id $INTERLOCK_WORK_ID                                    ]  |   |
|  | Subprocess command line executed for each turn. STDOUT receives task result JSON.           |   |
|  +---------------------------------------------------------------------------------------------+   |
|                                                                                                    |
|  +- 4. Directory Containment & Working Directory ----------------------------------------------+   |
|  | Working Directory (cwd)                                                                     |   |
|  | [ /Users/dan/dev/interlock                                                                 ]  |   |
|  | Default starting folder for subprocesses. Must be an absolute path if provided.             |   |
|  |                                                                                             |   |
|  | Allowed Roots (allowedRoots)                                      [+ Add allowed root]      |   |
|  |   [ /Users/dan/dev                                                ]  [Trash]                |   |
|  |   [ /tmp/agent-workspaces                                         ]  [Trash]                |   |
|  | Constrains dynamic working directory binding. Resolving outside roots fails with cwd_blocked|   |
|  +---------------------------------------------------------------------------------------------+   |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
| [!] Validation message (if invalid)                                     [ Cancel ] [ Save Config ] |
+----------------------------------------------------------------------------------------------------+
```

### C. Delegated Launcher Mode (Lifecycle Hooks Section)
```text
+----------------------------------------------------------------------------------------------------+
|  +- 3. Launcher Command & Lifecycle Hooks -----------------------------------------------------+   |
|  | Launch Command / Endpoint *                                                                 |   |
|  | [ docker run -d --name agent-$INTERLOCK_WORK_ID my-agent:latest --claim $INTERLOCK_CLAIM_TK ]|  |
|  | Dispatches assignment claim ticket to spin up an independent agent daemon or container.     |   |
|  |                                                                                             |   |
|  | Lifecycle Hooks (Optional):                                                                 |   |
|  | > [i] Status Polling Hook         [GET / Polling]               Configured                v |   |
|  |     Command or URL: [ docker inspect --format='{{.State.Status}}' agent-$INTERLOCK_WORK_ID ]|   |
|  |                                                                                             |   |
|  | > [?] Message & Human Input Hook  [POST / Input]                Optional                  v |   |
|  |     Command or URL: [ curl -X POST https://agent-gateway/message -d '$INTERLOCK_INPUT'     ]|   |
|  |                                                                                             |   |
|  | > [!] Stop & Cancellation Hook    [POST / Abort]                Configured                v |   |
|  |     Command or URL: [ docker stop -t 10 agent-$INTERLOCK_WORK_ID                           ]|   |
|  |                                                                                             |   |
|  | > [x] Archive & Cleanup Hook      [Cleanup]                     Configured                v |   |
|  |     Command or URL: [ docker rm -f agent-$INTERLOCK_WORK_ID                                ]|   |
|  +---------------------------------------------------------------------------------------------+   |
```

---

## 4. Mantine Component Structure & Implementation Architecture

### File Layout in `packages/ui/src/features/executors/`:
```text
packages/ui/src/features/executors/
├── Harnesses.tsx              # Main listing view; adds "custom" option to Add Configuration
├── Harnesses.module.css       # Listing styles, custom harness badges & styling
├── CustomProfileDialog.tsx    # Modal dialog for custom harness configuration
├── CustomProfileDialog.module.css # Modal layout, section card styling, key-value table
├── KeyValueEditor.tsx         # Reusable key-value editor for headers & env vars
└── AllowedRootsEditor.tsx     # Reusable absolute-path containment list editor
```

### Key Mantine Components Reused:
- `Modal` from `components/Modal/Modal` (wraps Mantine Modal with focus trap and dark theme styling).
- `ModalBody`, `ModalFooter` from `components/Modal/ModalLayout`.
- `SegmentedControl`: Clean toggle between Direct and Launcher modes, and Subprocess vs HTTP.
- `TextInput`: Configuration name, ID, cwd, commands, and endpoint URLs.
- `NumberInput`: Timeout in seconds.
- `NativeSelect`: Permissions mode and harness type selector.
- `Badge`: Status and mode badges (`badge-blue`, `badge-purple`).
- `Button` from `components/Button/Button` (`variant="primary"`, `variant="ghost"`).
- Lucide icons (`Terminal`, `Rocket`, `Cpu`, `Trash2`, `Plus`, `ChevronDown`, `ChevronUp`, `AlertCircle`).

## 5. Review Decision & Settled Choices
- **Human Approval**: The UI design proposal was formally approved by the user ("Approve the UI design proposal and proceed with implementation").
- **Settled Choices**:
  1. *Default Execution Mode*: Initial custom profile setup defaults to **Direct Turn Mode (Subprocess CLI)** as the most common local agent pattern, with Delegated Launcher Mode readily selectable.
  2. *Secret Masking*: Headers and environment variables use clean text inputs; secret masking toggle is deferred to future security enhancements.
  3. *Lifecycle Hooks*: The four lifecycle hooks (`status`, `message`, `stop`, `archive`) provide complete coverage for launcher orchestrators.
- **Unresolved Consequential Choices**: None. All design choices are approved.

---

## 6. Prototype & Inspection Evidence

A fully styled, responsive, interactive prototype was built at:
`.tasks/issue-233/prototype/index.html`

### Preview & Verification Command:
```sh
open .tasks/issue-233/prototype/index.html
# or with headless Chrome screenshot inspection:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --window-size=1280,960 \
  --screenshot=.tasks/issue-233/evidence/01-harnesses-listing.png \
  "file://$PWD/.tasks/issue-233/prototype/index.html#listing"
```

### Captured Evidence Artifacts:
1. `evidence/01-harnesses-listing.png`: Main Harnesses listing demonstrating built-in profiles (Claude Code, Codex) alongside custom profiles (`Local Python Agent`, `Remote Docker Launcher`) with custom badges and configuration summaries.
2. `evidence/02-custom-profile-direct-mode.png`: Custom Profile Dialog in **Direct Turn Mode (Subprocess CLI)**, showing general metadata, timeout, permissions, environment variable table with token chips, turn command line, and `allowedRoots` containment directory list.
3. `evidence/03-custom-profile-launcher-mode.png`: Custom Profile Dialog in **Delegated Claim-Ticket Mode (Launcher)**, showing launch command/endpoint and collapsible lifecycle hooks (Status Polling, Message Delivery, Stop / Abort, Archive / Cleanup).
4. `evidence/04-mobile-narrow-viewport.png`: Responsive narrow mobile viewport (390px) demonstrating responsive stacking of grid fields, full-width inputs, and mobile-friendly touch targets.

---

## 6. Implementation Acceptance Criteria
1. **Schema Extension (`@interlock/core`)**:
   - `executorProfileSchema` accepts `harness: 'custom'`.
   - Supports `customMode: 'direct' | 'launcher'`, `transport: 'subprocess' | 'http'`, `timeoutSeconds`, `env`, `command`, `url`, `headers`, `launchCommand`, `launchUrl`, `lifecycleHooks` (`status`, `message`, `stop`, `archive`), `cwd`, and `allowedRoots`.
2. **UI Listing (`packages/ui/src/features/executors/Harnesses.tsx`)**:
   - "Add configuration" includes option for Custom Harness.
   - Profile rows render custom harness profiles cleanly with distinct visual badge and informative subtitle.
   - Clicking "Configure" on a custom profile opens `CustomProfileDialog`.
3. **Editor Dialog (`packages/ui/src/features/executors/CustomProfileDialog.tsx`)**:
   - Dynamically updates available fields based on Mode and Transport selections.
   - Clean validation: prevents saving empty commands, invalid URLs, or non-absolute paths in `allowedRoots`.
   - Supports token insertion (`$INTERLOCK_WORK_ID`, etc.) with one click.
   - Handles optimistic revision checking and error feedback.
