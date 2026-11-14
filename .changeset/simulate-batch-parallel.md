---
'@type_of/interlock': patch
---

Fixture simulation now runs workflows with Batch and Parallel nodes and detached Workflow calls instead of rejecting them. Batch items and Parallel branches run one at a time in input and branch order, so their fixtures stay in the one ordered list, and the Batch failure policy applies to item failures. A detached call takes a `workflow` fixture with the started run reference. Traces mark item and branch steps, and route coverage reports each Parallel branch and the Batch item and complete routes.
