---
'@type_of/interlock': patch
---

Record background scheduler failures, such as a failing launcher status command, instead of discarding them. The engine writes leveled JSON lines to a rotating `logs/interlock.log` beside its database, `INTERLOCK_LOG_LEVEL` selects the minimum level, and `interlock doctor` reports the last scheduler error with its time.
