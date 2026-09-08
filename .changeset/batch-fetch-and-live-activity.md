---
'@type_of/interlock': patch
---

Replace Map with Batch, keeping repeated steps visible together on the workflow canvas. Batch supports concurrent item execution, ordered results, failure policies, and retries that preserve successful items. **Breaking change:** Map definitions are no longer supported. Recreate repeated steps with Batch; use a Workflow child to repeat an existing workflow.

- Add Fetch nodes for HTTP requests, with input bindings, JSON bodies, request previews, and response inspection.
- Add Activity with Active and History tabs. Show live step states, distinguish waiting Agent assignments from claimed work, and inspect individual Batch items without losing the selected step or canvas position.
- Add copyable agent handoff instructions for existing executions, including fresh-session or isolated-subagent guidance and a fallback prompt for the user.
- Show concise input and output types on node cards and shared workflow contracts on Entry and Exit.
- Add confirmed permanent workflow deletion, including versions and run history. Active executions and references from other workflows block deletion.
