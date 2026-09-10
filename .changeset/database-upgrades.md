---
'@type_of/interlock': patch
---

Add automatic database migrations with SQLite backups before schema upgrades. Stop startup on backup or migration failures and reject unsupported newer database schemas. Document upgrades and restoring backups. Existing child workflow records need no conversion.
