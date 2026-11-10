---
'@type_of/interlock': patch
---

Keep custom harness token values out of shell command source, handle early subprocess exits without crashing the engine, and stop subprocess descendants before retrying timed-out turns. Preserve interrupted ownership when cleanup cannot be confirmed.
