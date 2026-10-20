---
'@type_of/interlock': patch
---

Configure Agent claim durations per node in workflow definitions and the editor. Explicit worker overrides take precedence, and omitted renewals retain the effective claim duration. Claims without a configured duration use five minutes.

Report expired claims with a distinct event containing the deadline, attempt count, and recovery guidance. Expiry continues to consume an attempt and reject late tokens.
