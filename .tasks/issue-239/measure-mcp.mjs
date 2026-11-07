import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from './packages/runtime/src/index.ts';
import { Store } from './packages/storage/src/index.ts';
import { createApp } from './packages/server/src/app.ts';
const e = new Engine(new Store(':memory:'), process.cwd());
const server = serve({
  fetch: createApp(e).fetch,
  hostname: '127.0.0.1',
  port: 0,
});
await new Promise((r) =>
  server.listening ? r() : server.once('listening', r),
);
const url = 'http://127.0.0.1:' + server.address().port;
for (const mode of ['http', 'stdio']) {
  const client = new Client({ name: 'discovery-proof', version: '1' });
  const transport =
    mode === 'http'
      ? new StreamableHTTPClientTransport(new URL(url + '/mcp'))
      : new StdioClientTransport({
          command: process.execPath,
          args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
          cwd: process.cwd(),
          env: { ...process.env, INTERLOCK_URL: url },
          stderr: 'pipe',
        });
  await client.connect(transport);
  const result = await client.listTools();
  console.log(
    JSON.stringify({
      mode,
      tools: result.tools.length,
      envelopeBytes: Buffer.byteLength(JSON.stringify(result)),
      definitionsBytes: Buffer.byteLength(JSON.stringify(result.tools)),
      instructionsBytes: Buffer.byteLength(client.getInstructions()),
      contributions: result.tools
        .filter((t) =>
          [
            'manage_stalls',
            'create_workflow',
            'update_workflow',
            'import_workflows',
            'claim_work',
            'start_run',
            'submit_result',
            'edit_workflow',
            'list_work',
            'renew_claim',
            'get_run_briefing',
            'manage_executors',
          ].includes(t.name),
        )
        .map((t) => ({
          name: t.name,
          bytes: Buffer.byteLength(JSON.stringify(t)),
        })),
    }),
  );
  await client.close();
  await transport.close();
}
await new Promise((r) => server.close(r));
e.stop();
e.store.close();
