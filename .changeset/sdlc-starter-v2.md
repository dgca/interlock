---
'@type_of/interlock': patch
---

Add the **SDLC workflow v2** starter beside the original SDLC starter. It adds three workflows: SDLC, which plans, builds and reviews a change in a small or a standard lane, and the **Plan review** and **Change review** workflows it owns and calls. Interlock runs the plan's check commands before each review, retrying a failure once; one fresh reviewer checks every round, and findings return to the build or to planning. Existing SDLC copies are unchanged.

Fixture simulation now supports Human input nodes: a `kind: "input"` fixture supplies the person's answer.
