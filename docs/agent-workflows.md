# Author and operate workflows

## Discover schemas and assignments

MCP `create_workflow.definition` and `update_workflow.draft` expose the workflow object schema, including node fields and edge handles. Incomplete routes remain saveable drafts. Publication validates graph routes and pinned dependencies.

`start_run.input` and `submit_result.output` accept any JSON value matching the workflow or assignment contract, including objects, arrays, scalars, and null. Pass structured values directly. JSON-looking strings remain strings and are never implicitly parsed.

Agent `context.mode` accepts `current` or `fresh`. An executor satisfies `fresh` with a new session or an isolated subagent without inherited conversation history. `isolated` is not a mode value. Declare only tools, skills, and isolation that the executor provides.

For polling, call `list_work` with `fields: "summary"`. Summaries include assignment ID, run ID, node ID, label, status, context requirements, attempt counts, and any unclaimed deadline. They omit prompts, inputs, output schemas, and execution instructions. `claim_work` returns the complete assignment. The default `fields: "full"` preserves the existing response. CLI callers can use `interlock work RUN_ID --summary`. The shared API exposes `work.summaries` and `work.list`.

## Find runs

MCP `list_runs` and the shared API `runs.find` return summaries in descending creation order. The default limit is 50, with a maximum of 1000. Equal timestamps use descending insertion order.

Available filters are `workflowId`, `status`, `rootOnly`, and `inputMatch: {path, equals}`. Status accepts `running`, `waiting`, `completed`, `failed`, or `cancelled`. `rootOnly` defaults to false, which includes nested Workflow and Batch item runs. A summary includes IDs, workflow name, version, status, timestamps, cursor, input, and ancestry. Use `get_run` for execution details.

Paths use dot-separated object keys or array indices. A blank path selects the complete input. Equality compares JSON structure, including object values independently of key order. Missing paths do not match, even when `equals` is null. Workflow, status, and creation ordering have database indexes. Arbitrary input-path matching scans the selected candidates until the limit is reached.

```sh
interlock runs --workflow WORKFLOW_ID --status waiting --root-only --limit 20
interlock runs --input-path thread_ts --equals '"1787334538.500319"' --limit 10
```

Without flags, `interlock runs` retains its full history dump. The shared `runs.list` endpoint also retains its original response.

Listing before starting a run is not atomic deduplication. A dispatcher that requires one active run per key must serialize starts or maintain its own atomic reservation.

## Bind original input into later steps

Optional `inputBindings` constructs a replacement input object before the node's input contract is checked. Each output field selects a `source` and a dot-separated `path`. Omitted or blank paths select the entire source. Missing paths fail that node. Omitting `inputBindings` retains the previous node's complete output as input. An explicit empty binding object produces an empty object.

| Source      | Value                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `input`     | Previous node output before these bindings                                         |
| `runInput`  | Original input of the enclosing workflow invocation, skipping Batch item ancestors |
| `rootInput` | Original input of the outermost run                                                |
| `itemInput` | Original input of the current Batch item run, available only inside a Batch        |

For example, an Agent may return a proposed action while the following Script reads `dryRun` from the original workflow input:

```json
{
  "inputBindings": {
    "proposal": { "source": "input", "path": "" },
    "dryRun": { "source": "runInput", "path": "dryRun" },
    "item": { "source": "itemInput", "path": "" }
  }
}
```

The Agent's result cannot replace `runInput`, `rootInput`, or `itemInput`. Those values come from persisted run records. A referenced Workflow creates a new `runInput` scope; nested Batches retain their enclosing workflow scope. Resolved node inputs are persisted for inspection. Retries resolve bindings from the same original run inputs and the failed step's incoming value. Entry and Exit cannot use bindings.

Configure **Input bindings** in node settings, or edit the definition through Raw, CLI import, or MCP. Clearing the editor to `{}` removes the optional bindings and restores normal input flow. Scripts still have the service's OS permissions; input bindings are a data-flow contract, not script sandboxing.

## Export and import portable bundles

`interlock export WORKFLOW_ID` and MCP `export_workflow` export an `interlock-workflows` bundle with `formatVersion: 1`. The library and Workflow settings export the same bundle format. Workflow settings includes local draft edits without saving them.

A bundle contains the root workflow, its owned children, owners, and transitive dependencies from drafts and all published versions. Each record includes a stable ID, name, description, ownership, draft, source draft revision, and consecutive published versions. Missing referenced workflows block export. Runs, claim tokens, and archive flags are excluded. Exporting an owned child includes its owner and siblings to preserve ownership.

```sh
interlock export WORKFLOW_ID > workflow.json
interlock import @workflow.json
```

Import creates missing workflows with their bundle IDs and imports their exact published pins in one transaction. Reimporting an identical bundle is a no-op. Existing archive flags, runs, and published versions remain intact. Legacy single-definition import documents still create a new workflow each time. MCP `create_workflow` also retains creation semantics; use `import_workflows` for bundles.

To replace an existing draft, inspect the target with `get_workflow`, then pass `draftRevisions` keyed by target workflow ID to `import_workflows`. CLI `--revisions` accepts that JSON map. Source draft revisions in the bundle are informational; each engine has its own revision sequence.

```sh
interlock import @workflow.json --revisions '{"WORKFLOW_ID":3}'
interlock import @workflow.json --force
```

`force` allows draft and metadata replacement. It cannot change ownership or overwrite an existing published version with different content. If the two engines independently published different definitions under the same ID and version, import rejects the entire bundle. Resolve that divergence explicitly before deploying. Any invalid graph, missing published dependency, stale draft, or version conflict rolls back all bundle changes. Imported drafts can remain incomplete; imported published versions must pass publication validation.

UI import accepts bundles and legacy files. Replacements that need a revision map or `force` use CLI or MCP. The shared API exposes `workflows.export`, `workflows.exportDraft` for unsaved editor content, and `workflows.import`.

## Archive, restore, or delete

MCP `update_workflow` accepts `archived: true` or `false`. CLI provides `archive ID` and `restore ID`. Archive retains history and does not cancel active runs. New direct starts require an active workflow and owner; existing published invocations retain their pins.

`list_workflows` includes archived workflows by default. Pass `includeArchived: false` to hide archived workflows and children of archived owners. The owner filter remains independent.

MCP `delete_workflow` and `interlock delete ID --yes` permanently remove the workflow, its versions, and associated run trees, assignments, and events. Active runs, external draft or published references, and owned children block deletion. Archive is available when referenced versions must remain accessible.
