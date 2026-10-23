# Model tier behavior

The [intent](intent.md) owns the problem, authorized scope, and constraints.

## Decisions

`context.tier` accepts `max`, `balanced`, or `fast`. These mean the executor's strongest capability, a capability/speed balance, and a preference for speed respectively. They describe relative preferences within the executor's available models, with no price, latency, reasoning-effort, or quality guarantee. Omission means executor default. The vocabulary is fixed in this increment.

Tiers apply independently of `context.mode`. Both current and fresh assignments expose the same optional preference. Required isolation and continuity take precedence. A different declared tier or an omitted model declaration does not reject a claim or trigger a handoff.

Optional claim `modelSelection` records the executor's declared tier and provider/model selection. Its fields are independently optional, but the object must contain at least one known value. Provider and model use the same bounded identity rules as usage reporting. Claims without a declaration remain valid. This declaration is a selection at claim time, not evidence of model execution. Usage reports retain their existing cumulative, potentially multi-model meaning and remain separate.

Each attempt retains the requested tier and its own selection. Retries cannot inherit another attempt's declaration. Missing historical request or selection data remains unknown; no historical records are rewritten. An absent tier on newly captured work means executor default, distinguished from unavailable legacy attribution.

## Acceptance criteria

- AC1: Agent definitions accept each tier with current or fresh mode and reject unknown tier values. Unset tiers remain absent and preserve existing behavior. Published versions do not change when drafts change.
- AC2: Full and compact work discovery, run briefings, compact start/submit continuation, and claim results expose the captured requested tier before or at claim without extra reads.
- AC3: Shared API, CLI, and MCP claims accept optional bounded modelSelection metadata without enforcing a tier match. Invalid declarations reject before reservation. Attempts retain separate requested and declared values through retry and restart, including after failure or expiry. Reporting remains optional and does not infer measured usage.
- AC4: Agent settings offer No preference, Max, Balanced, and Fast for both Context modes. Save/reopen and raw/visual round trips retain the setting. Removing a tier restores omission. Context, capabilities, and continuity remain unchanged.
- AC5: Run inspection provides bounded per-attempt requested tier, declared selection, and usage-reported model identities, with explicit unknown values. Existing aggregate usage remains available. Missing usage is never presented as the claim declaration.
- AC6: Portable export/import round-trips tiers without exporting run selections or usage. Existing definitions, claims without metadata, and legacy attempt records remain compatible.
- AC7: Affected README, docs, CLI help, MCP authoring/discovery/claim schemas and descriptions agree with implementation. HTTP and stdio clients discover the vocabulary and selection schema and can execute the tier flow. A pending patch changeset describes the shipped behavior.

## UI proposal

Place a standard Mantine native select labeled Model tier after Context settings. Start with No preference. Describe the advisory preference and required session preservation beside the control. Switching Context does not reset or disable it. The control uses the existing dialog's keyboard navigation, focus, save/cancel behavior, and responsive width.

The user approved "No preference" in this chat on 2026-10-22, replacing the initial "Executor default" UI label. The same label identifies a captured unset tier in run inspection. API omission and null semantics remain unchanged.

In the existing Reported usage section, offer node aggregation or attempt attribution through a labeled grouping control. Attempt rows show the requested tier, the declared selection, and separately reported models. Use the existing bounded pagination, loading/error handling, and horizontal table overflow on narrow screens. No model selection action is added to the manual completion flow.

## Risks and alternatives

An open-ended hints map would weaken portability and discoverability without solving a current need. Vendor model names remain confined to executor declarations and usage. Claim-only selection avoids changing usage sequence/finality rules. Tiers do not promise that a current conversation can change models, and a tier mismatch is not an execution failure.

No consequential decisions remain open. These choices implement the existing request through established optional claim metadata and attempt reporting patterns.
