#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
await createMcpServer(process.env.INTERLOCK_URL).connect(
  new StdioServerTransport(),
);
