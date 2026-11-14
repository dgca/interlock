---
'@type_of/interlock': patch
---

Add a new **SDLC workflow** starter, which replaces the original in the starter picker. It adds three workflows: SDLC, which plans, builds and reviews a change in a small or a standard lane, and the **Plan review** and **Change review** workflows it owns and calls. Interlock runs the plan's check commands before each review, retrying a failure once; one fresh reviewer checks every round, and findings return to the build or to planning. A person approves plans, answers the build's questions and decides at every loop limit through Human input. With its Git worktree setting turned on, conservative permission policies let managed sessions read, search and commit without asking, and the prompts steer agents to plain commands those policies can allow. Existing SDLC copies are unchanged.

Fixture simulation now supports Human input nodes: a `kind: "input"` fixture supplies the person's answer.
