#!/usr/bin/env node
import '@interlock/server/sqliteWarning';
import { createMcpClient } from '@interlock/mcp/client';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  isDatabaseLocked,
  probeHealthyServer,
  startServer,
} from '@interlock/server/start';
import { createMcpServer } from '@interlock/mcp';
import { VERSION } from '@interlock/core/version';
import { resolveDataPaths } from '@interlock/core/dataPaths';
import {
  runCommand,
  commandError,
  runDoctorCommand,
  formatDoctorReport,
  runReportCommand,
  parseReportArgs,
  formatWorkflowReport,
} from './commands.js';
import { commandHelp } from './usage.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION);
    return;
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(`Interlock ${VERSION}

Usage: interlock [--port 4310] [--workdir PATH] [--db PATH]
       interlock mcp [--profile all|execute|author|operate]
       interlock <command> [arguments]

With no command, starts the local engine, UI, and HTTP MCP endpoint at /mcp.
Default MCP URL: http://127.0.0.1:4310/mcp. Keep this terminal open.
Default database: ~/.interlock/interlock.db
Pending database migrations run at startup, with a backup before schema upgrades.
Default script working directory: current directory

mcp       Stdio MCP bridge to the running engine. Set INTERLOCK_URL to override
          http://127.0.0.1:4310. Stdout is reserved for the MCP protocol.
          --profile or INTERLOCK_MCP_PROFILE limits the tools served (default
          all). HTTP clients use /mcp/<profile>.

Workflow commands: workflows, workflow, starters, import-starter, import, update, edit, export, publish, archive, restore, delete, start, simulation, test-suite
Run commands: runs, run, run-history, run-version, context-group, handoff-context, work, claim, preflight, submit, fail, renew, assignment-size, external-input, work-hold, work-resources, script, approve-script, script-approval, cancel-tree, cancel, retry
Usage and budget commands: usage, report-usage, budget, set-budget, prices
Local harness configuration and execution: executors, launcher
Workflow variables: variables <read|manage> <json|@file> [--value-stdin]
Workflow memory: memory <read|manage|work> <json|@file>
Workflow triggers: triggers (schedules is an alias) <read|manage> <json|@file>
Kinds: schedule, event. Event triggers match run transitions with optional quiescence.
Stall monitoring: stalls
Named pause holds: pause, pause-holds, resume
Boards: board <view|types|save-type|save|hold|release>
Workflow change proposals: proposals <list|get|create|approve|reject|reapply|settings>
Workflow performance and cost report: report [--workflow <id>] [--since <ISO datetime>] [--until <ISO datetime>] [--limit <n>] [--tag KEY=VALUE ...] [--json]
Report dates must be valid ISO datetimes whose rounded UTC bounds stay within years 0000 through 9999.
System readiness check: doctor [--live] [--json]
Run 'interlock commands' for argument syntax, or 'interlock <command> --help' for one command.

Environment: INTERLOCK_PORT, INTERLOCK_DATA_DIR, INTERLOCK_DB, INTERLOCK_WORKDIR, INTERLOCK_URL,
             INTERLOCK_SECRET_KEY_FILE, INTERLOCK_MCP_PROFILE,
             INTERLOCK_CONFIG, INTERLOCK_REQUIRE_TOKEN, INTERLOCK_ALLOWED_ROOTS,
             INTERLOCK_LOG_LEVEL, INTERLOCK_SYNC_DIR,
             INTERLOCK_OTEL_TRACES
INTERLOCK_SYNC_DIR=PATH syncs workflow drafts with bundle files in PATH.
INTERLOCK_CONFIG=PATH selects an absolute path to the engine's operator JSON file.
INTERLOCK_OTEL_TRACES=1 exports run traces to OTEL_EXPORTER_OTLP_ENDPOINT (OTLP/HTTP JSON).
INTERLOCK_DATA_DIR=PATH stores engine state under an absolute directory. --db and INTERLOCK_DB override the database path. INTERLOCK_SECRET_KEY_FILE overrides the encryption key path.
Variable encryption keys are held separately from the database. Back up keys separately.
INTERLOCK_REQUIRE_TOKEN=1 rejects API, MCP and event requests without the API token.
Commands and the mcp bridge read the token from the api-token file in the key folder.`);
    return;
  }
  if (argv[0] === 'mcp') {
    const profile =
      argv.length === 3 && argv[1] === '--profile' ? argv[2] : undefined;
    if (argv.length !== 1 && profile === undefined)
      throw new Error(
        'Usage: interlock mcp [--profile all|execute|author|operate]. Set INTERLOCK_URL to choose the engine.',
      );
    await createMcpServer(
      createMcpClient(process.env.INTERLOCK_URL),
      profile ?? process.env.INTERLOCK_MCP_PROFILE,
    ).connect(new StdioServerTransport());
    return;
  }
  if (argv[0] && !argv[0].startsWith('-')) {
    const known = [
      'commands',
      'stalls',
      'simulation',
      'test-suite',
      'run-version',
      'context-group',
      'handoff-context',
      'preflight',
      'executors',
      'launcher',
      'variables',
      'memory',
      'schedules',
      'triggers',
      'pause',
      'resume',
      'pause-holds',
      'workflows',
      'workflow',
      'starters',
      'import-starter',
      'update',
      'edit',
      'archive',
      'restore',
      'delete',
      'import',
      'export',
      'publish',
      'start',
      'board',
      'proposals',
      'runs',
      'run',
      'run-history',
      'work',
      'claim',
      'submit',
      'fail',
      'renew',
      'assignment-size',
      'external-input',
      'work-hold',
      'work-resources',
      'script',
      'approve-script',
      'script-approval',
      'cancel-tree',
      'cancel',
      'retry',
      'usage',
      'report-usage',
      'budget',
      'set-budget',
      'prices',
      'doctor',
      'report',
    ];
    if (!known.includes(argv[0]))
      throw new Error(`Unknown command: ${argv[0]}. Run interlock --help.`);
    const options = argv.slice(1);
    const end = options.indexOf('--');
    if (
      (end < 0 ? options : options.slice(0, end)).some(
        (arg) => arg === '--help' || arg === '-h',
      )
    ) {
      console.log(commandHelp(argv[0]));
      return;
    }
    if (argv[0] === 'report') {
      const { filter, json } = parseReportArgs(argv.slice(1));
      const report = await runReportCommand(filter);
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatWorkflowReport(report));
      }
      return;
    }
    if (argv[0] === 'doctor') {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          live: { type: 'boolean' },
          json: { type: 'boolean' },
        },
      });
      const report = await runDoctorCommand({ live: values.live });
      if (values.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDoctorReport(report));
      }
      process.exit(report.status === 'fail' ? 1 : 0);
    }
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
  const port = Number(values.port ?? process.env.INTERLOCK_PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be between 1 and 65535.');
  const engineUrl = `http://127.0.0.1:${port}`;
  const paths = resolveDataPaths({
    database:
      values.db === undefined ? undefined : { path: values.db, source: '--db' },
    resolveDatabasePath: true,
  });
  const database = paths.database.path;
  const healthy = await probeHealthyServer(engineUrl);
  const databaseInUse = healthy && isDatabaseLocked(database);
  if (databaseInUse || (healthy && !values.db && !paths.dataDir)) {
    // The health check does not reveal the server's database; only the lock says it is in use.
    console.log(
      `Interlock is already running at ${engineUrl}.${databaseInUse ? '' : ` It may be using a different database than ${database}; stop it or choose another --port to open that database.`}\nOpen ${engineUrl} in your browser or run 'interlock <command>' to interact with the running engine.`,
    );
    return;
  }
  await startServer({
    port,
    paths,
    workdir: resolve(
      values.workdir ?? process.env.INTERLOCK_WORKDIR ?? process.cwd(),
    ),
    ui: fileURLToPath(new URL('./ui/', import.meta.url)),
    connection: {
      command: 'interlock',
      args: ['mcp'],
      development: false,
      engineUrl,
      env: {
        INTERLOCK_URL: engineUrl,
        ...(process.versions.electron || process.env.ELECTRON_RUN_AS_NODE
          ? { ELECTRON_RUN_AS_NODE: '1' }
          : {}),
      },
      fallback: {
        command: process.execPath,
        args: [fileURLToPath(import.meta.url), 'mcp'],
      },
    },
  });
}

main().catch((error) => {
  console.error(commandError(error));
  process.exitCode = 1;
});
