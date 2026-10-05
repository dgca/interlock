---
'@type_of/interlock': patch
---

Forward edges on the workflow canvas now route orthogonally through the gaps between columns instead of cutting diagonally across the cards in between. Each edge leaves its source to the right, runs vertically inside the gap that crosses the fewest cards, and enters its target horizontally; edges sharing a gap take separate channels, and an edge that would cross a card on either side dips below the rows in its way. Routing is computed at render from node positions, so it applies in the editor and run inspection and follows Tidy or manual drags without changing the definition.
