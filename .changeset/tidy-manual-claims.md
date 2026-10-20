---
'@type_of/interlock': patch
---

Keep manual claim tokens in page memory instead of session storage, and remove legacy stored claims. Preserve claims across navigation, clear expired credentials, and explain recovery when reloading loses an active claim.
