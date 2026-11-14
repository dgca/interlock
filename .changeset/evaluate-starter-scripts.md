---
'@type_of/interlock': patch
---

The **Evaluate workflow comparison** starter now selects samples and records grades with Scripts instead of agents, so a review-mode evaluation of N samples needs N agent assignments instead of 2N + 1, and `checks_only` needs none. The Scripts call two new HTTP routes, `GET /api/comparisons/{id}/evaluation-plan` and `POST /api/comparisons/{id}/judgments`; the server selects samples and records a grader step's accepted output with the same request key and provenance checks as MCP `record_quality`, which is unchanged. The review prompt is rewritten as a numbered list with the same rules. Copies imported earlier keep working unchanged and are not replaced; choose **Add another copy** to get the new version. The improvement starter's embedded evaluator is updated to match.
