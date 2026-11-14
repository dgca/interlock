---
'@type_of/interlock': patch
---

Run steps are now stored as their own database rows instead of inside each run record, so writing a step no longer rewrites the run's whole history. **This upgrade is one-way: back up `~/.interlock/interlock.db` (with the server stopped) before installing.** Interlock still writes its automatic pre-upgrade copy to `interlock.db.backups/`, and an earlier version cannot open the upgraded database; restore the backup to downgrade. API, CLI and MCP responses are unchanged.
