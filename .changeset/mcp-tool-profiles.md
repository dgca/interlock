---
'@type_of/interlock': patch
---

Serve smaller MCP tool profiles. Connect to `/mcp/execute`, `/mcp/author` or `/mcp/operate`, send `X-Interlock-Mcp-Profile`, or run `interlock mcp --profile <name>`; `/mcp` keeps every tool. Workflow definition and bundle schemas are published once as MCP resources instead of being repeated in tool definitions, reducing the full tool list from about 300 KB to about 185 KB. Custom launcher sessions receive the execute endpoint as `$INTERLOCK_MCP_URL` and `mcpUrl`.
