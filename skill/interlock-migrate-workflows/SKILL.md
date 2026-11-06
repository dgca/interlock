---
name: interlock-migrate-workflows
description: Audit or migrate an existing Interlock workflow and its callers. Use when replacing standalone Condition or Switch nodes with result routing, adopting newer bindings or execution features, or checking compatibility before publishing a new version.
---

# Migrate an Interlock workflow

## Establish the baseline

1. Identify the Interlock instance, workflow ID, and scope of the request. For an audit, use read-only tools and return a plan. For an authorized edit, work on a draft. Treat publishing and updating callers as separate decisions.
2. Read the current draft and `draftRevision` with `get_workflow`. Use `list_workflow_versions` to identify the published definitions that callers actually use. Inspect Workflow nodes in the library, including Batch members and owned children, for version pins. Ask for or inspect known external callers for implicit latest-version starts, response parsers, and checks that depend on node IDs. Record callers you could not inspect.
3. Check the connected engine version and available tools. Result routing first shipped in 0.2.10. Check each proposed feature against the target instance and use `validate_workflow` with a candidate definition to check support and publication readiness. An editor or CLI running a newer version is insufficient evidence for a different engine.
4. Record representative inputs, expected routes and outputs, failure behavior, and observable side effects. Before editing, save a local `export_workflow` backup. Keep the existing draft as the edit base, including unpublished customizations. Record local test suites separately because portable exports exclude them. [Portable bundle contents](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#export-and-import-portable-bundles)

## Choose changes

Classify each candidate as compatible cleanup, intentional behavior change, unsupported, or unnecessary. Prioritize changes by benefit and verification cost. Apply intentional behavior changes only when the user authorizes them.

- **Result routing and output fields.** If a standalone Condition or Switch follows an Agent, Script, Fetch, or waited Workflow, use the [branch migration recipe](references/fold-a-branch.md) to decide whether to fold it into the producing node.
- **Bindings and defaults.** Preserve downstream field names and types. Use original workflow or item input to carry stable configuration past an Agent. Keep literal dotted keys distinct from nested objects. A default handles a missing field and preserves explicit null, false, zero, and empty text. [Step data and bindings](https://github.com/dgca/interlock/blob/main/docs/node-data.md)
- **Polling Waits and failure routes.** Before replacing a loop with a polling Wait, compare check timing, attempt limits, timeout output, and check side effects. Before adding recovery, check which errors follow the Failed route and which stop the run. Recovery can turn a failed run into a completed run. [Waits and deadlines](https://github.com/dgca/interlock/blob/main/docs/timers.md) · [Failure routes](https://github.com/dgca/interlock/blob/main/docs/failure-routes.md)
- **Saved prompts.** When extracting shared instructions, preserve the composed text and order. A prompt revision can affect future runs of multiple published versions. Identify those consumers before editing a shared prompt. [Saved prompts](https://github.com/dgca/interlock/blob/main/docs/prompts.md)
- **Compact MCP responses.** Audit external clients that read full records from `start_run`, `submit_result`, or `list_work`. Update their reads for summaries or request the explicit full response. [MCP response defaults](https://github.com/dgca/interlock/blob/main/docs/upgrading.md#mcp-response-defaults-in-02)

## Edit and verify

1. Validate the candidate with `validate_workflow`. Compare diagnostics with the baseline. For a scoped change, use one `edit_workflow` call with stable IDs and the recorded `draftRevision`. If the revision is stale or delivery is uncertain, re-read the draft and check which changes landed before retrying. Check the saved revision, changed IDs, and diagnostics.
2. Compare baseline and candidate with equivalent cases in an isolated test library. Use fixture simulation for supported flat graphs. It runs only published versions, so publish test copies in the isolated library. Compare selected routes, forwarded values, final status, and expected errors. Use a controlled test for unsupported nodes or live behavior that fixtures cannot establish. Report any checks you could not run. [Fixture simulation](https://github.com/dgca/interlock/blob/main/docs/workflow-simulation.md)
3. Report the workflow ID, baseline version, candidate draft revision, changed and retained nodes, evidence, and gaps. Show which consumers would change when the candidate becomes latest. For authorized publication, recheck the draft revision and validate it immediately before publishing. Update only approved caller pins. Keep the previous published version available for explicit starts or repinning. For callers that always start latest, plan recovery by republishing the prior definition as a new version. Track shared prompt changes separately because a workflow version does not pin the prompt content for future ordinary starts.

See [draft edits and diagnostics](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md#edit-a-draft-atomically) for MCP arguments and return fields.
