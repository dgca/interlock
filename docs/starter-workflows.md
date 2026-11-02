# Automatic starter workflows

Interlock installs a curated set of published workflows when a server starts with a new or upgraded library. Installation never starts a run, launches an executor or consumes model usage. Installed workflows belong to the user and use ordinary editing, publishing, archive and deletion operations.

## Default set

| Starter                          | Fresh library                         | Earlier library                                                                                    |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **SDLC workflow**                | Installed and published as version 1. | The previous seed decision is preserved. A missing or deleted SDLC is not added again.             |
| **Evaluate workflow comparison** | Installed and published as version 1. | Added once unless an existing copy is recognized or a legacy name collision prevents installation. |

The improvement starter, local Git example and all-nodes demo remain optional imports. New default starters can arrive in later releases without replacing existing workflows. Find installed starters in **Workflows** or through normal MCP workflow discovery. Their input contracts and execution requirements are unchanged.

## Updates and deletion

Each starter has a permanent catalog identity and a local delivery receipt. Repeated startup, another release or a change to our shipped template does not deliver that identity again. Existing drafts, published versions, ownership, archive state and runs remain intact. Template changes apply only when installing into a library that has not handled that starter.

Deleting a starter keeps its receipt. It stays deleted after restart or upgrade, even when every workflow has been removed. A different newly introduced starter can still arrive in a later release. Automatic installation does not update or republish a customized copy.

Explicit manual imports remain available. Importing a standalone starter file creates another draft intentionally; it does not clear the receipt or replace an existing workflow. Imported drafts require publication before use. See [SDLC import](sdlc-workflow.md#import-the-starter-into-an-existing-library) and [evaluator setup](workflow-evaluation.md#find-the-starter).

## Older libraries and manual copies

The earlier `meta/seed` marker remains unchanged. On first upgrade to receipt tracking, Interlock treats SDLC as already handled in marked libraries and nonempty pre-marker libraries. This preserves prior deletions and the old rule that existing libraries were not seeded with SDLC.

For each new starter, matching compares its normalized definition with existing drafts and retained published definitions. Canvas positions, node declaration order, edge declaration order, and the workflow's name and description do not affect recognition. A recognized copy is left untouched, including an unpublished draft or an archived owned child. Its local ID is recorded as the copy already delivered. Multiple existing copies are preserved.

A matching display name with different content is ambiguous. Installation is skipped permanently for that starter without assigning official identity to the existing workflow. A manual import can still create a copy if wanted. Names are not a permanent identity mechanism.

An arbitrarily changed and renamed old copy with no retained matching definition cannot be identified reliably. Older manual deletions were not recorded either: an evaluator manually imported and deleted before receipt tracking may be installed once on upgrade. Deletion after tracking is permanent for automatic delivery.

## Library and package boundaries

Receipts live in the library database and survive normal workflow deletion and full database backup/restore. Portable workflow exports contain definitions, not delivery receipts. A different library makes its own installation decisions and can recognize imported definitions. Replacing the whole database or restoring an older backup discards decisions absent from that database.

All new deliveries and receipts commit together. A failure rolls back that startup's installation batch so it can be retried without partial copies. Previously committed workflows and receipts remain intact. The package bundles the curated templates; installation does not fetch GitHub content or depend on a developer checkout. No new MCP tools or starter-management UI are needed.
