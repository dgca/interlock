# Implementation and verification

Behavior is defined in [spec.md](spec.md); scope and baseline are in [intent.md](intent.md).

## Build responsibilities

1. AC1–AC3: add core acknowledgment/diagnostic contracts and projection helpers. Add shared API summary operations, preserving existing procedure return types. Compare pre/post-edit diagnostics within the runtime transaction. Register MCP modes and output schemas through the common HTTP/stdio adapter.
2. AC4: share continuation next-call projection in core. Parse additive CLI flags without changing positional JSON/file arguments or defaults. Cover options precedence and invalid flags/durations against a temporary server.
3. AC5–AC6: extend Agent/work contracts and runtime budget accounting. Record hashed expiry receipts before clearing tokens. Pump expiry before claim-sensitive mutation transactions so thrown errors do not roll back expiry. Keep receipts out of external work responses. Add policy and counts to discovery/continuations.
4. AC7: extend the existing Agent inspector with an optional budget switch/input and conditional guidance. Reuse current dialog behavior and update the node summary.
5. AC8: audit README, architecture, current scope, agent operations, connection guidance, CLI help, and affected MCP authoring/execution instructions. Add a root patch changeset.

Use temporary databases for automated checks. Build owns targeted tests, `pnpm test`, `pnpm build`, `pnpm test:package` after build, and `pnpm format:check`. Save check logs outside the checkout and record meaningful outcomes in verification.md before the implementation commit.

## Risk-driven checks

- AC1–AC3: large synthetic 27-node definitions must be absent from summary text and structured content; full/default responses retain them. Verify schemas and both modes over HTTP and stdio. Verify committed revisions/versions, archive/restore, cascade, invalid mode rejection, and unchanged import shape.
- AC2: a lease-only edit with existing warnings emits bounded samples/counts; an upstream contract edit retains new downstream warnings. Stable IDs survive index shifts. Save-blocking and stale edits leave the complete workflow unchanged; a valid edit is the control.
- AC4: start/submit summary and full paths, positional version, file JSON, claim JSON/flag precedence, and invalid options are exercised through the real shared API. Summary cursor/next-call semantics reuse existing continuation coverage.
- AC5–AC6: fake-time tests cover exact expiry, active valid control, separate failure/expiry exhaustion, old combined budget, restart, immutable captured policy, unclaimed timeout, cancellation, completed replay, and A-expiry/B-claim/B-expiry/A-submit. Verify errors, persisted counters, one expiry event, and no stale-token mutation.
- AC7: in an isolated server, open Agent settings, enable separate budget, change count, apply/save, reopen and inspect retained controls. Disable and verify the field is absent. Check keyboard input and invalid-value rejection through existing controls; save a screenshot and concise outcome outside the checkout.

## Independent review and completion

The SDLC review assignment requires an isolated fresh-context reviewer. Review the full committed diff against AC1–AC8 and repository standards. Inspect saved evidence and independently exercise a lease-recovery boundary. Findings must identify locations and stable IDs; fix worthwhile findings and re-review the changed commit. PreparePr verifies the exact reviewed HEAD and finishes locally, as configured. No PR creation, merge, or release in this run.

## Review revision

Finding `5d68a6eaa000-cli-negative-json` exposed a compatibility gap in AC4: strict option parsing rejected negative numeric JSON inputs and results. Separate valid negative JSON numbers from options before parsing the boolean summary flag. Retain strict option validation, positional ordering, and the `--` separator. Exercise start → claim → submit for negative integers, zero, fractions and exponents in full and summary modes, with flags before and after positionals. Verify unknown short/long flags and invalid boolean values still reject. Rerun the affected CLI/transport suite and required repository checks. Other implementation and UI behavior is unchanged; retain earlier evidence with its original commit.
