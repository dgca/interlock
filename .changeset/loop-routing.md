---
'@type_of/interlock': patch
---

Route loops around the graph. An edge whose target sits entirely left of its source leaves the source, drops to a lane just below the nodes it crosses, runs left, and rises into the target, one lane per loop with staggered verticals and rounded corners, so loops never pass behind cards. Forward edges keep their curves. Applies in the editor and run inspection.
