---
'@type_of/interlock': patch
---

Make editor edges easier to follow. Selecting an edge brings it in front of the nodes, thickens it, outlines its source and target, and dims the rest of the graph. Backward edges, whose target sits to the left of their source, route through their own lane below the graph instead of passing behind nodes, in both the editor and run inspection.
