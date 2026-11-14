---
'@type_of/interlock': patch
---

Add a small plain-JSON HTTP API under `/api` for scripts and integrations: list published workflows with their input contracts, start a run with an `Idempotency-Key`, read its compact status and result, and cancel it. The routes share validation and execution rules with the UI, CLI and MCP, and `INTERLOCK_REQUIRE_TOKEN=1` now also protects `/api`. See `docs/http-api.md`.
