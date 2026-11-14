---
'@type_of/interlock': patch
---

Parallel groups can continue after any branch or a chosen number of branches succeed, and can keep going past failed branches while enough can still succeed. Branches still running when the join is satisfied are cancelled with a reason naming the group, and the group output reports each branch as completed, failed or cancelled. Groups without these settings behave as before.
