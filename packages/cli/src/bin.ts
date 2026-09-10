#!/usr/bin/env node
import { createMcpClient } from '../../mcp/src/client.js';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startServer } from '../../server/src/start.js';
import { createMcpServer } from '../../mcp/src/server.js';
import { VERSION } from '../../core/src/version.js';
import { runCommand } from './commands.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION);
    return;
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(`Interlock ${VERSION}

Usage: interlock [--port 4310] [--workdir PATH] [--db PATH]
       interlock mcp
       interlock <command> [arguments]

With no command, starts the local engine, UI, and HTTP MCP endpoint at /mcp.
Default MCP URL: http://127.0.0.1:4310/mcp. Keep this terminal open.
Default database: ~/.interlock/interlock.db
Pending database migrations run at startup, with a backup before schema upgrades.
Default script working directory: current directory

mcp       Stdio MCP bridge to the running engine. Set INTERLOCK_URL to override
          http://127.0.0.1:4310. Stdout is reserved for the MCP protocol.

Workflow commands: workflows, workflow, import, publish, start
Run commands: runs, run, work, claim, submit, fail, renew, cancel, retry
Run 'interlock commands' for argument syntax.

Environment: INTERLOCK_DB, INTERLOCK_WORKDIR, INTERLOCK_URL`);
    return;
  }
  if (argv[0] === 'mcp') {
    if (argv.length !== 1)
      throw new Error(
        'Usage: interlock mcp. Set INTERLOCK_URL to choose the engine.',
      );
    await createMcpServer(createMcpClient(process.env.INTERLOCK_URL)).connect(
      new StdioServerTransport(),
    );
    return;
  }
  if (argv[0] && !argv[0].startsWith('-')) {
    const known = [
      'commands',
      'workflows',
      'workflow',
      'import',
      'publish',
      'start',
      'runs',
      'run',
      'work',
      'claim',
      'submit',
      'fail',
      'renew',
      'cancel',
      'retry',
    ];
    if (!known.includes(argv[0]))
      throw new Error(`Unknown command: ${argv[0]}. Run interlock --help.`);
    console.log(JSON.stringify(await runCommand(argv), null, 2));
    return;
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      workdir: { type: 'string' },
      db: { type: 'string' },
    },
  });
  const port = Number(values.port ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be between 1 and 65535.');
  const engineUrl = `http://127.0.0.1:${port}`;
  startServer({
    port,
    database: resolve(
      values.db ??
        process.env.INTERLOCK_DB ??
        resolve(homedir(), '.interlock/interlock.db'),
    ),
    workdir: resolve(
      values.workdir ?? process.env.INTERLOCK_WORKDIR ?? process.cwd(),
    ),
    ui: fileURLToPath(new URL('./ui/', import.meta.url)),
    connection: {
      command: 'interlock',
      args: ['mcp'],
      development: false,
      engineUrl,
      env: { INTERLOCK_URL: engineUrl },
      fallback: {
        command: process.execPath,
        args: [fileURLToPath(import.meta.url), 'mcp'],
      },
    },
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
