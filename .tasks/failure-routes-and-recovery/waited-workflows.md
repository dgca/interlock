# Waited Workflow failure routes

Implement issue #75 directly, as requested in chat. No SDLC run was started.

- Add optional `onFailure:fail|route` to Workflow calls. Omission retains existing terminal behavior. Only waited calls can route; detached route flags block publication while incomplete drafts remain saveable.
- Reuse default/failed ports, editor controls, path vocabulary, validation, inspection and existing transport operations. No new MCP tool or automatic retries/backoff.
- A failed dispatched child routes with category `child`; successful child output rejected by the caller contract routes with category `output`. The value is `{input,error,output}` with `error.kind:workflow` and `error.child:{runId,workflowId,version,executionId}`. Input is the caller's resolved original input, output is the rejected successful output or null, and executionId is the child's last execution or null.
- Caller input/binding errors, target workflow input errors, invalid dispatch configuration, caller step-limit errors and persistence failures remain terminal. A validly dispatched child is a distinct operation; its retained failed outcome is routable regardless of internal cause. No parsing error text to decide eligibility.
- Parent cancellation and independently cancelled children never follow Failed. Detached failures cannot route a completed launch. Existing Script/Fetch failure envelopes remain unchanged.
- Keep child and caller history, including caller status failed and port failed. Do not clone child history into the value. Capture uses the parent's immutable pin. Prevent independent retries of a child whose Workflow caller already handled its failure, even while the parent is active. Retrying a later recovery failure must not replay the child.
- Recovery destinations apply their own input contracts. Failed routes inside a Batch stay in scope and can reach End; recovered items count as successful under all/collect. Loops outside Batches retain maxSteps bounds.
- Use savepoints and copied caller records for route-enabled child allocation and failure routing. A persistence exception must not leave an orphan, routed port, or recovery value committed.
- Verify cancellation ordering, restart, nested calls, Batch policies, output mismatch, invalid input/configuration, explicit retries, immutable pins, contracts/editor mode changes, and HTTP/stdio execution. Use temporary databases and fake executors, build/format checks, and a pending patch changeset.
