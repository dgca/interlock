---
'@type_of/interlock': patch
---

A run blocked by its budget, whether stopped mid-attempt or refused at a claim, now appears in Runs → Needs attention and in `workflow_requests` until the budget allows the claim or the run is cancelled. The budget reason shows costs to four decimal places and names the governing run by title, and the executor inspect view shows a budget-stopped attempt as held. `unknownUsage` is now optional when setting a budget and defaults to `allow`. A disabled pull launcher profile refuses polls, completions and failures and ends waiting polls, and a poll without a credential header returns 401 `launcher_credential_missing`. Runs waiting for approval of a permission policy or workspace hook now say so in their waiting message and in the requests list.
