---
'@type_of/interlock': patch
---

Allow each Batch to configure Maximum items from 1 through 10,000, retaining 200 when unset. Larger backlogs can run with the existing concurrency and independent step budgets. Oversized-input errors report the actual count and configured limit before any item work starts.
