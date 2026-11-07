# Issue #233 UI Design Context: Custom Harness Definitions & Launcher Adapter

## Scope & Objective
Design the user interface in `packages/ui/src/features/executors/` (the Harnesses configuration page and profile editor) to support custom harness definitions (`harness: "custom"`) and launcher adapters for Interlock issue #233.

## Requirements
1. **Creation and Editing**:
   - Allow adding a new profile with harness type `custom` alongside built-in harnesses (`claude-code`, `codex`, `pi`).
   - Allow editing existing custom profiles, viewing their configuration, and updating their settings with optimistic revision checking.
2. **Execution Modes**:
   - **Direct Turn Mode**: Subprocess command or HTTP endpoint, optional execution timeout, environment variables, working directory, and allowedRoots containment.
   - **Delegated Claim-Ticket Mode (Launcher)**: Launch command or HTTP endpoint, with optional lifecycle hooks for status polling, message sending, stopping, and archiving.
3. **Purposeful UI (AGENTS.md guidelines)**:
   - Reuse Mantine theme, components, and existing design tokens.
   - Clear field groupings:
     - **General**: Name, Configuration ID, Harness type selector, Enabled status.
     - **Mode & Execution**: Execution mode selector (Direct Turn vs. Delegated Claim-Ticket), Protocol type (Subprocess CLI vs. HTTP Endpoint), Timeout, Environment variables.
     - **Endpoints & Commands**: Command line string / executable or HTTP URL, headers, and lifecycle endpoints (Status, Message, Stop, Archive).
     - **Containment & Security**: Working directory, allowedRoots list, permissions policy.
   - Purposeful microcopy: Omit generic filler copy; provide clear, contextual validation and concise technical guidance where needed.
4. **Prototypes and Artifacts**:
   - All design artifacts and prototypes stay inside `.tasks/issue-233/`.
   - Production source code remains unmodified during the design phase.

## Source References
- `packages/ui/src/features/executors/Harnesses.tsx`: Main harnesses listing and inline profile configuration editor.
- `packages/ui/src/features/executors/Harnesses.module.css`: Layout and styling using CSS modules and Mantine theme tokens.
- `packages/ui/src/features/executors/ExecutionSettings.tsx`: Shared concurrency and global execution settings.
- `packages/core/src/executors.ts`: Zod schemas and TypeScript interfaces for profiles, settings, and executor operations.
- `docs/managed-executors.md`: Managed executor architecture, containment, and configuration semantics.

## Environment & Snapshot
- Working tree: `/Users/dan/dev/interlock-worktrees/issue-233`
- Branch: `feat/issue-233`
- HEAD commit: `9f64487bf52deead307e4acba47939bae883b8c7`
- Fingerprints: See `.tasks/issue-233/snapshot.json`
- Verification gap: Development UI server URL omitted (pure static UI design & wireframe review in WIP).
