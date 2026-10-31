# Step data and result branches

Agent, Script, Fetch and waited Workflow steps can choose their next branch from a result and build the data they send onward. These settings are optional. They run in this order:

1. Build the step input, then perform the work.
2. Validate the operation result against `outputSchema` and any Agent `resultRules`.
3. Choose the result branch.
4. Build the forwarded output, then pass it to the selected destination.

The destination validates its own input. Operation failure and unclaimed-timeout routes keep their existing behavior and bypass result routing and output mapping.

## Build step input

In **Input**, choose **Choose fields** to construct an object. Each field can select data from the previous output, the original workflow/root/Batch input, an earlier node, or a fixed value. Use dots in a new target field name to build nested objects. **Show value types** exposes text, number, Boolean, null and JSON editors for fixed values and defaults.

`inputBindings` replaces the complete input. Omitting it passes the previous output through; `{}` constructs an empty object. Binding sources are:

| Source      | Value                                                           |
| ----------- | --------------------------------------------------------------- |
| `input`     | The incoming output before input bindings                       |
| `runInput`  | Original input of the enclosing workflow run                    |
| `rootInput` | Original input of the outermost run                             |
| `itemInput` | Original item in the current Batch item run                     |
| `node`      | Latest completed output of `nodeId` in this run and Batch scope |
| `literal`   | The JSON `value` supplied in the binding                        |
| `object`    | An object constructed from recursive `fields`                   |

Path sources use dot-separated `path` keys or array indices. Blank, `$`, and `$.field` have the same meaning as existing data paths. A path binding may include `default`. The default applies only when the selected field is missing; null, false, zero and empty text remain their existing values. Missing source history, unavailable Batch scope and invalid paths still fail. Earlier-node sources cannot select Entry/Exit or cross runs or Batch groups.

For example, these fields select a request, preserve repository configuration, and supply a fixed policy:

```json
{
  "inputBindings": {
    "request": { "source": "input", "path": "request" },
    "project": {
      "source": "object",
      "fields": {
        "repoPath": { "source": "runInput", "path": "repoPath" }
      }
    },
    "policy": { "source": "literal", "value": "standard" },
    "retry": { "source": "input", "path": "retry", "default": false }
  }
}
```

Record keys remain literal, including dots. Existing flat names such as `"project.repoPath"` keep that meaning when opened and saved; the editor identifies them as literal names. Rename a target deliberately or use `source:"object"` to construct nesting. Object construction supports at most ten nested levels. Fixed values may include arrays and objects. Use a Script for computed transformations.

## Branch on a result

In **Result**, enable **Branch on result**, select the field to compare, and name each branch. Connect those named ports on the canvas. Turning routing off, or removing or renaming ports, shows which existing connections will be removed when changes are applied.

```json
{
  "routing": {
    "path": "ready",
    "cases": [{ "port": "ready", "equals": true }],
    "default": "blocked"
  }
}
```

Matching uses ordered structural JSON equality, as in a standalone Branch. The first match wins; text `"1"` and number `1` differ. Omitting `default` fails unmatched results. A missing path fails even when a fallback exists. **Try branch matching** tests this selection without executing or saving work; result contracts and checks still apply during execution.

Branch names must be nonblank and unique, including the fallback and any enabled `failed` or `timeout` ports. Publication requires exactly one outgoing connection for each configured port. Drafts can retain incomplete connections.

`routing` is supported on Agent, Script, Fetch and Workflow steps that wait for a result. A standalone **Branch** routes its input. New standalone Branches use the existing `switch` definition; legacy `condition` and `switch` definitions remain supported. A normal edit to an existing Condition's path or value preserves its kind and True/False ports. Adding cases or changing those port names explicitly converts that edited draft to a Switch.

## Build forwarded output

In **Result → Send data onward**, keep **Node result** to forward the accepted result unchanged, or choose fields to construct a replacement object. `outputBindings` uses the same binding format. Here, `source:"input"` means the raw operation result, before output mapping.

```json
{
  "outputBindings": {
    "summary": { "source": "input", "path": "summary", "default": "" },
    "project": {
      "source": "object",
      "fields": {
        "repoPath": { "source": "runInput", "path": "repoPath" }
      }
    },
    "policy": { "source": "literal", "value": "standard" }
  }
}
```

Original inputs remain independent of agent responses. Output fields can preserve configuration or earlier data without placing that data in an Agent assignment. `outputSchema` and `resultRules` describe the raw result; routing also reads that raw result. The forwarded object is validated by the destination's input contract.

Output fields have the same supported step kinds as result routing. Switching a Workflow to **Start and continue** removes both settings, because it returns a run reference immediately. Switching back before applying restores the pending waited-result settings.

## Inspect results

Executions keep the forwarded data in `output`. When output fields are configured, they also retain the raw result in `result`. Run inspection shows **Accepted result** and **Forwarded output** separately. A result-processing failure retains its validated operation result for diagnosis and stays terminal rather than taking an operation-failure route.

Use `get_run_result` for bounded reads:

```json
{
  "id": "run-id",
  "executionId": "execution-id",
  "field": "result",
  "path": "",
  "maxBytes": 65536
}
```

`field:"result"` requires an execution ID. It reads the retained raw result, falling back to the existing output when no separate result is stored. `field:"output"` and the default response keep their previous meaning. Summaries and briefings omit raw payloads. `includeHash:true` hashes the selected value, including a selected raw result.

Agent preflight checks result routing and output fields before accepting a submission. A rejected candidate leaves a valid claim usable. Inspect mapping diagnostics when `nextAction` is `inspect_work`; a missing original source or earlier execution can require correcting the workflow rather than changing the response. See [Result preflight](result-preflight.md).
