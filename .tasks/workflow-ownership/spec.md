# Preserve workflow identity across ownership changes

Scope and authorization are in [intent.md](intent.md). No UI changes are required.

**AC1.** Shared API and MCP expose a read-only ownership preview and an explicit set-owner operation. Inputs identify an existing target workflow and proposed owner ID, or null to release to the library. Reject malformed or missing identities. Preview returns current/proposed ownership, whether the operation can proceed, exact blockers and their reasons. Preview changes no stored data.

**AC2.** Adoption and reparenting require an existing, unarchived library owner different from the target. A target with owned children cannot itself become a child. Preserve one-level ownership. Archived targets may move without changing their archive flag. A release requires no new owner and relaxes reuse restrictions. Setting the existing owner is a no-op, including when that owner is archived.

**AC3.** Every draft and retained published version that references the target must belong to the proposed owner. Report all other references with caller ID/name, draft or version, latest/historical distinction, and node ID/label. Include archived callers, null-version draft references, Workflow nodes inside Batch, and self-references. Deletion identities alone do not count as retained callers. Never silently remove or rewrite a reference. Historical blockers point to explicit version cleanup; current blockers require authoring changes. Release does not need these restrictions.

**AC4.** The mutation requires the expected current owner ID, including explicit null for a library workflow, and rechecks it and all rules inside a storage transaction. Reject stale ownership or new blockers without mutation. A successful change updates only owner metadata and updatedAt. Identity, draft revision, draft, publication counter, retained definitions, deletion identities, prompts, runs, work, events and ancestry remain unchanged. No-op preserves timestamp. Failure rolls back the complete change.

**AC5.** Existing draft-save and publication validation continues to reject foreign child references. Direct tests and active owner invocations continue after valid ownership changes. Run ancestry remains execution ancestry rather than ownership ancestry. Release makes future foreign references valid. The operation does not start, cancel, retry or publish anything.

**AC6.** Export includes the resulting owner/children as usual; fresh imports preserve them. Ordinary and forced imports still reject changes to existing ownership. Restoring deleted definitions remains subject to the current owner/reference rules, including rejection of a historical foreign caller after adoption. Failed imports preserve complete state.

**AC7.** Update README, architecture, current limits and agent guidance against final behavior. Audit affected MCP discovery, creation/editing/publication, ownership, cleanup, transfer/restoration and direct-run guidance, including schemas, defaults, returned fields, bounds and errors. Verify ownership contracts over HTTP and stdio. Include a pending patch changeset for `@type_of/interlock`. Existing generic metadata updates and Raw editing do not acquire an ownership field.

The dedicated operation keeps ownership independent of draft saves. Requiring an expected owner protects against overwriting a concurrent move without advancing draftRevision. Reference validation occurs again during mutation, so a preview cannot authorize a newly invalid state. No destructive history acknowledgment is required for this reversible metadata operation; destructive cleanup retains its separate preview and human agreement.

No specification decisions remain unresolved. Owner existence, archive and one-level checks match the existing child-creation rules. No-op behavior follows existing draft/transfer conventions.
