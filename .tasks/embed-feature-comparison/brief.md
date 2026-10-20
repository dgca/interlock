# Embedder UI configuration — shared implementation brief

Implement GitHub issue #125 in Interlock. The user approved this scope and explicitly requested two independent implementations, one using published SDLC and one handled directly, followed by a comparison. Work only in your assigned checkout. Do not inspect the other candidate, its artifacts, commits, agents, or results.

## Agreed scope

- Add a namespaced startup configuration: window.**INTERLOCK_CONFIG** = { ui: { features: { localFileImport: false, connectAgent: false } } }.
- Read configuration once at startup. Both features default to enabled; existing standalone behavior remains unchanged without configuration. Unknown settings are ignored. Handle malformed configuration predictably without crashing.
- Support equivalent startup URL parameters for hosts framing the served UI. Explicit host configuration takes precedence over URL settings. Choose and document a small, unambiguous parameter format. Do not persist configuration in web storage or change it during client-side navigation.
- localFileImport:false removes the Local file import source and hidden file input. GitHub folder is already the default source.
- connectAgent:false removes sidebar Connect with MCP, waiting-run Connect an agent, and all ways to open the connection dialog. Adjust related guidance so hidden capabilities are not suggested. Keep Copy instructions for agent and existing handoff behavior.
- Add Paste JSON import, available to all users. It accepts the same legacy workflow JSON and portable bundles as local-file import, uses existing shared server operations/validation, and provides clear invalid-JSON/import feedback. Explicit user action is required to import. Preserve existing conflict, identity, ownership, saved-prompt, and publication behavior. Import does not run workflows.
- Custom API transport/fetch/EventSource injection is outside scope. No changes for issues #124 or #126.

## Project and completion requirements

Read AGENTS.md, CONTEXT.md, relevant architecture and scope docs. Follow repository boundaries and current shared UI patterns. Use applicable skills. Use temporary databases for tests and preserve user data. Check README, relevant docs, CLI help, and affected MCP descriptions against the implementation; update only where behavior requires it. Add a pending patch changeset for @type_of/interlock. Run relevant tests, pnpm build, and pnpm format:check. Run package smoke only if your changes affect packaging, CLI startup, or versions. Include real browser verification of configuration and import flows with both normal and embedded settings; record any verification gaps honestly. Use your assigned browser session and test ports.

Make ordinary design choices within this approved scope. Ask the coordinator if a material user decision is unresolved. Do not treat the comparative experiment as approval for new scope. Commit the completed candidate locally; do not push, open a PR, merge, publish, or modify the running server's workflows. Record start/end times, tests and outcomes, human questions, repairs, and limitations in .tasks/embed-feature-comparison/. Do not invent model, token, cost, or timing metrics.

The root coordinator will evaluate frozen candidates independently. Do not optimize for a hidden score, patch the other implementation, or claim verification you did not perform.
