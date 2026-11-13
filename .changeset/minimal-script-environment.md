---
'@type_of/interlock': patch
---

Add a minimal server environment mode for Script nodes, polling Script checks and custom executor subprocesses. Minimal mode passes only `PATH`, `HOME`, locale and `INTERLOCK_*` variables, bound variables and declared passthrough names, and failures name a withheld variable with its fix. Existing workflows and profiles keep inheriting the full environment; Scripts added in the editor start in minimal mode.
