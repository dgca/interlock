---
'@type_of/interlock': patch
---

Seed the example workflows only once per database. Previously the examples were re-seeded on every start whenever the library was empty, so permanently deleting them brought them back on the next start.
