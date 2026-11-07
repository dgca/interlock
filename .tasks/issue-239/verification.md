# Verification

## Review revision 1

Checked source: `d6057f1ab336bcc67569a9f0fcd6f0913610b01f`. Latest fetched main remains `e9179503567b0577dade57e1021c52396b2cc32b`.

`pnpm test` passes 133 files and 1,581 tests. `pnpm build`, `pnpm format:check`, `git diff --check` and `pnpm test:package` after that build pass. Logs are `/tmp/interlock-239-d6057f1-{tests,build,format,package}.log`. The later artifact commit changes only this directory.

[Review fixes](review-fixes.md) maps all five stable review finding IDs to red-to-green tests, original probe reruns and current source provenance. No UI source changed; the original actual-control evidence below is retained with its original source commit.

Current full HTTP and stdio discovery envelopes both measure 280,092 bytes. Arrays measure 280,082 bytes, initialization instructions remain 9,973 bytes and tool count remains 60. The 304-byte increase since the prior review is lifecycle guidance for deadline reconciliation and resumed availability. Baseline stays 267,709 envelope bytes / 267,699 array bytes / 9,979 instruction bytes / 59 tools. The envelope ceiling remains 283,000 bytes. See [exact measurements](mcp-discovery.json).

## Initial candidate evidence retained

Source commit: `63c1142740f48121779d9ca79ac721bf5f70395b`.
Original and freshly fetched main baseline: `e9179503567b0577dade57e1021c52396b2cc32b`.
The later evidence commit changes only this directory. The source and test results below remain applicable.

## Checks

- `pnpm test`: 132 files, 1,572 tests passed. Log: `/tmp/interlock-239-63c1142-tests.log`.
- `pnpm build`: TypeScript, UI and package bundling passed. Existing large-chunk warnings remain. Log: `/tmp/interlock-239-63c1142-build.log`.
- `pnpm format:check`: passed. Log: `/tmp/interlock-239-63c1142-format.log`.
- `pnpm test:package`: passed after that build. Packed global and npx checks covered CLI, UI assets, HTTP/stdio MCP, restart persistence, JavaScript, supervised background recovery and reviewed history cleanup. Log: `/tmp/interlock-239-63c1142-package.log`.
- `git diff --check`: passed.

AC1 is covered by inheritance/null/bounds/revision tests in `tests/stalls.test.ts`, shared create/edit/claim/briefing round trips and matching discovery in `tests/stallTransport.test.ts`, plus existing authoring, raw-definition and transfer suites.

AC2–AC4 are covered by exact threshold boundaries, durable event deduplication/resolution, input actor preservation, historical overlapping pauses/work holds, real managed permission requests, resource uncertainty, late result/renewal rejection, fresh claim deadlines, restart and H7 continuation/transient tests in `tests/stalls.test.ts`.

AC5 is covered by eight deterministic fake-launcher tests in `tests/stallRecovery.test.ts`: actual message delivery, confirmed stop/relaunch, retained failure history/caps/fresh tickets, renewal/completion/pause races, uncertain stop, file-backed restart, claim-ticket rollback and stale status responses after relaunch. Existing custom harness/recovery/provider/continuity suites also pass. No account or model was invoked.

## Actual controls, AC6

Used a dedicated Playwright browser and isolated in-memory Engine/server on a temporary local port, with no managed adapters attached. The check used the production UI build. Saved library unclaimed threshold `300000` through Harnesses, reloaded and observed it retained. Applied a workflow override through Workflow settings. Through Agent settings, set unclaimed threshold `1000` and maximum active execution `10 hours`, applied, saved, reloaded and reopened the controls. A shared API read confirmed draft revision 2 with the workflow and Agent values.

Published v1 through Review publication and started it through Run v1. The run stayed waiting with agent actor. The sidebar and Needs attention tab showed one Stalled item; clicking it selected the stalled Agent execution. Inspection displayed a one-second active threshold and the per-attempt limit in readable units. This did not claim or complete the assignment. Checked the deadline control at 390 × 844 and desktop sizes; existing dialog scrolling and footer stayed usable.

Evidence: `ui-library.png`, `ui-node.png`, `ui-node-mobile.png`, `ui-attention.png`. Controls were checked on the UI source captured in `427fdf56863a500dc0c5357fa2bd53e0e04ec556`; the subsequent source commit changes only launcher recovery and its tests, leaving those controls and the unmanaged journey unchanged. The Impeccable detector returned no findings. No separate UI automation framework was added.

The temporary browser and server are closed. The baseline measurement worktree was removed. No real server configuration, schedules, holds, account state or `.interlock` data changed.

## Documentation and affected MCP workflow, AC7

Updated timers, managed executors, architecture, current scope, connection guidance, Agent workflow guidance, README and CONTEXT. CLI help includes `stalls`. The patch changeset describes user-visible behavior. Agent execution is no longer described as universally unlimited.

Checked affected MCP authoring/discovery and portable definition paths, work discovery, claim/renew/preflight/submit, run inspection/briefing, external input, work holds, named pauses, managed inspection/recovery, and their shared API contracts. HTTP and stdio tests exercise matching complete discovery; the new transport suite checks thresholds, bounds/defaults, edit/save, inspection paging and returned execution-limit fields. Existing budget/resource/continuity/provider protection suites pass. This is an affected-flow audit, not an audit of every MCP tool.

## MCP context measurement

`mcp-discovery.json` retains exact measurements over actual HTTP and stdio connections, with no workflows or executors launched. Both transports match. Reproduce the current measurement with `node --import tsx --input-type=module < .tasks/issue-239/measure-mcp.mjs` from the checkout root. Baseline was measured in a clean temporary checkout of the baseline commit with the same lockfile dependencies.

| Measurement                                | Baseline | Source commit |
| ------------------------------------------ | -------: | ------------: |
| Tools                                      |       59 |            60 |
| Full tools/list JSON envelope, UTF-8 bytes |   267709 |        279788 |
| Tools array, UTF-8 bytes                   |   267699 |        279778 |
| Initialization instructions, UTF-8 bytes   |     9979 |          9973 |

The full envelope grows 12,079 bytes, about 4.5%. One grouped `manage_stalls` operation costs 2,907 bytes and handles local defaults plus bounded inspection. Typed definition fields account for 3,126 bytes in import, 2,366 in create and 2,271 in update discovery. Claim/renew/continuation fields and affected guidance account for the rest. Clock-specific node schemas avoid repeating inapplicable controls. The discovery envelope ceiling is 283,000 bytes; the unchanged instructions ceiling is 10,000 bytes.

Inspection defaults to 20 current stall records, caps at 100, exposes exact total/nextOffset, and omits task payloads and tokens. Detailed records are fetched on demand. Existing full run inspection adds only the bounded current-stall page. Lifecycle emission does not register future M2 event triggers.

## Limits for review

Human-wait detection observes unheld input nodes. Declared `needs_human` and acceptance holds freeze clocks, as recorded in spec.md. Automated nudge/stop recovery requires custom launcher message, stop and status operations. Native/direct adapters retain observational attention. An ended status is the custom adapter's confirmation, not an independent provider/session guarantee. Failure/claim budgets and uncertain ownership remain authoritative. No release or package publication is performed.
