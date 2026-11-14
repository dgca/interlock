---
'@type_of/interlock': patch
---

The Report page and a new **Report** tab on each workflow compare the selected period with the previous one: runs, success rate, median duration and spend, with per-interval bars and a table. They break reported spend down by node, model and stage, show stage and node duration changes, list runs waiting on a person, held, stalled or queued with how long, and show recent runs linking to the inspector. The workflow actions menu no longer has a report entry; `/workflows/:id/report` opens the tab.
