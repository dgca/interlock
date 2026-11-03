---
'@type_of/interlock': patch
---

Reduce idle CPU use as run history grows by indexing scheduler and continuation queries, scoping budget and comparison maintenance, and avoiding repeated saves and notifications for unchanged waiting steps. Existing databases automatically receive a backed-up index migration on startup; stored history is preserved.
