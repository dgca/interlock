# Wait for an external answer

An **External input** node pauses a running workflow until a caller submits and accepts a JSON value. Use it for an approval or answer from an issue tracker, chat, or another system. The integration verifies who sent the answer and calls Interlock.

## Add the node

Add **External input** in the editor. In **Result**, configure **Submitted value** with the schema the answer must satisfy. Connect the default route to the next step. The accepted value becomes the node output.

In a workflow definition, set `kind` to `input` and use `outputSchema` for the submitted value:

```json
{
  "id": "approval",
  "kind": "input",
  "label": "Deploy approval",
  "outputSchema": {
    "type": "object",
    "required": ["approved"],
    "properties": { "approved": { "type": "boolean" } }
  }
}
```

The submitted-value contract checks the JSON object's own fields. To constrain a field named `__proto__`, use `patternProperties` with the exact pattern `^__proto__$`.

The ordinary `inputSchema` and input bindings still describe the data arriving from the previous step. Read the current step's input through the usual targeted run result operation if the integration needs that context.

## Submit and accept an answer

Read the run briefing and find the `external_input` blocker. Use its exact `runId` and `executionId`. In the run inspector, **Copy submission target** copies both IDs for the selected visit. A new loop visit has its own execution ID.

Use the same request object with MCP `external_input` as its `request` argument, with the shared HTTP API, or with `interlock external-input`:

```sh
interlock external-input '{"action":"submit","runId":"RUN_ID","executionId":"EXECUTION_ID","requestId":"comment-123","expectedRevision":0,"value":{"approved":true}}'
```

Revision 0 means no answer has been submitted. Each valid new key replaces the pending value and increments the revision. Use a stable, nonblank key of up to 120 characters for each external event. Retrying the same key and value returns the original submission receipt, even if a later correction replaced it. Reusing the key with a different value fails. Use `expectedRevision` when the submission depends on the pending state you read.

Use `status` with both IDs to read the revision, wait start, submission time, and acceptance receipt. Add `"includeValue":true` to read the current pending JSON. The shared API exposes this as `runs.externalInputStatus` and writes as `runs.externalInput`.

When the answer is ready, accept the exact revision:

```sh
interlock external-input '{"action":"accept","runId":"RUN_ID","executionId":"EXECUTION_ID","expectedRevision":1}'
```

A correction that changes the revision causes stale acceptance to fail. After a lost response, read the receipt with `status` or repeat acceptance of the same revision. The accepted revision advances the run once. Acknowledge the answer in the external system after verifying the receipt. The receipt covers the Interlock transaction. Your integration reconciles any separate external write.

## Hold acceptance

Use `status` with a run ID alone to read that run's hold revision. Use `hold` and `release` with the run ID and `expectedRevision` for the hold:

```sh
interlock external-input '{"action":"hold","runId":"RUN_ID","expectedRevision":0}'
interlock external-input '{"action":"release","runId":"RUN_ID","expectedRevision":1}'
```

A hold covers external-input acceptance in the selected run, attached child workflows, and Batch items. A detached child has its own hold scope. Each applicable hold must be released before acceptance. Submissions and corrections can arrive while held. Release makes the latest revision eligible for an explicit acceptance.

## Recover or inspect a wait

Pending answers, holds, and receipts survive a server restart. Cancellation closes the wait. Identical submission retries recover retained receipts after cancellation. Run history cleanup deletes the retained input records with the run. Workflow exports contain the node definition.

Briefings show the waiting execution, wait start, pending revision, and any effective hold. Submitted values are available through the targeted status read. The step creates no Agent assignment and has no lease or attempt budget.
