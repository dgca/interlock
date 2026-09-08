---
'@type_of/interlock': minor
---

Rename the List node to Batch, with unchanged grouped item paths and execution behavior. Stored definitions use `kind: "batch"` and `batchId`; item runs use `batchNodeId`. Older List definitions must be updated before use. List remains the label for array data.
