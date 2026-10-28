# Behavior

Optional Agent resultRules contains at most 32 exists or equalsInput rules, each with a unique trimmed 1–64 character ID and 0–256 character paths using existing readPath semantics. Missing values fail; null exists; equality is structural and type-sensitive. Rules use the assignment's own captured resolved input after bindings.

Drafts retain semantically incomplete rules. Publication rejects duplicate IDs and paths excluded by the conservative closed-contract subset. Unsupported schemas remain unknown. Old definitions remain unchanged.

Preflight and submission share one evaluator. Rejection cannot complete work, consume an attempt, renew a lease, or dispatch downstream work. Capture survives restart/retry and later publication. Diagnostics omit values, identify rule/path, and retain bounded totals. Full claims include rules; summary discovery does not. Existing tools serve authoring, preflight and submission.

Agent settings offer structured checks. Portable transfer and assignment size diagnostics retain/account for rules. A pending patch changeset and affected docs/CLI/MCP guidance accompany HTTP and stdio verification.
