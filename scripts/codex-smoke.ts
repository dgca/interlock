import { createClient } from '../packages/client/src/index.js';
import { blankDefinition } from '../packages/core/src/index.js';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const client = createClient();
const definition = blankDefinition();
if (definition.nodes[1].kind === 'agent') {
  definition.nodes[1].prompt =
    'Return the uppercase form of input.message as {"message": string}. Use no external tools or sources.';
  definition.nodes[1].outputSchema = {
    type: 'object',
    required: ['message'],
    properties: { message: { type: 'string' } },
    additionalProperties: false,
  };
}
const w = await client.workflows.create.mutate({
  name: 'Codex integration smoke',
  description: 'Local text-only integration check.',
  definition,
});
await client.workflows.publish.mutate({ id: w.id });
const root = process.cwd();
const config = `mcp_servers.interlock={command=${JSON.stringify(process.execPath)},args=["--import",${JSON.stringify(resolve(root, 'node_modules/tsx/dist/loader.mjs'))},${JSON.stringify(resolve(root, 'packages/mcp/src/index.ts'))}]}`;
const prompt = `Verify Interlock through its MCP tools only. Start workflow ${w.id} with input {"message":"interlock works"}. List work for that run, claim it as codex-smoke, execute its assignment, submit the result, and inspect the root run. Do not read or modify files or use other tools. Return the run ID, status, and output. Do not stop after describing a plan.`;
const child = spawn(
  'codex',
  [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '-c',
    config,
    prompt,
  ],
  { stdio: 'inherit', cwd: root },
);
const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
const code = await new Promise<number | null>((resolve) =>
  child.on('exit', resolve),
);
clearTimeout(timer);
const runs = (await client.runs.list.query()).filter(
  (r) => r.workflowId === w.id,
);
await client.workflows.update.mutate({ id: w.id, archived: true });
if (
  code !== 0 ||
  !runs.some(
    (r) =>
      r.status === 'completed' &&
      JSON.stringify(r.output) === '{"message":"INTERLOCK WORKS"}',
  )
)
  throw new Error('Codex smoke did not complete successfully');
console.log('Verified Codex → MCP → Interlock → Codex → completed run.');
