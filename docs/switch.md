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

The default edge uses `"port": "none"` in this example. Omitting an edge's `port` still means `"default"`; it does not select the Switch's configured default name automatically.

`path` uses dot-separated object keys or array indices. A blank path selects the entire input. The first matching case wins, including when several cases contain equal values. An unmatched value follows `default`. A missing path fails the step instead of following the default route. An empty case list always selects default after resolving the path.

Switch passes its complete resolved input through unchanged. Its input and output contracts apply as usual. Optional `inputBindings` can select earlier node outputs or original inputs before comparison. For example, a binding named `selected` with `{"source":"node","nodeId":"manager","path":"next.workflow"}` makes the selected value available at Switch path `selected`. The referenced node must have a completed output in the same execution scope.

## Publication and execution

Case and default port names must be nonblank and unique within the node. Every case and the default require exactly one outgoing edge. The default route is required even when the input contract restricts values to the listed cases. Additional routes are rejected.

Port names belong to their source node. A Switch case named `item` or `timeout` behaves like any other Switch case. It does not start a Batch item or skip output validation.

Switch runs automatically without an agent assignment. The execution records the selected port, input, and output. Workflow-level loops consume `maxSteps` on each visit. Inside a Batch, every branch must stay within its item scope and reach End; item paths cannot contain cycles.

## Editor

Select **Switch** in **Add node**. **Check this input field** selects a field from the JSON data the node receives. For `{"route":"ticket"}`, enter `route`. Use dots for nested fields or leave the field blank to compare the whole input.

Each case has a value type, a match value, and a **Branch name**. Enter text without JSON quotes. Choose Number, Boolean, or Null for those value types, or JSON for lists, objects, and direct JSON editing. Existing values keep their types when opened. New cases start with an empty text value.

**Default branch** names the route used when no case matches. Connect each branch on the canvas, including default. The canvas marks the default handle and expands for additional cases. Branch names are stored as `port` values in the definition.

Renaming or removing a branch in settings removes its connection when you select **Apply changes**. The editor lists affected connected branches before you apply. Connect renamed branches again before publication. Cancel discards the settings changes. Raw edits retain edges exactly as entered, so update those edges when changing port names.

Incomplete graphs and duplicate or blank port names can be saved as drafts. Publication reports the invalid names or missing routes. Regex and range matching are not supported.
