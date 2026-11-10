---
'@type_of/interlock': patch
---

Keep Raw workflow edits local until Save so Discard also discards coordinate changes. Position-only saves retain independent layout history without changing the draft revision. Fix draft replacement losing a node move back to its original coordinates after a separately saved layout change.
