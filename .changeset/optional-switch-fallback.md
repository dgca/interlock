---
'@type_of/interlock': patch
---

Let Switch nodes fail on unmatched values without requiring a fallback branch. New nodes default to failing with an error that identifies the unmatched value and input field. Settings offer an optional fallback branch and preserve existing fallback behavior, with a connection-removal warning before disabling it.
