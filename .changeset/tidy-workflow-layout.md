---
'@type_of/interlock': patch
---

Fix overlapping new nodes by using their rendered dimensions for placement and making room when Batch contents grow. Add an undoable Tidy action that arranges the workflow and nested Batch contents from left to right, then fits the result into view. Place Tidy below Fit View in the canvas controls.
