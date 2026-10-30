---
'@type_of/interlock': patch
---

Allow waited Workflow calls to route failed children or rejected successful outputs to recovery steps. Preserve child history and include child references in the failure value. Cancellation remains terminal, and handled child failures cannot be retried independently.
