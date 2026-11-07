---
'@type_of/interlock': patch
---

Add read-only system readiness and health check via `interlock doctor [--live] [--json]`, MCP tool `doctor`, shared API `system.doctor`, and UI diagnostics view (`/settings/diagnostics`), verifying system health, harness configurations, active triggers, blockers, and workflow integrity with non-zero exit codes on failure.
