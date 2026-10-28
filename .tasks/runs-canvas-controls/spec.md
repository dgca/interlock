# Runs navigation behavior

See [intent](intent.md) for scope and authorization. The workflow editor supplies the reference behavior requested by the user.

AC1: In both graphs, ordinary scrolling pans. Command or Control plus scrolling zooms, pinch zooms, and middle-button or Space plus primary-button dragging pans. Double-clicking empty canvas does not zoom. Use the editor's zoom bounds and fit padding.

AC2: Holding plain Z outside text fields and dialogs arms area zoom with the same cursor and rectangle. A primary drag starting on empty canvas fits the selected area. Tiny drags do nothing. Escape, Z release, blur, and pointer cancellation cancel the gesture. Other viewport gestures are disabled while armed.

AC3: Run nodes remain stationary and cannot be connected, selected for editing, or deleted. Clicking a node still opens its execution details. Hover tracing and live progress updates preserve the viewport. Zoom buttons and fit-view remain available. Editor selection, node movement, and editing continue to work.

AC4: The run graph fits its existing container at desktop and narrow widths. No additional toolbar or instructional copy is needed. Existing loading, missing-definition, error, and completed-run states remain intact.

UI proposal: Keep the run inspector layout and controls in place. Apply the editor's viewport gestures and area-zoom feedback inside the existing graph. Area zoom never moves keyboard focus. Shortcuts ignore editable fields and open dialogs. Run graphs stay read-only, so empty primary drags do not create an editing selection. The editor retains its minimap and authoring actions.

No unresolved product questions remain. Matching navigation does not require adding editing operations to run inspection.
