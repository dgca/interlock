---
'@type_of/interlock': patch
---

Add `INTERLOCK_DATA_DIR` to keep the engine's database, keys, API token, background Script spool, and managed worktrees in one directory. `interlock doctor` reports the effective paths and their sources.

Startup cleanup no longer removes managed worktrees that the open database has no record of, so two databases that share a folder leave each other's worktrees alone. After you delete or replace a database, remove its old worktrees yourself.
