import { readFile } from 'node:fs/promises';
import { createClient } from '@interlock/client';
import { parseArgs } from 'node:util';
const parse = async (value: string | undefined) => {
  if (value === undefined) throw new Error('Missing JSON argument');
  return JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
};
export async function runCommand(argv: string[]) {
  const client = createClient(process.env.INTERLOCK_URL);
  const [command, ...args] = argv;
  switch (command) {
    case 'workflows':
      return client.workflows.list.query(
        args[0] ? await parse(args[0]) : undefined,
      );
    case 'workflow':
      return client.workflows.get.query({ id: args[0] });
    case 'archive':
      return client.workflows.update.mutate({ id: args[0], archived: true });
    case 'restore':
      return client.workflows.update.mutate({ id: args[0], archived: false });
    case 'delete':
      if (args.length !== 2 || args[1] !== '--yes')
        throw new Error(
          'Usage: delete <id> --yes. Permanently removes the workflow and its history. Use archive to preserve history.',
        );
      return client.workflows.delete.mutate({ id: args[0] });
    case 'import': {
      const input = await parse(args[0]);
      if (input.format === 'interlock-workflows') {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            force: { type: 'boolean' },
            revisions: { type: 'string' },
          },
        });
        return client.workflows.import.mutate({
          bundle: input,
          force: values.force,
          draftRevisions: values.revisions
            ? await parse(values.revisions)
            : undefined,
        });
      }
      if (args.length !== 1)
        throw new Error('Import options require a workflow bundle');
      return client.workflows.create.mutate(input);
    }
    case 'export':
      return client.workflows.export.query({ id: args[0] });
    case 'publish':
      if (!args[0] || args.slice(1).some((arg) => arg !== '--cascade'))
        throw new Error('Usage: publish <id> [--cascade]');
      return client.workflows.publish.mutate({
        id: args[0],
        cascade: args.includes('--cascade'),
      });
    case 'start':
      return client.runs.start.mutate({
        workflowId: args[0],
        input: await parse(args[1]),
        version: args[2] ? Number(args[2]) : undefined,
      });
    case 'runs': {
      if (!args.length) return client.runs.list.query();
      const { values } = parseArgs({
        args,
        options: {
          workflow: { type: 'string' },
          status: { type: 'string' },
          'root-only': { type: 'boolean' },
          limit: { type: 'string' },
          'input-path': { type: 'string' },
          equals: { type: 'string' },
        },
      });
      if (
        (values['input-path'] === undefined) !==
        (values.equals === undefined)
      )
        throw new Error('--input-path and --equals must be supplied together');
      const { runQuerySchema } = await import('@interlock/core');
      return client.runs.find.query(
        runQuerySchema.parse({
          workflowId: values.workflow,
          status: values.status,
          rootOnly: values['root-only'],
          limit: values.limit === undefined ? undefined : Number(values.limit),
          inputMatch:
            values['input-path'] === undefined
              ? undefined
              : {
                  path: values['input-path'],
                  equals: await parse(values.equals),
                },
        }),
      );
    }
    case 'run':
      return client.runs.get.query({ id: args[0] });
    case 'work':
      return args.includes('--summary')
        ? client.work.summaries.query({
            runId: args.find((arg) => arg !== '--summary'),
          })
        : client.work.list.query({ runId: args[0] });
    case 'claim':
      return client.work.claim.mutate({
        workId: args[0],
        workerId: args[1] ?? 'cli',
        ...(args[2] ? await parse(args[2]) : {}),
      });
    case 'submit':
      return client.work.submit.mutate({
        workId: args[0],
        token: args[1],
        output: await parse(args[2]),
      });
    case 'fail':
      return client.work.fail.mutate({
        workId: args[0],
        token: args[1],
        error: args[2],
      });
    case 'renew':
      return client.work.renew.mutate({ workId: args[0], token: args[1] });
    case 'cancel':
      return client.runs.cancel.mutate({ id: args[0] });
    case 'retry':
      return client.runs.retry.mutate({ id: args[0] });
    default:
      return {
        usage: [
          'workflows [scope-json: {"ownerWorkflowId":null|"parent-id"}]',
          'workflow <id>',
          'archive <id>',
          'restore <id>',
          'delete <id> --yes',
          'import <json|@file> [--force | --revisions JSON] (options apply to bundles)',
          'export <id>',
          'publish <id> [--cascade]',
          'start <workflow-id> <json|@file> [version]',
          'runs [--workflow ID] [--status STATUS] [--root-only] [--limit N] [--input-path PATH --equals JSON] (no flags preserves the full history dump)',
          'run <id>',
          'work [run-id] [--summary]',
          'claim <work-id> [worker-id] [capabilities-json]',
          'submit <work-id> <token> <json|@file>',
          'fail <work-id> <token> <error>',
          'renew <work-id> <token>',
          'cancel <run-id>',
          'retry <run-id>',
        ],
      };
  }
}
