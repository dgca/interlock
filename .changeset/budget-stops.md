---
'@type_of/interlock': patch
---

Run budgets now stop managed Claude Code, Codex and Pi sessions within one model turn of a token or cost limit, using usage streamed during the attempt. The stop is a recoverable block: the run waits with the reached limit as its budget reason, and raising the budget resumes the same session without losing completed work or spending a failure. Budget cost checks now include costs derived from the run's price table when an executor reports tokens without cost, and name models with no price. Invoked child workflows now use their caller's price table, so one table prices a whole run tree.
