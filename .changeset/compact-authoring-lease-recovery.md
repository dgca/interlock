---
'@type_of/interlock': patch
---

Add opt-in compact workflow authoring responses and edit diagnostics that retain errors and new warnings while summarizing unchanged warnings. Expose authoring and claim output schemas over HTTP and stdio. Add CLI start/submit `--summary` and claim `--fresh`/`--lease` options.

Add an optional per-Agent lease-expiry budget, separate from reported failures, with persisted counters and recovery guidance for expired claims. Configure it in Agent settings or definitions. Existing response defaults and combined attempt budgets remain unchanged; expired tokens still require reclaiming available work before submission.
