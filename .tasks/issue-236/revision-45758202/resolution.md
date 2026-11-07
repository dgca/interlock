# Revision of review 45758202

The retained prior review is `prior-review.json`; the independent UI report and result are retained alongside it. Stable finding IDs are unchanged. Product fixes are commit `f0090455a71df6bb7e23e3e3418bb28baeb77944`; `c6ae26b` changes regression-test formatting only. Original baseline remains `dcba6b6ff490d6a8d709a39233e56fddced3d944`; fetched/rebased main is `7b29dcae81403be62833d2caa2075c625abc894d`.

| Finding | Change | Verification |
| --- | --- | --- |
| 45758202-R1 | Keep the originating fire's admission timestamp and lag. Follow continue-as-new successors only to resolve current/terminal status. A successor that is still queued cannot erase the root's admission. | Two deterministic runtime regressions first failed against the reviewed code, then passed for admitted and genuinely capacity-queued successors. A higher-priority manual run occupies the only admission slot in the queued case. Original zero lag remains zero after a 90-second continuation. |
| 45758202-R2 | Rewrite existing attention, import and bundle format contracts in README, agent workflows, ui-patterns, version cleanup and schedules. Update affected MCP import guidance. Identical workflow content stays unchanged; included schedules disable, advance revision, re-anchor/recalculate, reset pause/failures/last lag and retain local history. | Read against current importer and UI APIs. Full transport tests cover HTTP and stdio discovery and operations. Documentation explicitly distinguishes independent schedule alerts from run attention and records formats 1–5. |
| 45758202-R3 | Selected-set imports preserve format 5. Repeated workflow identities merge unique schedule IDs, accept matching schedule config and reject differing config before any import. | Regression first reproduced the format-5 error. Single selected schedule bundle, two overlapping bundles, exact schedule duplicate, conflicting duplicate/atomic rollback and actual GitHubImporter fixture transport now pass. |
| UI236-R1 | Preserve ScheduleAlerts component identity across live ticks; refresh using a tick prop at the existing offset. Clamp only when the current page no longer exists. | jsdom RunList regression first reset page 2; now preserves offset and clamps deleted final page. Actual production UI: 24 runtime-generated alerts, second page, unrelated real run event, same four alerts and Previous control. |
| UI236-R2 | Preserve nested validation paths. Attach IANA feedback to timeZone and expression feedback to expression; clear matching nested errors when edited. | Regression first attached the zone error to cron. Actual valid cron plus Mars/Olympus flags only zone with its associated message; corrected America/Denver saves. |
| UI236-R3 | Explicit conflict Reload increments a JsonEditor reset key while updating config/revision/validity. This resets internal raw text even when saved JSON has the same serialized value. | Regression first retained invalid text. Actual concurrent peer update, stale save rejection, invalid raw JSON, Reload: valid saved JSON visible; another invalid save rejected; corrected save acknowledged and persisted. |
| UI236-R4 | Clear/dismiss schedule editor and confirmations when selection or visible view changes. Include pending writes in navigation protection; disable discard while the write is in flight. Acknowledged writes clear the guard synchronously before selection. | Regression first retained the kept-mounted modal. Actual Back→Keep editing retains draft; Back→Discard shows Runs with no portal; reopening reads persisted values. Held actual save request keeps Discard disabled; release acknowledges the save. |

Red and green logs are under `checks/`; actual-control scripts, results and five opened/inspected PNGs are under `ui/`. This is focused author verification of the reported defects. Parent will arrange fresh independent SDLC and UI reviews at the resulting head. Earlier design/runtime images and independent reviewer artifacts remain preserved; no human approval is claimed.

## Implementation references

Current primary React documentation confirms that a stable identity preserves state, and changing a key resets the component's internal form state. These choices preserve alert pagination while explicitly resetting discarded JSON editing buffers:

- https://github.com/reactjs/react.dev/blob/main/src/content/learn/preserving-and-resetting-state.md
- https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useState.md

Context7 resolved `/reactjs/react.dev` and returned these current primary sources. Cron parser selection and timing defaults remain the approved implementation recorded in the original spec/context; this revision changes only field error association, not parser semantics.

## Re-review fixture

Wait for the independent build to finish, then run `pnpm exec tsx .tasks/issue-236/ui/runtime-server.ts` and `pnpm exec tsx .tasks/issue-236/ui/runtime-states.ts`. To recreate 24 alerts, run `pnpm exec tsx .tasks/issue-236/revision-45758202/seed-alerts.ts`. Every script is restricted to its own generated temporary database. Use fresh IDs printed in `/tmp/issue236-revision-context.json`, not historical URLs embedded in saved browser proof. Port 5197 must be unused. Stop only that fixture server, close its browser and remove its printed temporary directory after review. Author cleanup is recorded in `cleanup.json`.

The initial pending-request harness used an exact endpoint glob and missed tRPC's query suffix; it was corrected to `**/trpc/triggers.manage*`. An attempted harness timeout also used an unavailable sandbox timer and was removed. Both were harness failures; the saved successful run exercises the actual pending request and acknowledgment. No product changes followed actual-controls verification.
