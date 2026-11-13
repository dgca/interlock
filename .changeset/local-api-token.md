---
'@type_of/interlock': patch
---

Add an opt-in local API token. Interlock creates an owner-only `api-token` file in its key folder; the UI, the `interlock` CLI and the stdio bridge send it automatically, and **Connect with MCP** includes it as an `Authorization` header in HTTP client configuration. Set `INTERLOCK_REQUIRE_TOKEN=1` to reject `/trpc`, `/mcp` and `/events` requests without it. The token is not required by default, so existing client configurations keep working.
