---
'@type_of/interlock': patch
---

Add opt-in `transientRetry` to foreground Script nodes. A Script can retry an observed non-zero exit after exit code 75 or a `retryable`/`transient` JSON marker, after recognized transient error text, or once as an unclassified probe that stops when an identical failure repeats. Each retry stays in one execution, keeps `INTERLOCK_EXECUTION_ID`, and increments `INTERLOCK_ATTEMPT`. Backoff releases declared resources, survives a restart between attempts, and pauses with its run. Engine timeouts, signals, cancellation, spawn errors, output limits, invalid JSON, and output-contract failures are never retried. Background Scripts reject the setting.
