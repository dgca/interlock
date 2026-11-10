# Workflow editor design reference

These desktop proposals extend the approved Grid direction in [the Pen file](../interlock-design-directions.pen). They do not change the application.

The `Interlock / Workflow editor` layer, `pJq1n`, groups these views side by side:

| Pen layer     | Frame   | Contents                                                                                     |
| ------------- | ------- | -------------------------------------------------------------------------------------------- |
| Default       | `OjVfh` | Eight nodes, eleven connections, branching outputs, and a return path, with nothing selected |
| Selected node | `hOYNx` | The same editor with the Agent selected and unrelated nodes and edges dimmed                 |
| Agent modal   | `Fkso2` | The same editor with the selected Agent's Assignment section open                            |

These views replace the earlier editor layout. They retain the approved logo and solid structural backgrounds. Graph nodes and general controls retain their gradients and offset shadows. The Workflow editor's vertical canvas control stack is flat, with compact buttons and rounded outer corners.

All three editor views use the shared two-line page-header pattern. Draft and publication status sit beneath the workflow name in 13px secondary text, with a 4px gap. The 88px header keeps 40px actions vertically centered. The former Draft badge and tab-row publication label are removed so this status appears once.

## Graph compatibility

The checkout uses `@xyflow/react` 12 through custom [FlowNode](../packages/ui/src/features/workflows/FlowNode.tsx) components. React Flow supports custom node markup and multiple named handles. Its [handle documentation](https://reactflow.dev/learn/customization/handles) describes stable handle IDs and updating node internals when handles change.

- All inputs attach on the left; all outputs attach on the right. Entry has no input and Exit has no output. Return paths can pass below nodes without moving their handles to the bottom.
- Routing nodes retain separate named outputs. The proposal shows `human`, `ready`, and `blocked`, plus `revise`, `ready`, and `stopped`. Their IDs and order remain part of the workflow definition.
- [Shared geometry](../packages/core/src/layout/canvasGeometry.ts) starts ordinary nodes at 220 × 116px. Each distinct node reference counted by `bindingNodeIds` adds 22px. Routing nodes grow when their port count needs more height. [outputPortTop](../packages/core/src/layout/portLayout.ts) supplies the rendered source positions.
- The mockup shows the graph at 90% zoom. Its 198px card widths represent 220px nodes. Rounded dimensions in Pen do not replace the shared geometry formulas.
- Titles stay on one line and truncate. Full names remain available in the node editor. The selected Agent keeps its floating edit action above the top-right edge. The native 30px button uses absolute positioning, 9px from the right and 15px above the top. It does not change the node's dimensions, padding, or handle positions.
- "Reads from" references remain input-binding actions. They are not additional execution edges.
- Existing orthogonal and return-edge renderers can draw the proposed routes. The sketch illustrates routing structure, not the exact output of either layout algorithm.

Tidy currently defaults to [Dagre](../packages/core/src/layout/workflowLayout.ts) and offers [ELK](../packages/ui/src/features/workflows/workflowLayoutElk.ts). The ELK adapter fixes ports to west and east in a deterministic order. This follows React Flow's [ELK multiple-handles example](https://reactflow.dev/examples/layout/elkjs-multiple-handles). Styling the cards does not require replacing React Flow or either layout algorithm. Changes to card bounds or port positions must also update the shared geometry and layout adapters.

The existing zoom, fit, Tidy, layout-mode menu, minimap, dragging, undo, and redo affordances remain available. The new frames do not propose changes to Batch behavior or exhaustive designs for every node type.

The vertical zoom, fit, Tidy, and layout-mode controls use a Workflow-editor-specific component. Its five 32px buttons contain 16px icons with 8px insets. The stack has an 8px outer radius, a solid neutral fill, no shadow, and full-width 1px separators. This exception changes size, flatness, and corner treatment within the existing palette. Other controls keep the shared elevated treatment.

The selected node and its immediate execution-edge neighbors share the same `#6C8AFF` outline. Only the selected node shows the edit button. All execution edges use the same `#6C8AFF` base color as the node outline. Incident edges receive a heavier stroke; unrelated nodes and edges dim to 30% opacity during selection. Dimming changes opacity, not the edge color. The neighbor selection and dimming follow Interlock's [canvasGraph](../packages/ui/src/features/workflows/canvasGraph.ts) logic and existing selection CSS. Matching every edge's base color to the node outline is part of this design target. They do not depend on an automatic React Flow neighbor-highlighting feature. Border-color changes and an outline outside the layout preserve node geometry.

## Agent modal compatibility

The modal follows [SettingsDialog](../packages/ui/src/features/workflows/SettingsDialog.tsx) and the shared [Modal](../packages/ui/src/design-system/Modal/Modal.tsx), which wraps Mantine. It preserves an 880 × 820px desktop dialog and 164px section navigation.

Assignment contains Name, Stage, Saved prompts, and Task instructions. Input, Result, and Execution retain their current editors and behavior. The prompt picker remains searchable and supports ordered prompt references; the depicted state has none selected.

The form background is solid `#212121`. Header, navigation, and footer use solid `#1A1A1A`; fields use `#121212`. Selected navigation and footer buttons keep the approved gradients. A dark scrim and an offset modal shadow separate the dialog from the canvas. Every divider reaches the edges of its panel.

The header, section navigation, and footer remain steady while long section content scrolls. Existing validation and the warning about removed branch connections remain required. Delete node retains its current draft-edit behavior. Apply changes edits the draft; saving and publishing remain workflow-level actions.

The existing Mantine wrapper retains focus trapping, Escape handling, focus return, and busy-state restrictions. [Mantine Modal documentation](https://mantine.dev/core/modal/) describes these behaviors. This design does not change the current restriction on outside-click dismissal. Responsive layouts, interaction states, and nested contract-editor screens are outside these static desktop proposals.
