# Assignment size diagnostics

Issue #139. Add one read-only operation for captured assignments and draft/published Agent previews. Count UTF-8 bytes of compact JSON field values for prompt, context policy, input, output schema, execution instructions, and saved prompt metadata. The sum excludes transport envelope, claim identity/lease fields, and surrounding property names. It is not a token or cost estimate.

Preview accepts explicit incoming/run/root/item inputs and same-scope node-output fixtures. Missing sources and paths remain unknown; never substitute an empty object. Published previews use that definition but current saved prompts, matching capture-at-start behavior. Fresh-session execution instructions need future run/work IDs and remain unknown in previews. Existing assignments use captured content and exact generated instructions. Input contract compatibility is reported without echoing candidate values.

Warnings use a caller-selected byte threshold and cannot change claims or delivery. Return at most ten largest immediate fields, bounded unresolved references, and an aggregate repeated-string diagnostic. Limit diagnostic traversal, label truncation, and keep complete component byte counts separate from partial diagnostics. Add shared API, CLI, and one MCP tool. Send sample-bearing queries by POST. No stored fields, workflows, or migrations change.
