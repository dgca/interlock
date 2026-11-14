---
'@type_of/interlock': patch
---

Engine startup, run cancellation, continuity handoffs, run usage reads, comparison progress and reports, and Git trial recovery no longer load every retained run. With 10,000 retained runs, startup takes under 1 ms instead of about 560 ms, and cancelling a run takes about 2 ms instead of 445 ms.
