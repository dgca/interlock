---
'@type_of/interlock': patch
---

Add opt-in workflow sync with a repository folder. Start Interlock with `INTERLOCK_SYNC_DIR` set to a folder: publishing writes each workflow there as a portable bundle with stable formatting, and a changed file updates the draft through the normal import checks without publishing. Invalid or conflicting files change nothing and show under Runs → Needs attention until fixed.
