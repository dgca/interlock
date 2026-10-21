# Inspect assignment size

Use `inspect_assignment_size` through MCP, `work.size` through the shared API, or `interlock assignment-size` to see which parts of an Agent assignment consume context. The operation is read-only. It never claims work, processes timers, truncates delivery, or changes budgets.

Inspect a captured assignment before claiming it:

```sh
interlock assignment-size '{"workId":"WORK_ID","warningBytes":100000}'
```

Preview an Agent in a draft, or add `version` to select a published definition:

```sh
interlock assignment-size '{"workflowId":"WORKFLOW_ID","nodeId":"agent","version":1,"sample":{"input":{"task":"Example"}}}'
```

Use `@request.json` for larger requests. Sample-bearing API queries use POST and share the server's 2 MiB body limit.

## What the report measures

Each component reports its state and UTF-8 byte count for its compact JSON value. The components are the composed prompt, context policy, resolved input, output schema, execution instructions, and saved prompt metadata. Saved prompt metadata counts separately because full assignments deliver it as well as the composed prompt.

`totalBytes` sums those component values. It excludes the transport envelope, surrounding field names, assignment identity, claim credentials, and lease metadata. It is neither a full network-response measurement nor a token or billing estimate. Absent optional components count as zero. Unknown components have `bytes: null`; any unknown component makes `totalBytes: null`. `knownBytes` sums the components that can be measured.

`warningBytes` defaults to 100,000 and accepts integers from 1 through 100,000,000. `large_assignment` means the known bytes reach that threshold, even if some components remain unknown. Warnings are advisory and only appear in the requested report. Normal claims and work summaries are unchanged.

The report includes at most ten largest immediate fields across components, with JSON Pointer paths capped at 256 characters and a truncation flag. Field sizes exclude property names and are not added again to the total. Repetition diagnostics count duplicate string values of at least 64 UTF-16 code units across the selected components. They report aggregate duplicate bytes without returning the strings. They do not find repeated passages inside one string. Diagnostic traversal stops after 10,000 values; `diagnosticsTruncated` also indicates omitted field entries. Component byte counts remain complete even when diagnostics are truncated.

## Supply preview inputs explicitly

Without bindings, `sample.input` is the Agent input. With bindings, provide the sources the node actually references:

- `input`: the incoming value.
- `runInput`, `rootInput`, and `itemInput`: the corresponding scope inputs.
- `outputs`: a map of node IDs to their latest completed output in the same execution scope. For repeated visits, supply the output for the visit being previewed.

Missing sources or paths stay unknown; an empty object is never substituted. Item input requires a Batch-scoped Agent. Node-output fixtures cannot cross Batch scopes or refer to Entry or Exit. The report includes up to twenty unresolved fields, their total count, and a truncation flag. `inputValidation` is `valid`, `invalid`, or `unknown` for previews, and `captured` for existing assignments. `invalid_sample_input` warns about a resolved sample that does not satisfy the Agent input contract.

Previews use the selected definition and current saved prompt contents, matching capture-at-start behavior. Missing saved prompts remain unknown. Fresh-session execution instructions include future run and work IDs, so their size remains unknown until an actual assignment exists. A preview does not execute upstream nodes, prove that a route is reachable, or guarantee publication. Inspect a captured assignment for exact component sizes, including saved prompts and fresh-session instructions. Later prompt or draft edits do not change captured assignments.
