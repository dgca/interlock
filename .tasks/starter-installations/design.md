# Automatic starter delivery

Issue #185. User selected direct implementation and explicitly deferred #71 until much later. Based on main 5d9e73b after resource coordination merged. Branch codex/starter-installations. No user library or running development service was changed.

## Chosen behavior

Keep the default set to SDLC and Evaluate workflow comparison. The improvement recipe, local Git example and all-nodes demo remain optional. Catalog entries are self-contained checked-in templates with permanent IDs, bundled into the installed CLI. Newly delivered workflows publish as v1 and never start a run. Changing a template or its display name does not redeliver an existing identity.

The additive starterInstallations collection records id, outcome, optional workflowId, templateHash and recordedAt. Outcomes distinguish installation, recognized content, a preserved legacy seed decision and an ambiguous name collision. Receipts survive normal workflow deletion and catalog removal/reintroduction. Full database backups retain them; portable workflow bundles do not. No schema migration, new workflow/API fields, MCP tools, management UI or automatic template replacement is added.

Seed reads pending identities inside one storage transaction and commits publications, receipts and the compatibility marker together. Failure rolls back that new batch without changing earlier deliveries. Repeated startup returns before reading workflow history when every identity is handled. First-time recognition reads retained versions once and caches normalized content signatures per workflow, avoiding repeated full-history loads.

## Legacy recognition

Retain the old meta/seed row unchanged. Marked libraries and nonempty pre-marker libraries have already settled SDLC delivery; absence does not authorize recreating it. The evaluator is a newly introduced identity and can arrive once in those libraries.

Recognize a manual copy from its draft or any retained published definition, ignoring canvas positions, node/edge declaration order, and workflow metadata names/descriptions. Leave recognized copies untouched, including customized drafts, unpublished imports, renamed workflows, owned children and archived copies. Record one matching local ID without changing any existing copies.

An unmatched workflow with the shipped display name is ambiguity evidence, not official identity. Permanently skip automatic delivery without binding that workflow to the starter. Explicit imports remain available. An arbitrarily modified and renamed old copy without retained matching content cannot be identified reliably. Earlier manual deletions have no receipt, so an evaluator imported and deleted before tracking may arrive once. This limitation is documented rather than inferred from a name or timestamp.

## Validation

Full suite: 1,112 tests in 95 files, including 17 new installation tests and updated existing seed tests. Covers new identities after deletion, template updates, custom/archive/ownership state, active run preservation, renamed/published/draft imports, layout changes, ambiguous names, permanent deletion, atomic publication failures, restart, catalog removal/reintroduction, invalid IDs, portable copies and the previous-release fixture with continued claims.

Build, formatting, diff checks and installed-package smoke checks pass. Package checks exercise both global and npx starts, HTTP/stdio workflow discovery, both ready-to-use starters, intentional manual copies and deletion surviving restart. Tests use temporary databases and synthetic executors. Existing UI chunk-size warning remains.

README, starter/reference/release/upgrade guides, workflow examples and evaluator description reflect automatic availability. Reviewed affected MCP list/get, authoring/import/publish, archive/delete and portable-export contracts against shared API behavior. Their descriptions, schemas and lifecycle guidance remain accurate, so discovery is unchanged: 50 tools and 278,453 bytes over both transports. CLI import/help still matches its implementation. This is an affected-flow review, not an audit of every MCP tool. Real provider accounts and the user's library were not exercised.
