# Comparison metrics implementation record

Implemented #176 directly, as requested. No SDLC run was started. Base: `8b49cc1`.

## Verification

- Full suite: 936 tests pass across 80 files, including 16 new runtime cases and HTTP/stdio measurement discovery/execution.
- Build and formatting checks pass. Package smoke checks exercise the installed CLI, HTTP/stdio bridge, restart and persistence.
- Regression coverage includes original-attempt late receipts, retry/restart isolation, nested/detached trials, cancellation, missing history, multiple currencies, overflow, byte-cap continuation, and compact/full responses.
- Terminal events determine elapsed time. A regression confirms that changing a completed parent's budget while detached work runs does not inflate its completion time. Missing terminal events stay unknown.
- No UI behavior changed, so no browser check was needed. Tests use temporary/in-memory databases and fake work, without paid model calls or changes to user data.

## MCP impact

No new tools. Both transports discover 49 tools and 234,678 bytes of definitions. The recorded base discovery was 233,631 bytes, a 1,047-byte increase for the report options and selection guidance.

A synthetic six-case fixture produced approximately 15.4 KB for the default compact report, 34.5 KB for full detail, and 8.4 KB for full detail narrowed to one sample/case. The previous report fields alone were approximately 6.4 KB. These are JSON payload measurements, not token or billing estimates. Full detail remains explicit and all reports retain their 256 KiB cap.

## Delivery and limits

Use the PR closing #176 for final delivery and CI status. The pending patch changeset retains the root package version. No automatic grader, score averaging, winner selection or promotion is included. Legacy observations remain readable with unknown metrics. Reported cost depends on external receipts and is not verified billing. Timing describes workflow events and recorded assignment intervals, not model compute time.
