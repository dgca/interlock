---
'@type_of/interlock': patch
---

Fixture simulation now runs workflows with Batch and Parallel nodes and detached Workflow calls instead of rejecting them. Batch items and Parallel branches run one at a time in input and branch order. A step inside an item or branch, including inside a called workflow, takes the next unused fixture for its node, so a case may list those fixtures item by item or step by step. The Batch failure policy applies to item failures. A detached call takes a `workflow` fixture with the started run reference when the case has one for that node; otherwise its child runs inside the simulation as before. Traces mark item and branch steps, and route coverage reports each Parallel branch and the Batch item and complete routes.
