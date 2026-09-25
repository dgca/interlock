# Switch routing

A Switch chooses one named route by comparing a path in its input against ordered JSON values. It uses the same structural equality as Condition. Strings, numbers, booleans, null, arrays, and objects are supported without type coercion. Object key order does not affect equality; array order does.

## Definition

This node routes an agent's choice of specialist:

```json
{
  "id": "route",
  "kind": "switch",
  "label": "Which specialist?",
  "path": "next.workflow",
  "cases": [
    { "port": "investigate", "equals": "investigate" },
    { "port": "ticket", "equals": "ticket" },
    { "port": "assets", "equals": "assets-intake" }
  ],
  "default": "none"
}
```

An edge selects a case by its port name:

```json
{
  "id": "route-ticket",
  "source": "route",
  "port": "ticket",
  "target": "ticket-workflow"
}
```

The fallback edge uses `"port": "none"` in this example. Omitting an edge's `port` still means `"default"`; it does not select the Switch's configured default name automatically.

`path` uses dot-separated object keys or array indices. A blank path selects the entire input. The first matching case wins, including when several cases contain equal values. An unmatched value follows `default` when configured. Omit `default` to fail the run with an error identifying the unmatched value and input field, without requiring a fallback edge. Existing definitions with `default` retain their routing behavior. A missing path always fails the step, even with a fallback. An empty case list takes the unmatched action after resolving the path.

Switch passes its complete resolved input through unchanged. Its input and output contracts apply as usual. Optional `inputBindings` can select earlier node outputs or original inputs before comparison. For example, a binding named `selected` with `{"source":"node","nodeId":"manager","path":"next.workflow"}` makes the selected value available at Switch path `selected`. The referenced node must have a completed output in the same execution scope.

## Publication and execution

Case and configured fallback port names must be nonblank and unique within the node. Every case and any configured fallback require exactly one outgoing edge. Without `default`, no fallback edge is allowed. Additional routes are rejected.

Port names belong to their source node. A Switch case named `item` or `timeout` behaves like any other Switch case. It does not start a Batch item or skip output validation.

Switch runs automatically without an agent assignment. A routed execution records the selected port, input, and output. With no match and no fallback, the execution and run fail without a selected port or successful output. Workflow-level loops consume `maxSteps` on each visit. Inside a Batch, every branch must stay within its item scope and reach End; item paths cannot contain cycles.

## Editor

Select **Switch** in **Add node**. **Check this input field** selects a field from the JSON data the node receives. For `{"route":"ticket"}`, enter `route`. Use dots for nested fields or leave the field blank to compare the whole input.

Each case has a value type, a match value, and a **Branch name**. Enter text without JSON quotes. Choose Number, Boolean, or Null for those value types, or JSON for lists, objects, and direct JSON editing. Existing values keep their types when opened. New cases start with an empty text value.

**When no case matches** defaults to **Fail the run** for new nodes. Choose **Follow a fallback branch** to reveal **Fallback branch name**, then connect that branch on the canvas. Existing Switch nodes with a fallback keep that setting. Connect each case branch too. The canvas marks the fallback handle and expands for additional cases. Branch names are stored as `port` values; the optional fallback name is stored in `default`.

Renaming or removing a branch, or disabling fallback, in settings removes its connection when you select **Apply changes**. The editor lists affected connected branches before you apply. Connect renamed branches again before publication. Cancel discards the settings changes. Raw edits retain edges exactly as entered, so update those edges when changing port names.

Incomplete graphs and duplicate or blank port names can be saved as drafts. Publication reports the invalid names or missing routes. Regex and range matching are not supported.
