---
'@type_of/interlock': patch
---

Add opt-in prompt pinning at publish (`pinPromptsAtPublish: boolean`) to pin exact prompt revisions in immutable workflow versions and capture them at run startup. Enhance CLI bundle import with `--dry-run` semantic diffs (ignoring diagram layout and object key ordering) and transactional `--publish --cascade` flags for atomic Git-driven workflow bundle synchronization.
