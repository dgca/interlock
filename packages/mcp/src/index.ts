#!/usr/bin/env node
import { createMcpClient } from './client.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
await createMcpServer(
  createMcpClient(process.env.INTERLOCK_URL),
  process.env.INTERLOCK_MCP_PROFILE,
).connect(new StdioServerTransport());
