---
'@type_of/interlock': patch
---

Add managed session recovery policies for Agent executions, including `continueOnMissingResult` to prompt for missing JSON envelopes within the same session, `transientRetry` with exponential backoff and rolling window pause exclusion, adapter error classification, hold escalation on exhausted transient budgets, and recovery telemetry events.
