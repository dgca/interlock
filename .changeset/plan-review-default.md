---
'@type_of/interlock': patch
---

The SDLC starter's **Plan review** no longer sets Read only; like every other starter workflow it follows the default agent permissions. It now ships with the same read-only permission policy as **Change review**, so under Standard it reads and runs read-only Git and search commands without asking, and still asks before any edit. Copies you already imported are unchanged.
