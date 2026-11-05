# Workflow variables: initial research

Issue: https://github.com/dgca/interlock/issues/193

Status: research only. No implementation or storage decision has been accepted.

## Existing behavior that affects the design

- Saved Prompts already provide a central library, stable references, optimistic
  editing, and dependency checks across drafts and retained published versions.
  Their run-start capture copies plaintext content into run records; secrets must
  not use that storage mechanism.
- Fetch resolves and saves `execution.request` before execution in
  `packages/runtime/src/index.ts`. Adding secret bindings to the current resolver
  would therefore save credentials in ordinary execution history. Actual secret
  injection must happen at the execution boundary, after the safe request record
  has been constructed.
- Script supports an explicit process environment in
  `packages/runtime/src/scripts.ts`, but currently retains the last 8 KiB of stderr
  in failure messages. A secret-aware environment needs matching output and error
  handling before values reach persisted history or routed failure data.
- Fetch and Script are also used by polling Wait checks. Their support or rejection
  of variable bindings must be explicit; they cannot accidentally inherit support
  from a shared schema without runtime and history protection.
- Ordinary invoked workflows capture prompts independently; Batch items inherit
  their parent's capture. Comparisons capture the transitive prompt selection for
  queued samples and descendants. Variables need an explicit corresponding policy.
- There is no existing credential store or encryption abstraction in the storage,
  server, or CLI packages. The supported package platforms are macOS and Linux.
- The existing Prompts surface and Fetch binding rows provide the incumbent UI
  patterns. A variables feature can reuse their navigation and editor structure.

## Proposed first-release boundaries

These are recommendations for the specification, not accepted requirements.

1. Use one instance-wide library with stable IDs and unique names. Defer workflow
   overrides, named environments, and multi-user authorization.
2. Start delivery with Fetch headers and Script environment entries. Reference
   selections are explicit per consumer. Do not introduce a generic secret binding
   that silently exposes values to Agent prompts or ordinary execution inputs.
3. Capture revision references at startup. Rotation changes subsequent runs; a
   retained run continues using its captured revision on retry or restart. Batch
   items inherit. Invoked workflows capture at their own start. Comparisons pin
   their selections before queued work begins. Continue-as-new retains its capture.
4. Keep secret revisions protected separately from ordinary run history. Runs may
   retain variable ID, name, kind, and revision metadata, never plaintext values.
   Rotation does not imply provider-side revocation of an old credential.
5. Reject missing variables or inaccessible protected revisions with actionable
   errors. Do not substitute empty strings or the current revision for a missing
   captured revision.
6. Block deletion while drafts or retained published definitions reference a
   variable. Renames preserve ID-based references. Historical run references need a
   separate retention policy before protected revisions can be removed.
7. Export references and safe requirements metadata only, including for ordinary
   configuration values. Import must make local requirements visible and require
   deliberate provisioning or binding before a run can use them.
8. Management reads return metadata only. Secret creation and replacement are
   write-only operations. MCP descriptions must explain that supplying a value
   through an agent discloses that value to that agent and its transport.

## Storage decision to settle before implementation

The issue permits an OS credential store or authenticated encryption with a key
held separately. There are two practical candidates:

- An OS credential-store adapter gives the OS responsibility for key access, but
  needs a clear macOS/Linux and headless-server availability policy, packaging
  verification, and recovery guidance.
- An encrypted revision store can use Node's built-in AES-256-GCM with a separately
  held, owner-only key file. This avoids a native dependency but makes key placement,
  backup, permissions, and loss recovery part of Interlock's explicit contract.
  A database backup alone must not include the key. Missing keys must never trigger
  silent regeneration when protected records already exist.

Node's documented authenticated encryption API supports separate authentication
tags and authenticated metadata. This establishes API availability, not the choice
of backend or a complete credential-storage design:
https://github.com/nodejs/node/blob/v24.22.2/doc/api/crypto.md

## UI direction

Extend the established library/editor pattern, retaining the current Mantine
theme. Library rows show name, Config/Secret kind, availability, and revision.
Avoid a persistent column of identical password dots. A secret editor shows that a
value is set and offers **Replace value**, without a read-back or reveal action.
Show workflow dependencies before deletion. Node reference controls should show
missing selections inline and make secret delivery to the consuming operation
clear. Keep edits local until Save and preserve them on revision conflicts.

## Verification priorities

Use temporary databases, a temporary protected store, and fake credentials. Inspect
raw stored records as well as UI/API/MCP output. Cover multiple published callers,
rotation during a run, retry/restart, Batch and child capture, comparison queueing,
continue-as-new, reference deletion, revision conflicts, export/import requirements,
and missing or mismatched keys. Exercise echoed credentials in Script output,
stderr, Fetch responses, polling checks, and routed failures. Do not claim arbitrary
transformed output can be made secret-safe by exact-string masking.

## Workflow status

On November 3, 2026, the user selected the published SDLC workflow. The development
server was stopped and has been restarted. The existing published workflow's input
contract was inspected, no matching run was found, and version 4 was started as
`92fcc026-3b36-43c7-991e-e1da4ba4e7d7`. See `run.json` for the resume identity.
