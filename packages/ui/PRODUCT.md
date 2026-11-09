# Interlock product context

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Prioritize developers working with coding agents. Most users work through MCP and use the browser UI to inspect runs and verify workflows. Some users create workflows directly in the UI. Direct visual authoring remains a supported way to use the product.

## Product purpose

Interlock is a local workflow editor and engine for repeatable procedures that agents and people can execute and inspect. A workflow combines agent assignments with scripts, HTTP requests, routing, waits, and reusable workflows.

Success means users can define a procedure once, run a published version, understand its progress and results, and decide what to do when work pauses or fails.

## Positioning

Interlock coordinates work through connected agent executors and opt-in managed execution through locally configured harnesses. It owns workflow execution rules, validates inputs and results, and persists progress. Harnesses supply model access, tools, and skills; Interlock can launch and manage their agent sessions when managed execution is configured.

The browser editor, CLI, and MCP tools use the same server API and execution rules. Users can author through MCP and inspect the resulting definition and runs in the UI, or create the workflow visually.

## Operating context

Interlock currently runs as a local, single-user application on macOS or Linux. The browser UI connects to a running engine, which stores workflows and run history in SQLite. Closing the browser does not stop the engine.

The UI has workflow, run, and saved-prompt views. Workflow authoring includes a visual graph, raw JSON editing, input and output contracts, and review before publication. Run inspection shows execution states, inputs, outputs, errors, and nested work.

Starting a run in the UI can dispatch Agent work automatically when managed execution is enabled and a suitable harness is configured. Connected-agent workflows retain assignment discovery and handoff. The UI must distinguish waiting, claimed, and blocked work and show the next action when execution needs intervention.

## Capabilities and constraints

These describe current behavior, not permanent limits. Interlock is actively adding features. Verify implementation and [current scope](../../docs/v1.md) before making new capability claims.

- Drafts are editable. Runs use published versions whose definitions remain immutable while retained. Editing a draft does not change an existing run.
- Draft saving and publication have separate validation rules. Incomplete graphs can be saved; publication checks whether the graph can run.
- Visual and raw editing operate on the workflow definition. Raw editing does not expose the full stored workflow record.
- Agent work can use a connected executor, supported manual submission, or opt-in managed execution through local Claude Code, Codex, Pi, and custom harnesses. Managed execution uses configured profiles and the same claim and result validation rules. See [managed execution](../../docs/managed-executors.md) for configuration and limits.
- Input and output contracts validate execution data. Editor suggestions and preflight diagnostics do not prove that all connected contracts are compatible.
- Runs and event history persist. Retry is explicit and can repeat external effects.
- New script nodes default to JavaScript. Definitions without a language retain legacy Bash behavior. Scripts currently execute outside a sandbox.
- Reuse includes library workflows, owned child workflows, saved prompts, and portable imports and exports. Detailed ownership and execution limits belong in the linked product docs.

Use [CONTEXT.md](../../CONTEXT.md) for domain terminology and [architecture and execution semantics](../../docs/architecture.md) for behavior. Distinguish a workflow, its draft, a published version, a run, and a node execution in UI copy.

## Brand commitments

The product name is Interlock. The public npm package is `@type_of/interlock`, and the executable is `interlock`.

UI copy should help users understand, decide, or act. Use existing navigation and titles for context. Add guidance when it explains a non-obvious behavior, consequence, or next step; omit generic filler and repeated labels.

## Evidence on hand

- [README](../../README.md) documents installation and user workflows.
- [Current scope](../../docs/v1.md) records implemented capabilities and limits.
- [Workflow examples](../../workflows/README.md) includes the SDLC starter and an all-node editor reference. These demonstrate behavior; they are not performance or outcome claims.
- The existing UI implementation and [favicon](public/favicon.svg) provide product assets. This record does not define or replace the visual system.

## Product principles

- Make MCP-authored work understandable in the UI. Users need to verify definitions and inspect execution without reconstructing the agent conversation.
- Support direct UI authoring as a complete workflow, including editing contracts, saving incomplete drafts, and reviewing publication changes.
- Make execution state and the next available action clear, especially when waiting for an executor, handling a failure, or resuming work.
- Preserve the distinction between editable procedures and the published definitions used by runs.
- Keep product claims aligned with shipped behavior as capabilities change.
