# Model tier implementation and checks

The [specification](spec.md) owns AC1–AC7 and the UI proposal. The [intent](intent.md#task-baseline) records the branch and original baseline.

## Build sequence

1. AC1–AC3: Define shared tier and declaration schemas in core. Add optional context.tier and claim metadata through the shared API, runtime, and MCP. Capture requestedTier and modelSelection on new attempt receipts, leaving legacy unknowns untouched. Clear the current claim declaration on every successful reclaim. Preserve usage snapshot rules.
2. AC2 and AC7: Extend compact continuation and work-list output schemas so parsing does not discard tiers. Audit create/update/edit/validate/publish, assignment preview, start/list/briefing/wait/submit, claim, usage inspection/reporting, and continuity interactions. Keep shared descriptions concise and add no tools.
3. AC4–AC5: Add the existing Mantine native select to Agent settings. Extend the existing usage view with node/attempt grouping and explicit requested, declared, and usage-reported values. Keep pagination and unknowns clear.
4. AC6–AC7: Add focused core/runtime, transfer, UI, and transport assertions. Update README, connect-harness, context-continuity, usage-reporting, current limits, and agent-workflow guidance where affected. Add a pending patch changeset.

## Build-owned verification

- AC1/AC6: Exercise all tiers in both context modes, invalid tier controls, omission, draft edits after publication, and portable export/import. Confirm old definitions and claim paths still work.
- AC2/AC7: Through HTTP and stdio, inspect tools/list input and output schemas, author a tier, start, discover, brief, claim with a declared selection, submit, and read per-attempt attribution. Ensure the tier survives compact parsing. Run the existing transport test suite.
- AC3/AC5: Use temporary/in-memory databases to test invalid declarations before mutation, mismatched tiers admitted, retry without a declaration, restart, expiry/failure retention, and missing usage. Compare declarations against separately reported multi-model usage. Legacy receipts must remain unknown.
- AC4/AC5: Extend existing settings and usage interaction tests. Exercise an actual browser journey with existing tooling: open Agent settings, choose Fast, switch Context, apply/save/reopen, reset to Executor default, and inspect attempt attribution. Verify visible values and keyboard-accessible controls. Save proof outside the checkout so evidence does not alter the candidate.
- AC1–AC7: Run relevant tests, pnpm build, pnpm format:check, and pnpm test:package after build because CLI behavior/help and MCP contracts change. Save commands and exit statuses outside the checkout and inspect their contents.

## Highest-risk failures

| Risk                                               | Direct check and expected outcome                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact schemas silently remove tier               | Start/submit summaries plus MCP discovery assert context.tier equals the captured value.                                                              |
| A retry inherits the prior model                   | Fail/expire a selected claim, reclaim without modelSelection, and inspect both attempts. Only the first retains the declaration.                      |
| Invalid metadata consumes a claim or binds a group | Invalid modelSelection with a valid control leaves complete work and continuity state unchanged.                                                      |
| Selection is mistaken for measured usage           | A claim declaration without a usage report shows unknown measured models and token totals. A differing multi-model report remains visible separately. |
| Optional fields change old workflow behavior       | Omitted tiers/declarations preserve ordinary claims, fresh checks, group enforcement and portable definitions.                                        |

## Independent review ownership

The workflow's fresh review inspects the complete committed task diff and saved proof for every criterion, checks repository standards separately, and independently exercises a relevant boundary from the table above. It must not modify implementation or claim inherited context is fresh. Local delivery verifies HEAD equals the reviewed commit. No PR is requested.

## Evidence

Build verification completed before candidate commit. Proof is in `/tmp/interlock-model-tiers-evidence/`; the build assignment records the exact candidate commit and results.

- AC1–AC3/AC6–AC7: `tests.log` records all 801 tests passing across 67 files, including both MCP transports, new tier/attempt tests, previous-release migration checks, settings, and usage view tests. `build.log` and `package.log` record successful production build and packed global/npx checks.
- AC4: The temporary in-memory browser fixture selected Fast, switched from current to fresh context, applied and saved changes, reopened with Fast retained, reset to Executor default, saved, and reopened with the empty/default value. `editor-fast.png` and `editor-default.txt` capture the visible controls. The early blank page was a test-server configuration error: setting the fixture's own engineUrl allowed its origin without changing product security.
- AC5: The completed fixture run's Claim attempt view displays requested max, declared balanced/provider/model, and a separate actual-provider/actual-model usage report. `run-attribution.png` and `run-attribution.txt` capture the rendered result. Grouping remains expanded across loading.
- Formatting: `pnpm format:check` was run and fails only on 393 unrelated existing untracked task artifacts. `tracked-format.log` records all tracked supported files passing, and `new-format.log` records the new product/test files passing. Unrelated artifacts were preserved.
- MCP review covered affected authoring, preview, discovery/continuation, claim, usage and continuity flows, including schemas, defaults, fields, and descriptions. This was not an audit of every MCP tool. No new tools were added. The only new routine response values are an optional tier/declaration and bounded per-attempt attribution; multi-model usage is unchanged.
