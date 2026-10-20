# Verification

## Build evidence

Logs and live SDLC receipts are in /tmp/interlock-118.bZSufQ. Tests use in-memory or temporary databases. The live development database was read only to export published SDLC v4; all task coordination runs in an isolated temporary database.

| Check                                                                                                  | Observed result                                                                                                                                                                                                       | Criteria      |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| pnpm exec vitest run tests/mcp-continuation.test.ts tests/transport.test.ts tests/continuation.test.ts | 26 tests passed. Both transports discover summary defaults and matching output schemas, validate structuredContent parity, preserve explicit full responses, reject invalid mutations and replay safely. targeted.log | AC1–AC5       |
| pnpm test                                                                                              | 649 tests in 53 files passed. tests.log                                                                                                                                                                               | AC1–AC5       |
| pnpm build                                                                                             | TypeScript, UI and bundled package passed. build.log. Existing large-chunk notice remains.                                                                                                                            | AC2, AC5      |
| pnpm test:package                                                                                      | Packed global and npx installations passed, including HTTP/stdio MCP, restart persistence, default summary submission, suggested final-result retrieval and explicit full replay. package.log                         | AC1, AC2, AC5 |
| Final focused transport regression                                                                     | Passed after simplifying explicit-full checks and adding exact startup payload comparison. final-targeted.log                                                                                                         | AC1–AC5       |
| pnpm format:check                                                                                      | Passed after correcting the documentation table. format.log                                                                                                                                                           | AC6           |
| pnpm release:status                                                                                    | Only @type_of/interlock receives a minor bump. release-status.log                                                                                                                                                     | AC6           |

The 34-node fixture returns 1,102 bytes at default startup and 1,211 bytes after submission, versus 4,938,596 bytes for full inspection after four stages. The 4,096-byte regression ceiling applies to this fixture, not arbitrary metadata lengths. Explicit full start/submission/list payloads match engine results. Complete claims remain covered by existing transport tests.

New transport assertions follow valid read suggestions for completed, claimed, pending, cancelled and failed states. They retrieve 42 after an Agent submits 21 and a downstream Script doubles it. They check detached child result identity and preserve bounded Batch continuation and current-state replay. Runtime continuation regression covers ordinary ancestor scope, nested Batches, cursor reset and detached boundaries.

## Documentation and affected MCP flow

Checked README, docs/agent-workflows.md, connect-harness.md, architecture.md, v1.md, upgrading.md, releases.md, and CLI help against implementations. Updated default descriptions, current field meanings, claim/full retrieval, selected final output, cancellation/failure reads, independent detached work, limits, and safe existing-run inspection. The migration section describes both 0.1 and 0.2 shapes. CLI behavior and help remain accurate and unchanged.

Reviewed MCP server instructions and start_run, submit_result, list_work, claim_work, get_run, get_run_briefing, get_run_result, wait_for_run_change, plus adjacent retry/fail/cancel guidance for consistency. HTTP and stdio tests check discovery and execution. This is an affected continuation-flow audit, not a review of the entire MCP tool set. Lease changes and other mutation compaction are deferred.

## Summary execution evidence

Published SDLC v4 run a8e92cfc-cdb9-41f7-bb51-b7471c041dbb uses explicit detail: summary for startup and every submitted result, and fields: summary for discovery. The baseline server validates those options and the receipt helper asserts that responses contain runId without full run inspection.

Startup returned 1,095 bytes. Seven planning submissions returned 504–1,202 bytes. The wait_for_change response after planning correctly represented pending script execution rather than completion. get_run_result retrieved the persisted plan artifact path from execution b506b114-ac6c-40f4-adba-2dd6727abb02. Receipts contain the actual requests and response sizes. The fresh reviewer continues this same run; final delivery retrieves its terminal result separately.

The baseline SDLC server uses released opt-in summary behavior; automated candidate tests cover the new omitted defaults and nextCall suggestions. These are separate forms of evidence.
