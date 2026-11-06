# Fold a Condition or Switch into the producing node

## Check whether the fold preserves behavior

- Start with a producer whose only successful edge feeds the standalone branch. Keep the branch if another incoming edge uses it or if the producer already has result routes that would change. Check for references to the branch ID in bindings, test assertions, scripts, and external consumers.
- Compare what each route reads. The branch reads its resolved input, which may come from the producer's forwarded output or from the branch's own input bindings. Inline routing reads the validated raw result before `outputBindings`. Keep the branch unless the same value and missing-path behavior can be established on the raw result. For example, a Script that returns `{"ready":true}` but forwards `{"ready":false}` selects opposite routes if the comparison path is copied verbatim.
- Preserve any input and output contracts on the removed branch. If the branch transforms the forwarded value through input bindings, account for the exact transformed data that downstream nodes receive. Keep the branch when the transformation, validation, or order of failures matters and cannot be reproduced.
- Preserve typed equality, first-match case order, and the exact fallback. A Condition maps to one case on port `true` plus a fallback named `false`. A Switch uses its existing cases and optional fallback. A missing path fails lookup even with a fallback. For an Agent, routing failures can reject a submission under its active claim. A standalone Branch fails only after the Agent result is accepted. Keep the branch if either failure is reachable and the distinction matters.
- Preserve enabled `failed` and `timeout` edges and reserve their names. If a success port would collide, retain the branch unless the user accepts a rename and its impact on consumers. Check Batch scope and preserve edge target handles, including `end`. Account for the removed execution in logs, assertions, and step limits. A loop can make more visits before hitting `maxSteps` after a fold.

## Apply the fold

Set `routing` on the producer. Re-source the branch's outgoing edges to that node, keeping their IDs, ports, targets, and target handles. Repoint downstream bindings to the producer only if they still select the same completed output on every path. Update route assertions to use the new node ID and the correct visit. Move the edges before removing the branch because removing a node removes its incident edges.

### Worked example

The Script node `check` returns `input` and requires a Boolean `ready` in its result contract. Its default edge leads to `route-ready`, a Condition with `path: "ready"` and `equals: true`. The Condition has no extra bindings or contracts. The edges `route-true` and `route-false` lead to Exit on ports `true` and `false`. This `edit_workflow` request folds the Condition into the Script. Substitute the real workflow ID and draft revision.

```json
{
  "id": "WORKFLOW_ID",
  "draftRevision": 1,
  "edits": [
    {
      "op": "update_node",
      "id": "check",
      "set": {
        "routing": {
          "path": "ready",
          "cases": [{ "port": "true", "equals": true }],
          "default": "false"
        }
      }
    },
    { "op": "update_edge", "id": "route-true", "set": { "source": "check" } },
    { "op": "update_edge", "id": "route-false", "set": { "source": "check" } },
    { "op": "remove_node", "id": "route-ready" }
  ]
}
```

Use the same Script fixture on both versions for each case. For the baseline route assertion, set `nodeId: "route-ready"` and `visit: 1`. For the candidate, set `nodeId: "check"` and keep the same visit.

| Script result              | Expected port | Expected run result       |
| -------------------------- | ------------- | ------------------------- |
| `{"ready":true,"id":7}`    | `true`        | `{"ready":true,"id":7}`   |
| `{"ready":false,"id":8}`   | `false`       | `{"ready":false,"id":8}`  |
| `{"id":9}`                 | None          | Script output check fails |
| `{"ready":"true","id":10}` | None          | Script output check fails |

For a Switch migration, add an unmatched case and a missing-path case when the producer contract permits them. Check that fallback, terminal failure, or Agent rejection happens at the intended point. Exercise any existing Failed or Timeout edges separately. [Result routing](https://github.com/dgca/interlock/blob/main/docs/node-data.md#branch-on-a-result) · [Switch matching](https://github.com/dgca/interlock/blob/main/docs/switch.md) · [Agent result preflight](https://github.com/dgca/interlock/blob/main/docs/result-preflight.md)
