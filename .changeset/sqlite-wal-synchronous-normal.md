---
'@type_of/interlock': patch
---

Speed up SQLite commits for local workflows by syncing the write-ahead log less often. Committed changes survive an Interlock process crash, but a system crash or power loss may roll back recent commits.
